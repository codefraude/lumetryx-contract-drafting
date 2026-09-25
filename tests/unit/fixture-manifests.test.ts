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
