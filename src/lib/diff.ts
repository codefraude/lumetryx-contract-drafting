import type { RenderedBlock, RunSpan } from "./docx/ooxml";
import { evaluateRule } from "./fields/rules";
import type { Field, Rule } from "./fields/types";

/**
 * Read-only comparison of the uploaded template with a snapshot of the current draft.
 *
 * Coverage (deliberately explicit): paragraph/heading/table-cell text at word level; bold,
 * italic and underline; paragraph style, heading level and list level. Not compared: fonts,
 * sizes, colours, spacing, alignment, borders, images, page layout. Blocks are aligned by Word's
 * paragraph ids (kept by the editor), then by text for anything left over, so serialization
 * differences (namespace order, run splitting, generated ids) never show up as changes.
 */

export const DIFF_SCHEMA_VERSION = 1;

export type Segment = { op: "eq" | "ins" | "del"; text: string };

export interface DiffItem {
  id: string;
  type: "modified" | "added" | "deleted" | "clause_excluded" | "clause_included" | "markers_removed";
  location: string;
  /** Word-level before/after for modified blocks; whole text for added/deleted. */
  segments: Segment[];
  notes: string[];
}

export interface DiffResult {
  version: number;
  items: DiffItem[];
  counts: { modified: number; added: number; deleted: number; filled: number; clauses: number };
}

// ---------- token diff ----------

/** Words, spaces and punctuation; template placeholders ({{x}}, [X]) stay whole so a filled value reads as one replacement. */
const tokenize = (s: string) => s.match(/\{\{[^}]*\}\}|\[[^\]]*\]|_{4,}|\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Longest-common-subsequence diff over tokens; exact comparison (accents, digits and punctuation all count). */
export function diffTokens(a: string, b: string): Segment[] {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250_000) return merge([{ op: "del", text: a }, { op: "ins", text: b }]);
  const n = x.length;
  const m = y.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = x[i] === y[j] ? dp[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(dp[(i + 1) * (m + 1) + j]!, dp[i * (m + 1) + j + 1]!);
  const out: Segment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: "eq", text: x[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!) out.push({ op: "del", text: x[i++]! });
    else out.push({ op: "ins", text: y[j++]! });
  }
  while (i < n) out.push({ op: "del", text: x[i++]! });
  while (j < m) out.push({ op: "ins", text: y[j++]! });
  return merge(out);
}

function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const prev = out.at(-1);
    if (prev && prev.op === s.op) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

// ---------- alignment ----------

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size && !y.size) return 1;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(x.size, y.size);
}

type Pair = [number, number];

/** Longest increasing subsequence of pairs by current index: drops crossing matches (moved paragraphs become delete + add). */
function monotonic(pairs: Pair[]): Pair[] {
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  });
  const out: Pair[] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]!) out.unshift(pairs[k]!);
  return out;
}

function align(o: RenderedBlock[], c: RenderedBlock[]): Pair[] {
  const cIndex = new Map<string, number>();
  c.forEach((b, j) => b.paraId && !cIndex.has(b.paraId) && cIndex.set(b.paraId, j));
  const byId: Pair[] = [];
  o.forEach((b, i) => {
    const j = b.paraId ? cIndex.get(b.paraId) : undefined;
    if (j !== undefined) byId.push([i, j]);
  });
  const anchors = monotonic(byId);
  const pairs: Pair[] = [];
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of [...anchors, [o.length, c.length] as Pair]) {
    // Fallback inside each gap: exact-text LCS first, then similar blocks in order.
    const go = o.slice(pi, ai);
    const gc = c.slice(pj, aj);
    const dp: number[][] = Array.from({ length: go.length + 1 }, () => new Array<number>(gc.length + 1).fill(0));
    for (let i = go.length - 1; i >= 0; i--) for (let j = gc.length - 1; j >= 0; j--) dp[i]![j] = go[i]!.text === gc[j]!.text ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    const leftO: number[] = [];
    const leftC: number[] = [];
    while (i < go.length && j < gc.length) {
      if (go[i]!.text === gc[j]!.text) {
        pairs.push([pi + i++, pj + j++]);
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) leftO.push(pi + i++);
      else leftC.push(pj + j++);
    }
    while (i < go.length) leftO.push(pi + i++);
    while (j < gc.length) leftC.push(pj + j++);
    let k = 0;
    for (const oi of leftO) {
      const found = leftC.findIndex((cj, idx) => idx >= k && c[cj]!.kind === o[oi]!.kind && similarity(o[oi]!.text, c[cj]!.text) >= 0.4);
      if (found >= 0) {
        pairs.push([oi, leftC[found]!]);
        k = found + 1;
      }
    }
    if (ai < o.length) pairs.push([ai, aj]);
    pi = ai + 1;
    pj = aj + 1;
  }
  return pairs.sort((a, b) => a[1] - b[1]);
}

