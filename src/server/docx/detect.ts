import type { Block } from "@/server/docx/blocks";

export type MarkerKind = "brace" | "bracket" | "underscore" | "control";

export interface MarkerOccurrence {
  blockId: string;
  start: number;
  end: number;
  /**
   * Exact source text, e.g. "{{tenant_name}}", or
   * the placeholder text of a Word content control.
   */
  text: string;
  marker: MarkerKind;
  /**
   * Grouping key for identical markers; underscore blanks and
   * unbound controls are keyed by position (never auto-merged).
   */
  key: string;
  labelHint: string;
  context: string;
  /** Title of a content control, shown to the analysis only. */
  title?: string;
}

// Letters may be accented (French templates:
// {{nom_du_client}}, [date de début]).
const BRACE = /\{\{\s*(\p{L}[\p{L}\p{N}_ .'’-]{0,60}?)\s*\}\}/gu;
// Letters, spaces and a few separators; excludes
// citations like [1], [sic], [emphasis added].
const BRACKET = /\[(\p{L}[\p{L}\p{N} _/'’.,&-]{0,60})\]/gu;
const UNDERSCORE = /_{4,}/g;
/**
 * `[[IF …]]` control markers belong to conditional
 * clauses (clauses/condition-markers.ts), not to fields.
 */
const CONTROL = /\[\[[^\]]*\]\]/g;
const NON_FIELD_BRACKETS = new Set([
  "sic",
  "emphasis added",
  "emphasis supplied",
  "reserved",
  "intentionally left blank",
  "deleted",
  "réservé",
  "supprimé",
  "nous soulignons",
]);
const SIGNATURE_CONTEXT =
  /(sign(ed|ature)?|initials?|signé(e)?|paraphe)\s*(by|par)?[^.:]{0,40}:?\s*$/i;

/**
 * Accent-, case- and separator-insensitive key, so “[Date
 * de début]” and “[date de debut]” group together.
 */
export const normalizeKey = (raw: string): string => {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_\s'’-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
};

/** Readable label that keeps the template's own spelling and accents. */
export const humanize = (raw: string): string => {
  const s = raw
    .trim()
    .replace(/[_\s]+/g, " ")
    .toLowerCase();

  return s.charAt(0).toUpperCase() + s.slice(1);
};

const contextOf = (
  text: string,
  start: number,
  end: number,
  radius = 70,
): string => {
  return `${start > radius ? "…" : ""}${text.slice(Math.max(0, start - radius), end + radius)}${end + radius < text.length ? "…" : ""}`;
};

function underscoreLabel(text: string, start: number): string {
  const before = text
    .slice(0, start)
    .replace(/[\[\]{}]/g, "")
    .trim()
    .split(/\s+/)
    .slice(-4)
    .join(" ");

  return before ? `Blank after “${before}”` : "Blank";
}

/**
 * A placeholder this long is sample wording the template
 * offers (e.g. a paragraph of a letter), not a blank.
 */
const MAX_PLACEHOLDER_WORDS = 12;
/**
 * Word's generic prompts say nothing about the value; the control's title does.
 */
const GENERIC_PROMPT =
  /click or tap|click here|enter (any )?(text|a date)|choose an item|cliquez|appuyez ici|entrer (du texte|une date)|choisissez un élément/i;

/**
 * Finds marked fields: {{…}}, […], underscore lines and Word content
 * controls still showing their placeholder. Unmarked fields are left to
 * the AI analysis, whose verbatim quotes are checked against these blocks.
 */
export function detectMarkers(blocks: Block[]): MarkerOccurrence[] {
  const out: MarkerOccurrence[] = [];
  const bindings = new Map<string, number>();
  // Boxes share a title when they hold the same kind of content: when some
  // of them hold sample paragraphs (Word's letters title them all “Enter
  // the body of the letter”), the short ones are sample wording too.
  const sampleTitles = new Set(
    blocks.flatMap((b) =>
      (b.placeholders ?? []).flatMap((ph) =>
        ph.title &&
        b.text.slice(ph.start, ph.end).trim().split(/\s+/).length >
          MAX_PLACEHOLDER_WORDS
          ? [ph.title]
          : [],
      ),
    ),
  );

  for (const b of blocks) {
    const controls = [...b.text.matchAll(CONTROL)].map(
      (m) => [m.index, m.index + m[0].length] as const,
    );

    const inControl = (i: number) => {
      return controls.some(([s, e]) => i >= s && i < e);
    };

    const { text } = b;

    for (const m of text.matchAll(BRACE)) {
      const [, name = ""] = m;
      const start = m.index;

      out.push({
        blockId: b.id,
        start,
        end: start + m[0].length,
        text: m[0],
        marker: "brace",
        key: `k:${normalizeKey(name)}`,
        labelHint: humanize(name),
        context: contextOf(text, start, start + m[0].length),
      });
    }

    for (const m of text.matchAll(BRACKET)) {
      const inner = (m[1] ?? "").trim();

      if (inControl(m.index) || NON_FIELD_BRACKETS.has(inner.toLowerCase())) {
        continue;
      }

      // A defined-term style bracket inside
      // quotes (e.g. ["Buyer"]) is ordinary text.
      if (/^[“"]/.test(inner)) {
        continue;
      }

      const start = m.index;

      out.push({
        blockId: b.id,
        start,
        end: start + m[0].length,
        text: m[0],
        marker: "bracket",
        key: `k:${normalizeKey(inner)}`,
        labelHint: humanize(inner),
        context: contextOf(text, start, start + m[0].length),
      });
    }

    for (const m of text.matchAll(UNDERSCORE)) {
      const start = m.index;

      // Signature lines are meant to stay blank for
      // wet/e-signature; they are not interview fields.
      if (SIGNATURE_CONTEXT.test(text.slice(Math.max(0, start - 50), start))) {
        continue;
      }

      out.push({
        blockId: b.id,
        start,
        end: start + m[0].length,
        text: m[0],
        marker: "underscore",
        key: `u:${b.id}:${start}`,
        labelHint: underscoreLabel(text, start),
        context: contextOf(text, start, start + m[0].length),
      });
    }

    const marked = out.filter((m) => m.blockId === b.id);

    for (const ph of b.placeholders ?? []) {
      const raw = text.slice(ph.start, ph.end);
      const value = raw.trim();
      const start = ph.start + raw.indexOf(value);
      const end = start + value.length;

      // A marker typed inside the placeholder is the blank;
      // a line break cannot be replaced by one value.
      if (
        !value ||
        /[\t\n]/.test(value) ||
        value.split(/\s+/).length > MAX_PLACEHOLDER_WORDS ||
        (ph.title && sampleTitles.has(ph.title)) ||
        marked.some((m) => m.start < end && m.end > start)
      ) {
        continue;
      }

      // Controls bound to the same data always
      // show the same value in Word: one field.
      if (ph.binding && !bindings.has(ph.binding)) {
        bindings.set(ph.binding, bindings.size + 1);
      }

      const key = ph.binding
        ? `c:bound${bindings.get(ph.binding)}`
        : `c:${b.id}:${start}`;
      const title = ph.title?.replace(/\s*:\s*$/, "").trim() || undefined;
      const label =
        GENERIC_PROMPT.test(value) && title
          ? title
          : value.replace(/\s*:\s*$/, "");

      out.push({
        blockId: b.id,
        start,
        end,
        text: value,
        marker: "control",
        key,
        labelHint: label.charAt(0).toUpperCase() + label.slice(1),
        context: contextOf(text, start, end),
        ...(title ? { title } : {}),
      });
    }
  }

  return out;
}
