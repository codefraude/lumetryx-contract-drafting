import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectMarkers } from "@/lib/docx/detect";
import { AnchorConflictError, applyTextEdits, fillAndRender, indexBlocks } from "@/lib/docx/ooxml";
import { DocxValidationError, loadDocxPackage, serializePackage } from "@/lib/docx/package";
import { buildFields, draftEdits } from "@/lib/fields/build";

const fixture = (name: string) => new Uint8Array(readFileSync(`fixtures/${name}.docx`));

async function partXml(bytes: Uint8Array, part: string) {
  return (await JSZip.loadAsync(bytes)).file(part)!.async("string");
}

describe("package validation", () => {
  it("rejects non-zip, legacy/encrypted and fake-extension files", async () => {
    await expect(loadDocxPackage(new TextEncoder().encode("hello"))).rejects.toMatchObject({ code: "not_zip" });
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(loadDocxPackage(cfb)).rejects.toMatchObject({ code: "encrypted" });
    const zip = new JSZip();
    zip.file("readme.txt", "not a docx");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(loadDocxPackage(bytes)).rejects.toBeInstanceOf(DocxValidationError);
  });

  it("rejects macro-enabled packages", async () => {
    const zip = await JSZip.loadAsync(fixture("synthetic-mutual-nda"));
    zip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
    await expect(loadDocxPackage(await zip.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "macro_enabled" });
  });
});

describe("indexing and detection", () => {
  it("indexes body, table cells, header and footer with numbering labels", async () => {
    const blocks = await indexBlocks(await loadDocxPackage(fixture("synthetic-mutual-nda")));
    expect(blocks.find((b) => b.text === "Definitions")?.numberLabel).toBe("1.");
    expect(blocks.find((b) => b.text.startsWith("Information independently"))?.numberLabel).toBe("1.1.2.");
    expect(blocks.find((b) => b.text.startsWith("Each party"))?.numberLabel).toBe("2.1.");
    expect(blocks.some((b) => b.kind === "tableCell" && b.text === "{{disclosing_party_name}}")).toBe(true);
    expect(blocks.some((b) => b.partKind === "header" && b.text.includes("[REFERENCE NUMBER]"))).toBe(true);
  });

  it("finds placeholders split across differently formatted runs and mixed marker styles", async () => {
    const blocks = await indexBlocks(await loadDocxPackage(fixture("synthetic-mutual-nda")));
    const markers = detectMarkers(blocks);
    const keys = new Set(markers.map((m) => m.key));
    expect(keys).toContain("k:disclosing party name"); // split run + table cell
    expect(keys).toContain("k:receiving party name");
    expect(keys).toContain("k:company number");
    expect(markers.filter((m) => m.key === "k:disclosing party name")).toHaveLength(2);
    // "of ________________" is a field, the "Signed by: ____" lines are not.
    const blanks = markers.filter((m) => m.marker === "underscore");
    expect(blanks).toHaveLength(1);
    expect(blanks[0]!.labelHint).toContain("of");
  });
});

describe("filling", () => {
  it("replaces a split-run placeholder, escapes XML, preserves formatting and structure", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-mutual-nda"));
    const blocks = await indexBlocks(pkg);
    const { fields } = buildFields(blocks, detectMarkers(blocks), null);
    const name = fields.find((f) => f.label === "Disclosing party name")!;
    Object.assign(name, { status: "confirmed", displayValue: "Smith & Sons <Ltd>" });
    const originalNumbering = await pkg.zip.file("word/numbering.xml")!.async("string");
    await applyTextEdits(pkg, draftEdits(fields, "en"));
    const out = await serializePackage(pkg);
    const doc = await partXml(out, "word/document.xml");
    expect(doc).toContain("Smith &amp; Sons &lt;Ltd&gt;");
    expect(doc).not.toContain("disclosing_");
    // Replacement stays inside the first (bold) run of the split placeholder.
    expect(doc).toMatch(/<w:b\/>[\s\S]{0,200}Smith &amp; Sons/);
    expect(await partXml(out, "word/numbering.xml")).toBe(originalNumbering);
    expect(doc).toContain('w:numId w:val="2"');
    expect(doc).toContain("<w:pgMar");
    expect(doc).toContain("headerReference");
    const reopened = await indexBlocks(await loadDocxPackage(out));
    expect(reopened.filter((b) => b.text.includes("Smith & Sons <Ltd>"))).toHaveLength(2);
    expect(reopened.find((b) => b.text.startsWith("Information independently"))?.numberLabel).toBe("1.1.2.");
  });

  it("fills headers and inserts implicit values after verified quotes", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const intro = blocks.find((b) => b.text.startsWith("This Lease"))!;
    const { fields, rejected } = buildFields(blocks, detectMarkers(blocks), {
      notFields: [],
      fields: [
        { id: "reference", label: "Reference", question: "?", valueType: "text", group: "other", required: true, markerKeys: ["k:reference number"], implicit: [] },
        { id: "bogus", label: "Bogus", question: "?", valueType: "text", group: "other", required: true, markerKeys: [], implicit: [{ blockId: intro.id, quote: "text that does not exist" }] },
      ],
    });
    expect(fields.find((f) => f.id === "bogus")).toBeUndefined();
    expect(rejected.length).toBe(1);
    const ref = fields.find((f) => f.id === "reference")!;
    Object.assign(ref, { status: "confirmed", displayValue: "LX-2026-001" });
    await applyTextEdits(pkg, draftEdits(fields, "en"));
    const header = Object.keys(pkg.zip.files).find((n) => /^word\/header\d*\.xml$/.test(n))!;
    expect(await pkg.zip.file(header)!.async("string")).toContain("LX-2026-001");
  });

  it("applies multiple edits in one paragraph in a safe order and reports final anchors", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const b = blocks.find((x) => x.text.startsWith("This Lease"))!;
    const a = b.text.indexOf("[LANDLORD NAME]");
    const t = b.text.indexOf("{{tenant_name}}");
    const applied = await applyTextEdits(pkg, [
      { blockId: b.id, start: a, end: a + 15, expected: "[LANDLORD NAME]", value: "Ravi Ramdin" },
      { blockId: b.id, start: t, end: t + 15, expected: "{{tenant_name}}", value: "J. Smith" },
    ]);
    const after = (await indexBlocks(pkg)).find((x) => x.id === b.id)!;
    for (const ap of applied) expect(after.text.slice(ap.result.start, ap.result.end)).toBe(ap.result.text);
    expect(after.runs.find((r) => r.text.includes("J. Smith"))?.bold).toBe(true);
  });

  it("refuses stale anchors without mutating anything", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const b = blocks.find((x) => x.text.startsWith("This Lease"))!;
    const before = await pkg.zip.file("word/document.xml")!.async("string");
    await expect(applyTextEdits(pkg, [{ blockId: b.id, start: 0, end: 4, expected: "Nope", value: "x" }])).rejects.toBeInstanceOf(AnchorConflictError);
    expect(await pkg.zip.file("word/document.xml")!.async("string")).toBe(before);
  });

  it("yields rendered blocks progressively before completion", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const order: string[] = [];
    for await (const ev of fillAndRender(pkg, [])) order.push(ev.type);
    expect(order.at(-1)).toBe("done");
    expect(order.filter((t) => t === "block").length).toBeGreaterThan(10);
  });
});
