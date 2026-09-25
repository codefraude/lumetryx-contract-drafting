import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectMarkers } from "@/server/docx/detect";
import { AnchorConflictError } from "@/server/docx/edit";
import {
  applyTextEdits,
  fillAndRender,
  indexBlocks,
} from "@/server/docx/render";
import {
  DocxValidationError,
  loadDocxPackage,
  serializePackage,
} from "@/server/docx/package";
import { buildFields } from "@/server/fields/build-fields";
import { draftEdits } from "@/server/fields/draft-edits";
import type { TemplateAnalysis } from "@/server/fields/template-analysis";

const fixture = (name: string) => {
  return new Uint8Array(readFileSync(`fixtures/${name}.docx`));
};

async function partXml(bytes: Uint8Array, part: string) {
  return (await JSZip.loadAsync(bytes)).file(part)!.async("string");
}

describe("package validation", () => {
  it("rejects non-zip, legacy/encrypted and fake-extension files", async () => {
    await expect(
      loadDocxPackage(new TextEncoder().encode("hello")),
    ).rejects.toMatchObject({ code: "not_zip" });

    const cfb = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
    ]);

    await expect(loadDocxPackage(cfb)).rejects.toMatchObject({
      code: "encrypted",
    });

    const zip = new JSZip();

    zip.file("readme.txt", "not a docx");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(loadDocxPackage(bytes)).rejects.toBeInstanceOf(
      DocxValidationError,
    );
  });

  it("rejects macro-enabled packages", async () => {
    const zip = await JSZip.loadAsync(fixture("synthetic-mutual-nda"));

    zip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));

    await expect(
      loadDocxPackage(await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toMatchObject({ code: "macro_enabled" });
  });
});

