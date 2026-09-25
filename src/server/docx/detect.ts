import type { Block } from "@/server/docx/blocks";

export type MarkerKind =
  "brace" | "bracket" | "underscore" | "line" | "cell" | "control";

export interface MarkerOccurrence {
  blockId: string;
  start: number;
  end: number;
  text: string;
  marker: MarkerKind;
  key: string;
  labelHint: string;
  context: string;
  title?: string;
}

const BRACE = /\{\{\s*(\p{L}[\p{L}\p{N}_ .'’-]{0,60}?)\s*\}\}/gu;
const BRACKET = /\[(\p{L}[\p{L}\p{N} _/'’.,&-]{0,60})\]/gu;
const UNDERSCORE = /_{4,}/g;
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
const SIGNATURE_LABEL = /^(sign|initials?|paraphe)/i;

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

export const humanize = (raw: string): string => {
  const s = raw
    .replace(/[_\s]+/g, " ")
    .trim()
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

const MAX_PLACEHOLDER_WORDS = 12;
const GENERIC_PROMPT =
  /click or tap|click here|enter (any )?(text|a date)|choose an item|cliquez|appuyez ici|entrer (du texte|une date)|choisissez un élément/i;

export function detectMarkers(blocks: Block[]): MarkerOccurrence[] {
  const out: MarkerOccurrence[] = [];
  const bindings = new Map<string, number>();
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

    for (const line of b.blankLines ?? []) {
      const before = text.slice(Math.max(0, line.start - 50), line.start);

      if (
        SIGNATURE_CONTEXT.test(before) ||
        out.some(
          (m) => m.blockId === b.id && m.start < line.end && m.end > line.start,
        )
      ) {
        continue;
      }

      const shown = `${text.slice(0, line.start)}____${text.slice(line.end)}`;

      out.push({
        blockId: b.id,
        start: line.start,
        end: line.end,
        text: text.slice(line.start, line.end),
        marker: "line",
        key: `l:${b.id}:${line.start}`,
        labelHint: underscoreLabel(text, line.start),
        context: contextOf(shown, line.start, line.start + 4),
      });
    }

    const marked = out.filter((m) => m.blockId === b.id);

    for (const ph of b.placeholders ?? []) {
      const raw = text.slice(ph.start, ph.end);
      const value = raw.trim();
      const start = ph.start + raw.indexOf(value);
      const end = start + value.length;

      if (
        !value ||
        /[\t\n]/.test(value) ||
        value.split(/\s+/).length > MAX_PLACEHOLDER_WORDS ||
        (ph.title && sampleTitles.has(ph.title)) ||
        marked.some((m) => m.start < end && m.end > start)
      ) {
        continue;
      }

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

  return [...out, ...emptyCells(blocks, out)];
}

function emptyCells(
  blocks: Block[],
  markers: MarkerOccurrence[],
): MarkerOccurrence[] {
  const marked = new Set(markers.map((m) => m.blockId));
  const tables = new Map<string, Block[]>();

  for (const b of blocks) {
    if (b.kind === "tableCell" && b.table) {
      const key = `${b.part}|${b.table.table}`;

      tables.set(key, [...(tables.get(key) ?? []), b]);
    }
  }

  const found: MarkerOccurrence[] = [];

  for (const cells of tables.values()) {
    const at = (row: number, col: number) => {
      return cells.filter((c) => c.table?.row === row && c.table.col === col);
    };

    const textAt = (row: number, col: number) => {
      return at(row, col)
        .map((c) => c.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/\s*:\s*$/, "")
        .trim();
    };

    const hasMarker = (row: number, col: number) => {
      return at(row, col).some((c) => marked.has(c.id));
    };

    const rows = [...new Set(cells.map((c) => c.table?.row ?? 0))].sort(
      (a, b) => a - b,
    );
    const cols = [...new Set(cells.map((c) => c.table?.col ?? 0))].sort(
      (a, b) => a - b,
    );
    const header = rows[0] === 0 && !cols.some((c) => hasMarker(0, c));
    const dataRows = header ? rows.filter((r) => r !== 0) : rows;
    const valueCols = cols.filter((c) => c > 0);

    if (!dataRows.some((r) => valueCols.some((c) => hasMarker(r, c)))) {
      continue;
    }

    for (const r of dataRows) {
      const label = textAt(r, 0);

      if (!label || SIGNATURE_LABEL.test(label)) {
        continue;
      }

      for (const c of valueCols) {
        const parts = at(r, c);
        const [first] = parts;

        if (
          !first ||
          parts.some((p) => p.text.trim() || p.placeholders?.length)
        ) {
          continue;
        }

        const heading = header ? textAt(0, c) : "";

        found.push({
          blockId: first.id,
          start: 0,
          end: 0,
          text: "",
          marker: "cell",
          key: `e:${first.id}`,
          labelHint: heading ? `${label} (${heading})` : label,
          context: heading
            ? `empty cell in the row "${label}", column "${heading}"`
            : `empty cell in the row "${label}"`,
        });
      }
    }
  }

  return found;
}
