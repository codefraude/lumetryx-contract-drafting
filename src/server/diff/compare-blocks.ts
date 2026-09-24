import { DIFF_SCHEMA_VERSION, type DiffItem, type DiffResult } from "@/features/comparison/contracts";
import type { Field } from "@/features/documents/contracts/fields";
import { evaluateRule } from "@/server/clauses/evaluation";
import type { RenderedBlock } from "@/server/docx/blocks";
import type { Rule } from "@/server/fields/state";
import { alignBlocks } from "./align-blocks";
import { formattingNotes, location, structureNotes } from "./change-notes";
import { diffTokens } from "./token-diff";

/**
 * Read-only comparison of the uploaded template with a snapshot of the current draft.
 *
 * Coverage (deliberately explicit): paragraph/heading/table-cell text at word level; bold,
 * italic and underline; paragraph style, heading level and list level. Not compared: fonts,
 * sizes, colours, spacing, alignment, borders, images, page layout. Blocks are aligned by Word's
 * paragraph ids (kept by the editor), then by text for anything left over, so serialization
 * differences (namespace order, run splitting, generated ids) never show up as changes.
 */

export interface CompareContext {
  fields: Field[];
  rules: Rule[];
}

export function compareBlocks(original: RenderedBlock[], current: RenderedBlock[], ctx: CompareContext): DiffResult {
  const oBody = original.filter((b) => b.partKind === "body");
  const cBody = current.filter((b) => b.partKind === "body");
  const pairs = alignBlocks(original, current);
  const pairedC = new Set(pairs.map(([, j]) => j));
  const items: DiffItem[] = [];
  const counts = { modified: 0, added: 0, deleted: 0, filled: 0, clauses: 0 };
  let seq = 0;
  const id = () => `d${seq++}`;

  const occurrences = new Map<string, { start: number; end: number; label: string }[]>();
  for (const f of ctx.fields)
    for (const o of f.occurrences) occurrences.set(o.blockId, [...(occurrences.get(o.blockId) ?? []), { start: o.start, end: o.end, label: f.label }]);

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
        markersItem = {
          id: id(),
          type: "markers_removed",
          location: "Conditional clauses",
          segments: [],
          notes: ["Condition markers such as [[IF …]] are control lines; they never appear in a draft."],
        };
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
        g = {
          id: id(),
          type: "clause_excluded",
          location: `Conditional clause “${rule.label}”`,
          segments: [],
          notes: [ev.state === "excluded" ? `Excluded: ${ev.reason}` : `Not in the draft (${ev.reason})`],
        };
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
    queueDeleted({
      id: id(),
      type: "deleted",
      location: location(b, oBody),
      segments: [{ op: "del", text: b.text }],
      notes: b.table ? ["Table cell removed"] : [],
    });
  });

  const emit = (list: DiffItem[] | undefined) => list?.forEach((x) => items.push(x));
  emit(deletedAt.get(-1));
  const oByC = new Map<number, RenderedBlock>();
  for (const [i, j] of pairs) {
    const o = original[i];
    if (o) oByC.set(j, o);
  }
  current.forEach((c, j) => {
    const o = oByC.get(j);
    if (!o) {
      if (!pairedC.has(j)) {
        if (!c.text.trim()) emptyChanges.added++;
        else {
          counts.added++;
          items.push({
            id: id(),
            type: "added",
            location: location(c, cBody),
            segments: [{ op: "ins", text: c.text }],
            notes: c.table ? ["Table cell added"] : [],
          });
        }
      }
      return;
    }
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
    items.push({
      id: id(),
      type: "clause_included",
      location: `Conditional clause “${r.label}”`,
      segments: [],
      notes: [ev.state === "included" ? `Included: ${ev.reason}` : `In the draft (${ev.reason})`],
    });
  }
  if (emptyChanges.added || emptyChanges.deleted) {
    items.push({
      id: id(),
      type: "modified",
      location: "Spacing",
      segments: [],
      notes: [`${emptyChanges.added} empty paragraph(s) added, ${emptyChanges.deleted} removed`],
    });
    counts.modified++;
  }
  return { version: DIFF_SCHEMA_VERSION, items, counts };
}