describe("indexing and detection", () => {
  it("indexes body, table cells, header and footer with numbering labels", async () => {
    const blocks = await indexBlocks(
      await loadDocxPackage(fixture("synthetic-mutual-nda")),
    );

    expect(blocks.find((b) => b.text === "Definitions")?.numberLabel).toBe(
      "1.",
    );

    expect(
      blocks.find((b) => b.text.startsWith("Information independently"))
        ?.numberLabel,
    ).toBe("1.1.2.");

    expect(
      blocks.find((b) => b.text.startsWith("Each party"))?.numberLabel,
    ).toBe("2.1.");

    expect(
      blocks.some(
        (b) => b.kind === "tableCell" && b.text === "{{disclosing_party_name}}",
      ),
    ).toBe(true);

    expect(
      blocks.some(
        (b) => b.partKind === "header" && b.text.includes("[REFERENCE NUMBER]"),
      ),
    ).toBe(true);
  });

  it("finds placeholders split across differently formatted runs and mixed marker styles", async () => {
    const blocks = await indexBlocks(
      await loadDocxPackage(fixture("synthetic-mutual-nda")),
    );
    const markers = detectMarkers(blocks);
    const keys = new Set(markers.map((m) => m.key));

    expect(keys).toContain("k:disclosing party name"); // split run + table cell
    expect(keys).toContain("k:receiving party name");
    expect(keys).toContain("k:company number");

    expect(
      markers.filter((m) => m.key === "k:disclosing party name"),
    ).toHaveLength(2);

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

    Object.assign(name, {
      status: "confirmed",
      displayValue: "Smith & Sons <Ltd>",
    });

    const originalNumbering = await pkg.zip
      .file("word/numbering.xml")!
      .async("string");

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

    expect(
      reopened.filter((b) => b.text.includes("Smith & Sons <Ltd>")),
    ).toHaveLength(2);

    expect(
      reopened.find((b) => b.text.startsWith("Information independently"))
        ?.numberLabel,
    ).toBe("1.1.2.");
  });

  it("keeps a {{variable}} or an ALL-CAPS [PLACEHOLDER] that the model dismissed as ordinary text", async () => {
    const blocks = await indexBlocks(
      await loadDocxPackage(fixture("synthetic-bilingual-employment")),
    );
    const markers = detectMarkers(blocks);

    const key = (text: string) => {
      return markers.find((m) => m.text === text)!.key;
    };

    const { fields } = buildFields(blocks, markers, {
      notFields: [key("{{date_d_entree}}"), key("[NOM DU SALARIÉ]")],
      fields: [],
    });

    for (const text of ["{{date_d_entree}}", "[NOM DU SALARIÉ]"]) {
      expect(
        fields.some((f) => f.occurrences.some((o) => o.expected === text)),
      ).toBe(true);
    }
  });

  it("fills headers and inserts implicit values after verified quotes", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const intro = blocks.find((b) => b.text.startsWith("This Lease"))!;
    const { fields, rejected } = buildFields(blocks, detectMarkers(blocks), {
      notFields: [],
      fields: [
        {
          id: "reference",
          label: "Reference",
          question: "?",
          valueType: "text",
          group: "other",
          required: true,
          markerKeys: ["k:reference number"],
          implicit: [],
        },
        {
          id: "bogus",
          label: "Bogus",
          question: "?",
          valueType: "text",
          group: "other",
          required: true,
          markerKeys: [],
          implicit: [
            {
              blockId: intro.id,
              quote: "text that does not exist",
              replace: false,
            },
          ],
        },
      ],
    });

    expect(fields.find((f) => f.id === "bogus")).toBeUndefined();
    expect(rejected.length).toBe(1);
    const ref = fields.find((f) => f.id === "reference")!;

    Object.assign(ref, {
      status: "confirmed",
      displayValue: "LX-2026-001",
    });

    await applyTextEdits(pkg, draftEdits(fields, "en"));
    const header = Object.keys(pkg.zip.files).find((n) =>
      /^word\/header\d*\.xml$/.test(n),
    )!;

    expect(await pkg.zip.file(header)!.async("string")).toContain(
      "LX-2026-001",
    );
  });

  it("turns labels that copy the marker into readable names", async () => {
    const blocks = await indexBlocks(
      await loadDocxPackage(fixture("synthetic-residential-lease")),
    );

    const ai = (id: string, label: string, key: string) => {
      return {
        id,
        label,
        question: "?",
        valueType: "text" as const,
        group: "parties" as const,
        required: true,
        markerKeys: [key],
        implicit: [],
      };
    };

    const { fields } = buildFields(blocks, detectMarkers(blocks), {
      notFields: [],
      fields: [
        ai("tenant_name", "{{tenant_name}}", "k:tenant name"),
        ai("landlord_name", "LANDLORD NAME", "k:landlord name"),
        ai("start_date", "start_date", "k:start date"),
        ai("monthly_rent", "Monthly rent / Loyer mensuel", "k:monthly rent"),
      ],
    });

    expect(
      Object.fromEntries(fields.map((f) => [f.id, f.label])),
    ).toMatchObject({
      tenant_name: "Tenant name",
      landlord_name: "Landlord name",
      start_date: "Start date",
      monthly_rent: "Monthly rent / Loyer mensuel",
    });
  });

  it("applies multiple edits in one paragraph in a safe order and reports final anchors", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const b = blocks.find((x) => x.text.startsWith("This Lease"))!;
    const a = b.text.indexOf("[LANDLORD NAME]");
    const t = b.text.indexOf("{{tenant_name}}");
    const applied = await applyTextEdits(pkg, [
      {
        blockId: b.id,
        start: a,
        end: a + 15,
        expected: "[LANDLORD NAME]",
        value: "Ravi Ramdin",
      },
      {
        blockId: b.id,
        start: t,
        end: t + 15,
        expected: "{{tenant_name}}",
        value: "J. Smith",
      },
    ]);
    const after = (await indexBlocks(pkg)).find((x) => x.id === b.id)!;

    for (const ap of applied) {
      expect(after.text.slice(ap.result.start, ap.result.end)).toBe(
        ap.result.text,
      );
    }

    expect(after.runs.find((r) => r.text.includes("J. Smith"))?.bold).toBe(
      true,
    );
  });

  it("refuses stale anchors without mutating anything", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const b = blocks.find((x) => x.text.startsWith("This Lease"))!;
    const before = await pkg.zip.file("word/document.xml")!.async("string");

    await expect(
      applyTextEdits(pkg, [
        {
          blockId: b.id,
          start: 0,
          end: 4,
          expected: "Nope",
          value: "x",
        },
      ]),
    ).rejects.toBeInstanceOf(AnchorConflictError);

    expect(await pkg.zip.file("word/document.xml")!.async("string")).toBe(
      before,
    );
  });

  it("yields rendered blocks progressively before completion", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const order: string[] = [];

    for await (const ev of fillAndRender(pkg, [])) {
      order.push(ev.type);
    }

    expect(order.at(-1)).toBe("done");
    expect(order.filter((t) => t === "block").length).toBeGreaterThan(10);
  });
});

