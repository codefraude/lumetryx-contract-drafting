import type { Block } from "./ooxml";

export type MarkerKind = "brace" | "bracket" | "underscore";

export interface MarkerOccurrence {
  blockId: string;
  start: number;
  end: number;
  /** Exact source text, e.g. "{{tenant_name}}". */
  text: string;
  marker: MarkerKind;
  /** Grouping key for identical markers; underscore blanks are keyed by position (never auto-merged). */
  key: string;
  labelHint: string;
  context: string;
}

// Letters may be accented (French templates: {{nom_du_client}}, [date de début]).
const BRACE = /\{\{\s*(\p{L}[\p{L}\p{N}_ .'’-]{0,60}?)\s*\}\}/gu;
// Letters, spaces and a few separators; excludes citations like [1], [sic], [emphasis added].
const BRACKET = /\[(\p{L}[\p{L}\p{N} _/'’.,&-]{0,60})\]/gu;
const UNDERSCORE = /_{4,}/g;
/** `[[IF …]]` control markers belong to conditional clauses (rules.ts), not to fields. */
const CONTROL = /\[\[[^\]]*\]\]/g;
const NON_FIELD_BRACKETS = new Set(["sic", "emphasis added", "emphasis supplied", "reserved", "intentionally left blank", "deleted", "réservé", "supprimé", "nous soulignons"]);
const SIGNATURE_CONTEXT = /(sign(ed|ature)?|initials?|signé(e)?|paraphe)\s*(by|par)?[^.:]{0,40}:?\s*$/i;

/** Accent-, case- and separator-insensitive key, so “[Date de début]” and “[date de debut]” group together. */
export const normalizeKey = (raw: string): string =>
  raw
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_\s'’-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

/** Readable label that keeps the template's own spelling and accents. */
const humanize = (raw: string): string => {
  const s = raw.trim().replace(/[_\s]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const contextOf = (text: string, start: number, end: number, radius = 70): string =>
  `${start > radius ? "…" : ""}${text.slice(Math.max(0, start - radius), end + radius)}${end + radius < text.length ? "…" : ""}`;

function underscoreLabel(text: string, start: number): string {
  const before = text.slice(0, start).replace(/[\[\]{}]/g, "").trim().split(/\s+/).slice(-4).join(" ");
  return before ? `Blank after “${before}”` : "Blank";
}

/**
 * Finds explicitly marked fields. Contextual/implicit fields (no marker) are left to the
 * bounded AI analysis, which must cite a verbatim quote that is validated against these blocks.
 */
export function detectMarkers(blocks: Block[]): MarkerOccurrence[] {
  const out: MarkerOccurrence[] = [];
  for (const b of blocks) {
    const controls = [...b.text.matchAll(CONTROL)].map((m) => [m.index, m.index + m[0].length] as const);
    const inControl = (i: number) => controls.some(([s, e]) => i >= s && i < e);
    const { text } = b;
    for (const m of text.matchAll(BRACE)) {
      const start = m.index;
      out.push({ blockId: b.id, start, end: start + m[0].length, text: m[0], marker: "brace", key: `k:${normalizeKey(m[1]!)}`, labelHint: humanize(m[1]!), context: contextOf(text, start, start + m[0].length) });
    }
    for (const m of text.matchAll(BRACKET)) {
      const inner = m[1]!.trim();
      if (inControl(m.index) || NON_FIELD_BRACKETS.has(inner.toLowerCase())) continue;
      // A defined-term style bracket inside quotes (e.g. ["Buyer"]) is ordinary text.
      if (/^[“"]/.test(inner)) continue;
      const start = m.index;
      out.push({ blockId: b.id, start, end: start + m[0].length, text: m[0], marker: "bracket", key: `k:${normalizeKey(inner)}`, labelHint: humanize(inner), context: contextOf(text, start, start + m[0].length) });
    }
    for (const m of text.matchAll(UNDERSCORE)) {
      const start = m.index;
      // Signature lines are meant to stay blank for wet/e-signature; they are not interview fields.
      if (SIGNATURE_CONTEXT.test(text.slice(Math.max(0, start - 50), start))) continue;
      out.push({ blockId: b.id, start, end: start + m[0].length, text: m[0], marker: "underscore", key: `u:${b.id}:${start}`, labelHint: underscoreLabel(text, start), context: contextOf(text, start, start + m[0].length) });
    }
  }
  return out;
}
