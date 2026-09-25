import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import { buildFields } from "@/server/fields/build-fields";
import { TemplateAnalysis } from "@/server/fields/template-analysis";
import { loadManifest, MANIFESTS, score, summary } from "../manifest-score";

const recorded = (name: string) => {
  const raw: { analysis: unknown } = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, `../recorded/${name}.analysis.json`),
      "utf8",
    ),
  );

  return TemplateAnalysis.parse(raw.analysis);
};

async function fieldsFor(bytes: Uint8Array, analysis: TemplateAnalysis | null) {
  const blocks = await indexBlocks(await loadDocxPackage(bytes));

  return buildFields(blocks, detectMarkers(blocks), analysis).fields;
}

describe.each(MANIFESTS)("fixture %s", (name) => {
  const { manifest, bytes } = loadManifest(name);

  for (const mode of ["markers only", "recorded model analysis"] as const) {
    it(`${mode}: finds every field, merges nothing, splits nothing`, async () => {
      const fields = await fieldsFor(
        bytes,
        mode === "markers only" ? null : recorded(name),
      );
      const s = score(manifest, fields);

      console.log(summary(`${name} / ${mode}`, s));
      expect(s.missing).toEqual([]);
      expect(s.missedOccurrences).toEqual([]);
      expect(s.falsePositives).toEqual([]);
      expect(s.merges).toEqual([]);
      expect(s.splits).toEqual([]);
      expect(s.nonFieldHits).toEqual([]);
    });

    it(`${mode}: types, units, owners and labels match the manifest`, async () => {
      const fields = await fieldsFor(
        bytes,
        mode === "markers only" ? null : recorded(name),
      );
      const s = score(manifest, fields);

      expect(s.typeErrors).toEqual([]);
      expect(s.unitErrors).toEqual([]);
      expect(s.ownerErrors).toEqual([]);
      expect(s.labelErrors).toEqual([]);
    });

    it(`${mode}: distinct pairs stay distinct`, async () => {
      const fields = await fieldsFor(
        bytes,
        mode === "markers only" ? null : recorded(name),
      );
      const s = score(manifest, fields);

      for (const [a, b] of manifest.distinct) {
        const fa = s.matched.get(a);
        const fb = s.matched.get(b);

        expect(fa && fb && fa.id !== fb.id, `${a} / ${b}`).toBe(true);
      }
    });
  }
});

describe("a model that types party names as plain text", () => {
  it("still asks for them as parties", async () => {
    const name = "02_Residential_Lease_Mixed_Placeholders";
    const { manifest, bytes } = loadManifest(name);
    const analysis = recorded(name);
    const textual = {
      ...analysis,
      fields: analysis.fields.map((f) =>
        f.valueType === "party"
          ? {
              ...f,
              valueType: "text" as const,
            }
          : f,
      ),
    };
    const s = score(manifest, await fieldsFor(bytes, textual));

    expect(s.matched.get("landlord_name")?.valueType).toBe("party");
    expect(s.matched.get("tenant_name")?.valueType).toBe("party");
    expect(s.matched.get("electricity_payer")?.valueType).not.toBe("party");
  });
});

describe("a model that dismisses real blanks", () => {
  it.each(MANIFESTS)("%s keeps them, marked as uncertain", async (name) => {
    const { manifest, bytes } = loadManifest(name);
    const blocks = await indexBlocks(await loadDocxPackage(bytes));
    const markers = detectMarkers(blocks);
    const analysis = recorded(name);
    const structural = markers.filter(
      (m) =>
        m.marker === "line" ||
        m.marker === "cell" ||
        m.marker === "underscore" ||
        m.role !== undefined,
    );
    const structuralKeys = new Set(structural.map((m) => m.key));
    const dismissive = {
      ...analysis,
      notFields: [...structuralKeys],
      fields: analysis.fields.map((f) => ({
        ...f,
        markerKeys: f.markerKeys.filter((k) => !structuralKeys.has(k)),
        implicit: [],
      })),
    };
    const fields = buildFields(blocks, markers, dismissive).fields;
    const s = score(manifest, fields);

    expect(s.missing).toEqual([]);

    for (const m of structural) {
      const f = fields.find((x) =>
        x.occurrences.some(
          (o) => o.blockId === m.blockId && o.start === m.start,
        ),
      );

      expect(f?.confidence, m.key).toBe(0.5);
    }
  });
});