describe("Word content controls (placeholder boxes)", () => {
  const letter = async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-lettre-controles-fr"));
    const blocks = await indexBlocks(pkg);

    return {
      pkg,
      blocks,
      markers: detectMarkers(blocks),
    };
  };

  it("finds the boxes, groups those Word keeps identical, and leaves sample wording and galleries alone", async () => {
    const { markers } = await letter();

    const byText = (t: string) => {
      return markers.filter((m) => m.text === t);
    };

    expect(markers.every((m) => m.marker === "control")).toBe(true);

    // Bound to the same document property: one
    // field, in the body and in the header.
    expect(new Set(byText("Nom du destinataire").map((m) => m.key)).size).toBe(
      1,
    );

    expect(byText("Nom du destinataire").map((m) => m.blockId)).toContain(
      "word/header1.xml#0",
    );

    expect(new Set(byText("Votre nom").map((m) => m.key)).size).toBe(1);
    // The same wording for two different people is never merged.
    expect(new Set(byText("Adresse postale").map((m) => m.key)).size).toBe(2);

    // A sentence of the letter, a short piece of it in a box of the
    // same kind, and a table-of-contents gallery are not blanks.
    expect(
      markers.some((m) => m.text.startsWith("J’ai été très surpris")),
    ).toBe(false);

    expect(
      markers.some(
        (m) => m.text === "pourcent !" || m.text.startsWith(", je conteste"),
      ),
    ).toBe(false);

    expect(markers.some((m) => m.text.startsWith("Aucune entrée"))).toBe(false);

    // Word's generic prompt says nothing about the value; the box's title does.
    expect(
      byText("Cliquez ou appuyez ici pour entrer du texte.")[0]!.labelHint,
    ).toBe("Numéro de police");
  });

  it("replaces each placeholder with its answer and turns the box into ordinary content", async () => {
    const { pkg, blocks, markers } = await letter();
    const { fields } = buildFields(blocks, markers, null);

    const answer = (label: string, value: string) => {
      return Object.assign(
        fields.find((f) => f.label === label)!,
        {
          status: "confirmed",
          rawValue: value,
          displayValue: value,
          normalized: {
            kind: "text",
            value,
          },
        },
      );
    };

    answer("Votre nom", "Camille Martin");
    answer("Adresse postale", "12 rue des Lilas");
    answer("Adresse postale (2)", "1 place de la Bourse");
    answer("Nom du destinataire", "Jeanne Dupont");
    answer("Compagnie d’assurance", "Assurances & Fils");
    answer("Numéro de police", "POL-778");

    Object.assign(
      fields.find((f) => f.label === "Date")!,
      {
        status: "confirmed",
        rawValue: "24/09/2026",
        displayValue: "24 September 2026",
        normalized: {
          kind: "date",
          iso: "2026-09-24",
        },
      },
    );

    await applyTextEdits(pkg, draftEdits(fields, "fr"));
    const after = await indexBlocks(pkg);

    const text = (id: string) => {
      return after.find((b) => b.id === id)!.text;
    };

    // The value takes the placeholder's place; the placeholder wording is gone.
    expect(text("word/document.xml#0")).toBe("Camille Martin");
    expect(text("word/document.xml#1")).toBe("12 rue des Lilas");
    expect(text("word/document.xml#8")).toBe("1 place de la Bourse");
    expect(text("word/document.xml#10")).toBe("Cher/Chère Jeanne Dupont :");

    expect(text("word/document.xml#12")).toContain(
      "longue date de Assurances & Fils, je conteste",
    );

    expect(text("word/document.xml#13")).toBe("Numéro de police : POL-778");
    expect(text("word/document.xml#16")).toBe("Camille Martin");
    expect(text("word/header1.xml#0")).toBe("Jeanne Dupont");
    expect(text("word/header1.xml#1")).toBe("24 septembre 2026");

    const bytes = await serializePackage(pkg);
    const xml = await partXml(bytes, "word/document.xml");

    const box = (value: string, part = xml) => {
      return part.slice(
        part.lastIndexOf("<w:sdt>", part.indexOf(value)),
        part.indexOf("</w:sdt>", part.indexOf(value)),
      );
    };

    for (const v of [
      "Camille Martin",
      "12 rue des Lilas",
      "Jeanne Dupont",
      "Assurances &amp; Fils",
      "POL-778",
    ]) {
      expect(box(v), v).not.toContain("showingPlcHdr");
      // Kept, Word would replace the value with the
      // (empty) bound document property on opening.
      expect(box(v), v).not.toContain("dataBinding");
    }

    expect(
      box("Jeanne Dupont", await partXml(bytes, "word/header1.xml")),
    ).not.toContain("showingPlcHdr");

    // No grey placeholder formatting on the answer.
    expect(box("POL-778")).not.toContain("Textedelespacerserv");

    expect(xml).toMatch(
      /Rfrencelgre"\/><\/w:rPr><w:t[^>]*>Assurances &amp; Fils</,
    ); // the template's own formatting stays

    // Unanswered boxes still show their placeholder,
    // and are found again for a later answer.
    expect(box("Cordialement")).toContain("showingPlcHdr");
    const again = detectMarkers(after).map((m) => m.text);

    expect(again).toContain("Cordialement");
    expect(again).not.toContain("Votre nom");
  });

  it("gives two blanks with the same wording different names", async () => {
    const { blocks, markers } = await letter();
    const labels = buildFields(blocks, markers, null).fields.map(
      (f) => f.label,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "Adresse postale",
        "Adresse postale (2)",
        "Ville, rue et code postal",
        "Ville, rue et code postal (2)",
      ]),
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("placeholder wording without markers", () => {
  it("replaces the wording the analysis points to, and never lets two answers share a place", async () => {
    const pkg = await loadDocxPackage(fixture("synthetic-residential-lease"));
    const blocks = await indexBlocks(pkg);
    const use = blocks.find((b) =>
      b.text.startsWith("The Premises shall be used"),
    )!;
    const late = blocks.find((b) => b.text.startsWith("Late payments"))!;

    const f = (
      id: string,
      implicit: TemplateAnalysis["fields"][number]["implicit"],
    ) => {
      return {
        id,
        label: id,
        question: "?",
        valueType: "text" as const,
        group: "other" as const,
        required: true,
        markerKeys: [],
        implicit,
      };
    };

    const { fields, rejected } = buildFields(blocks, detectMarkers(blocks), {
      notFields: [],
      fields: [
        f("use", [
          {
            blockId: use.id,
            quote: "a private residence",
            replace: true,
          },
        ]),
        f("overlap", [
          {
            blockId: use.id,
            quote: "private residence",
            replace: true,
          },
        ]),
        f("on_marker", [
          {
            blockId: late.id,
            quote: "[INTEREST RATE] per annum",
            replace: true,
          },
        ]),
      ],
    });
    const ids = fields.map((x) => x.id);

    expect(ids).toContain("use");
    // Its place is already the answer to "use".
    expect(ids).not.toContain("overlap");
    expect(ids).not.toContain("on_marker"); // the marker is the field
    expect(rejected.some((r) => r.startsWith("overlapping place"))).toBe(true);

    Object.assign(
      fields.find((x) => x.id === "use")!,
      {
        status: "confirmed",
        displayValue: "a holiday home",
      },
    );

    await applyTextEdits(pkg, draftEdits(fields, "en"));

    expect((await indexBlocks(pkg)).find((b) => b.id === use.id)!.text).toBe(
      "The Premises shall be used only as a holiday home.",
    );
  });
});

describe("templates with a picture, notes, comments, tracked changes, a text box and a table of contents", () => {
  it("fills every placeholder, the one in the text box too, and keeps everything else byte for byte", async () => {
    const original = fixture("synthetic-supply-agreement");
    const pkg = await loadDocxPackage(original);
    const blocks = await indexBlocks(pkg);
    const { fields } = buildFields(blocks, detectMarkers(blocks), null);

    for (const f of fields) {
      Object.assign(f, {
        status: "confirmed",
        displayValue: `Value of ${f.label}`,
      });
    }

    await applyTextEdits(pkg, draftEdits(fields, "en"));
    const out = await serializePackage(pkg);
    const [before, after] = await Promise.all([
      JSZip.loadAsync(original),
      JSZip.loadAsync(out),
    ]);

    for (const part of [
      "word/comments.xml",
      "word/footnotes.xml",
      "word/numbering.xml",
      "word/styles.xml",
      "word/settings.xml",
    ]) {
      expect(await after.file(part)!.async("string"), part).toBe(
        await before.file(part)!.async("string"),
      );
    }

    const media = Object.keys(before.files).filter(
      (n) => n.startsWith("word/media/") && !before.files[n]!.dir,
    );

    expect(media).toHaveLength(1);

    for (const m of media) {
      expect(await after.file(m)!.async("base64")).toBe(
        await before.file(m)!.async("base64"),
      );
    }

    const doc = await partXml(out, "word/document.xml");

    expect(doc).not.toMatch(/\{\{|\[BUYER NAME\]/);
    expect(doc).toContain("Key contact: Value of Supplier contact");
    expect(doc).toMatch(/<w:ins [^>]*>[\s\S]*?within 14 days of each order/);
    expect(doc).toMatch(/<w:del [^>]*>[\s\S]*?as soon as practicable/);
    expect(doc).toContain("TOC \\h \\o");
    expect(doc).toContain("w:footnoteReference");
    expect(doc).toContain("w:commentReference");
    const header = await partXml(out, "word/header1.xml");

    expect(header).toContain("Value of Reference number");
    expect(header).toContain("<a:blip r:embed=");
  });
});
