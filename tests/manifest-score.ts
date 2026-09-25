import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Field } from "@/features/documents/contracts/fields";

export interface ExpectedOccurrence {
  at: string;
  marker?: string;
  blank?: "underline" | "cell";
  lang?: "en" | "fr";
}

export interface ExpectedField {
  id: string;
  types: string[];
  owner: string | null;
  unit?: string;
  role?: string;
  labelIncludes?: string;
  acceptsNone?: boolean;
  occurrences: ExpectedOccurrence[];
}

export interface Manifest {
  fixture: string;
  sha256: string;
  documentLanguage: string;
  fields: ExpectedField[];
  distinct: [string, string][];
  bilingual: { field: string }[];
  nonFields: { at: string }[];
}

export const MANIFESTS = [
  "01_Mutual_NDA",
  "02_Residential_Lease_Mixed_Placeholders",
  "03_Bilingual_Services_Agreement",
] as const;

const root = path.resolve(import.meta.dirname, "..");

export function loadManifest(name: string): {
  manifest: Manifest;
  bytes: Uint8Array;
} {
  const manifest: Manifest = JSON.parse(
    readFileSync(path.join(root, "tests/manifests", `${name}.json`), "utf8"),
  );
  const bytes = new Uint8Array(readFileSync(path.join(root, manifest.fixture)));
  const sha = createHash("sha256").update(bytes).digest("hex");

  if (sha !== manifest.sha256) {
    throw new Error(`${manifest.fixture} changed: ${sha}`);
  }

  return {
    manifest,
    bytes,
  };
}

const covers = (o: Field["occurrences"][number], e: ExpectedOccurrence) => {
  if (o.blockId !== e.at) {
    return false;
  }

  if (e.marker !== undefined) {
    return o.expected === e.marker;
  }

  if (e.blank === "cell") {
    return o.marker === "cell";
  }

  return o.marker === "line" || (o.expected !== "" && !o.expected.trim());
};

export interface Score {
  missing: string[];
  missedOccurrences: string[];
  falsePositives: string[];
  merges: string[];
  splits: string[];
  typeErrors: string[];
  unitErrors: string[];
  ownerErrors: string[];
  labelErrors: string[];
  nonFieldHits: string[];
  matched: Map<string, Field>;
}

export function score(manifest: Manifest, fields: Field[]): Score {
  const s: Score = {
    missing: [],
    missedOccurrences: [],
    falsePositives: [],
    merges: [],
    splits: [],
    typeErrors: [],
    unitErrors: [],
    ownerErrors: [],
    labelErrors: [],
    nonFieldHits: [],
    matched: new Map(),
  };

  const expectedOf = (f: Field) => {
    return new Set(
      manifest.fields
        .filter((e) =>
          e.occurrences.some((eo) => f.occurrences.some((o) => covers(o, eo))),
        )
        .map((e) => e.id),
    );
  };

  for (const f of fields) {
    if (f.source === "condition") {
      continue;
    }

    const hit = expectedOf(f);

    if (hit.size === 0) {
      s.falsePositives.push(`${f.id} (${f.label})`);
    }

    if (hit.size > 1) {
      s.merges.push(`${f.id} = ${[...hit].join(" + ")}`);
    }

    for (const o of f.occurrences) {
      if (manifest.nonFields.some((n) => n.at === o.blockId)) {
        s.nonFieldHits.push(`${f.id} @ ${o.blockId}`);
      }
    }
  }

  for (const e of manifest.fields) {
    const producers = fields.filter((f) =>
      e.occurrences.some((eo) => f.occurrences.some((o) => covers(o, eo))),
    );

    if (!producers.length) {
      s.missing.push(e.id);
      continue;
    }

    if (producers.length > 1) {
      s.splits.push(`${e.id} -> ${producers.map((p) => p.id).join(", ")}`);
    }

    for (const eo of e.occurrences) {
      if (!producers.some((p) => p.occurrences.some((o) => covers(o, eo)))) {
        s.missedOccurrences.push(`${e.id} @ ${eo.at}`);
      }
    }

    const [f] = producers;

    if (!f || producers.length > 1) {
      continue;
    }

    s.matched.set(e.id, f);

    if (!e.types.includes(f.valueType)) {
      s.typeErrors.push(`${e.id}: ${f.valueType} not in ${e.types.join("|")}`);
    }

    if (e.unit !== undefined && f.unit !== e.unit) {
      s.unitErrors.push(`${e.id}: ${f.unit ?? "none"} != ${e.unit}`);
    }

    if (e.owner !== null && f.owner !== e.owner) {
      s.ownerErrors.push(`${e.id}: ${f.owner ?? "none"} != ${e.owner}`);
    }

    if (
      e.labelIncludes &&
      !f.label.toLowerCase().includes(e.labelIncludes.toLowerCase())
    ) {
      s.labelErrors.push(`${e.id}: "${f.label}"`);
    }
  }

  return s;
}

export const summary = (name: string, s: Score) => {
  const rows = Object.entries(s)
    .filter(([k]) => k !== "matched")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : 0}`)
    .join(", ");

  return `${name}: ${rows}`;
};