// ---------- formatting ----------

type Flags = string;
function charFlags(runs: RunSpan[]): Flags[] {
  const out: Flags[] = [];
  for (const r of runs) for (let k = 0; k < r.text.length; k++) out.push(`${r.bold ? "b" : ""}${r.italic ? "i" : ""}${r.underline ? "u" : ""}`);
  return out;
}

const FLAG_NAMES: Record<string, string> = { b: "bold", i: "italic", u: "underline" };

/** Formatting changes on text present in both versions (e.g. “Bold added to ‘Strictly’”), word by word. */
function formattingNotes(o: RenderedBlock, c: RenderedBlock, segs: Segment[]): string[] {
  const fo = charFlags(o.runs);
  const fc = charFlags(c.runs);
  const notes = new Map<string, string[]>();
  let io = 0;
  let ic = 0;
  let last: string | null = null;
  for (const s of segs) {
    if (s.op !== "eq") {
      if (s.op === "del") io += s.text.length;
      else ic += s.text.length;
      last = null;
      continue;
    }
    for (const tok of tokenize(s.text)) {
      let key: string | null = null;
      if (tok.trim()) {
        for (const f of ["b", "i", "u"]) {
          const all = (flags: Flags[], at: number) => Array.from({ length: tok.length }, (_, k) => flags[at + k]?.includes(f) ?? false);
          const was = all(fo, io).every(Boolean);
          const now = all(fc, ic).every(Boolean);
          if (was !== now) key = `${FLAG_NAMES[f]} ${now ? "added to" : "removed from"}`;
        }
        if (key) {
          const list = notes.get(key) ?? [];
          // Consecutive words with the same change read as one phrase.
          if (last === key && list.length) list[list.length - 1] += ` ${tok}`;
          else list.push(tok);
          notes.set(key, list);
        }
        last = key;
      }
      io += tok.length;
      ic += tok.length;
    }
  }
  return [...notes].map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)} ${v.map((x) => `“${x.slice(0, 60)}”`).join(", ")}`);
}

function structureNotes(o: RenderedBlock, c: RenderedBlock): string[] {
  const notes: string[] = [];
  if ((o.styleId ?? "") !== (c.styleId ?? "")) notes.push(`Paragraph style ${o.styleId ?? "Normal"} → ${c.styleId ?? "Normal"}`);
  else if (o.headingLevel !== c.headingLevel) notes.push(`Heading level ${o.headingLevel ?? "none"} → ${c.headingLevel ?? "none"}`);
  const lo = o.numbering?.ilvl;
  const lc = c.numbering?.ilvl;
  if (lo !== lc) notes.push(lo === undefined ? "Became a list item" : lc === undefined ? "No longer a list item" : `List level ${lo + 1} → ${lc + 1}`);
  return notes;
}

// ---------- locations ----------

function location(b: RenderedBlock, body: RenderedBlock[]): string {
  if (b.partKind !== "body") return b.partKind === "header" ? "Header" : "Footer";
  if (b.table) return `Table ${b.table.table + 1}, row ${b.table.row + 1}, column ${b.table.col + 1}`;
  if (b.numberLabel && /\d/.test(b.numberLabel)) return `Clause ${b.numberLabel.replace(/[.)]+$/, "")}`;
  if (b.kind === "heading") return `Heading “${b.text.trim().slice(0, 40)}”`;
  return `Paragraph ${body.indexOf(b) + 1}`;
}

// ---------- compare ----------

export interface CompareContext {
  fields: Field[];
  rules: Rule[];
}

export function compareBlocks(original: RenderedBlock[], current: RenderedBlock[], ctx: CompareContext): DiffResult {
  const oBody = original.filter((b) => b.partKind === "body");
  const cBody = current.filter((b) => b.partKind === "body");
  const pairs = align(original, current);
  const pairedC = new Set(pairs.map(([, j]) => j));
  const items: DiffItem[] = [];
  const counts = { modified: 0, added: 0, deleted: 0, filled: 0, clauses: 0 };
  let seq = 0;
  const id = () => `d${seq++}`;

  const occurrences = new Map<string, { start: number; end: number; label: string }[]>();
  for (const f of ctx.fields) for (const o of f.occurrences) occurrences.set(o.blockId, [...(occurrences.get(o.blockId) ?? []), { start: o.start, end: o.end, label: f.label }]);

  // Deleted blocks grouped by the conditional clause (or control markers) they belong to.
  const clauseOf = new Map<string, Rule>();
  const markerIds = new Set<string>();
  for (const r of ctx.rules) {
    r.blockIds.forEach((b) => clauseOf.set(b, r));
    r.markerBlockIds.forEach((b) => markerIds.add(b));
  }
  const grouped = new Map<string, DiffItem>();
  let markersItem: DiffItem | null = null;
  const deletedAt = new Map<number, DiffItem[]>();
  const emptyChanges = { added: 0, deleted: 0 };
  let lastC = -1;
  const queueDeleted = (item: DiffItem) => deletedAt.set(lastC, [...(deletedAt.get(lastC) ?? []), item]);

  const cByO = new Map(pairs);
  original.forEach((b, i) => {
    const j = cByO.get(i);
    if (j !== undefined) {
      lastC = j;
      return;
    }
    if (markerIds.has(b.id)) {
      if (!markersItem) {
        markersItem = { id: id(), type: "markers_removed", location: "Conditional clauses", segments: [], notes: ["Condition markers such as [[IF …]] are control lines; they never appear in a draft."] };
        queueDeleted(markersItem);
      }
      markersItem.segments.push({ op: "del", text: `${markersItem.segments.length ? "\n" : ""}${b.text.trim()}` });
      return;
    }
    const rule = clauseOf.get(b.id);
    if (rule && rule.applied !== "included") {
      let g = grouped.get(rule.id);
      if (!g) {
        const ev = evaluateRule(rule, ctx.fields);
        g = { id: id(), type: "clause_excluded", location: `Conditional clause “${rule.label}”`, segments: [], notes: [ev.state === "excluded" ? `Excluded: ${ev.reason}` : `Not in the draft (${ev.reason})`] };
        grouped.set(rule.id, g);
        queueDeleted(g);
        counts.clauses++;
      }
      if (b.text.trim()) g.segments.push({ op: "del", text: `${g.segments.length ? "\n" : ""}${b.text}` });
      return;
    }
    if (!b.text.trim()) {
      emptyChanges.deleted++;
      return;
    }
    counts.deleted++;
    queueDeleted({ id: id(), type: "deleted", location: location(b, oBody), segments: [{ op: "del", text: b.text }], notes: b.table ? ["Table cell removed"] : [] });
  });

  const emit = (list: DiffItem[] | undefined) => list?.forEach((x) => items.push(x));
  emit(deletedAt.get(-1));
  const oByC = new Map(pairs.map(([i, j]) => [j, i]));
  current.forEach((c, j) => {
    const i = oByC.get(j);
    if (i === undefined) {
      if (!pairedC.has(j)) {
        if (!c.text.trim()) emptyChanges.added++;
        else {
          counts.added++;
          items.push({ id: id(), type: "added", location: location(c, cBody), segments: [{ op: "ins", text: c.text }], notes: c.table ? ["Table cell added"] : [] });
        }
      }
      return;
    }
    const o = original[i]!;
    const segs = o.text === c.text ? [{ op: "eq" as const, text: c.text }] : diffTokens(o.text, c.text);
    const notes = [...structureNotes(o, c), ...formattingNotes(o, c, segs)];
    if (o.text !== c.text || notes.length) {
      // Which of the template's placeholders were replaced in this block.
      const filled = new Set<string>();
      let pos = 0;
      for (const s of segs) {
        if (s.op === "ins") continue;
        const end = pos + s.text.length;
        if (s.op === "del") for (const occ of occurrences.get(o.id) ?? []) if (occ.start < end && occ.end > pos) filled.add(occ.label);
        pos = end;
      }
      for (const occ of occurrences.get(o.id) ?? []) if (occ.start === occ.end && o.text !== c.text) filled.add(occ.label);
      if (filled.size) {
        counts.filled += filled.size;
        notes.unshift(`Filled: ${[...filled].join(", ")}`);
      }
      counts.modified++;
      const rule = clauseOf.get(o.id);
      items.push({ id: id(), type: "modified", location: location(c, cBody) + (rule ? ` (in “${rule.label}”)` : ""), segments: segs, notes });
    }
    emit(deletedAt.get(j));
  });

  // Conditional clauses that are in the draft, with the reason, for completeness.
  for (const r of ctx.rules) {
    if (r.applied !== "included" || !r.confirmed || r.dismissed) continue;
    const ev = evaluateRule(r, ctx.fields);
    items.push({ id: id(), type: "clause_included", location: `Conditional clause “${r.label}”`, segments: [], notes: [ev.state === "included" ? `Included: ${ev.reason}` : `In the draft (${ev.reason})`] });
  }
  if (emptyChanges.added || emptyChanges.deleted) {
    items.push({ id: id(), type: "modified", location: "Spacing", segments: [], notes: [`${emptyChanges.added} empty paragraph(s) added, ${emptyChanges.deleted} removed`] });
    counts.modified++;
  }
  return { version: DIFF_SCHEMA_VERSION, items, counts };
}
