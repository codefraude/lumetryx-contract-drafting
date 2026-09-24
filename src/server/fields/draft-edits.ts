import type { DocLanguage, Field } from "@/features/documents/contracts/fields";
import type { Block } from "@/server/docx/blocks";
import type { TextEdit } from "@/server/docx/edit";
import type { AppliedEdit } from "@/server/docx/render";
import { renderAt } from "./normalize";
import type { DraftAnchor, FieldState } from "./state";

/**
 * Edits that turn the template into a draft. Confirmed values are written, rendered for each
 * occurrence's language. Occurrences still unanswered get an identity edit so that their marker
 * position is anchored and a later answer can be written into the draft. Omitted blocks (excluded
 * clauses, condition markers) are skipped: they are removed from the draft.
 */
export function draftEdits(fields: Field[], docLang: DocLanguage, omit: ReadonlySet<string> = new Set()): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const f of fields) {
    for (const o of f.occurrences) {
      if (omit.has(o.blockId)) continue;
      const v = renderAt(f, o.lang, docLang);
      const value = v === null ? o.expected : o.mode === "insert" ? ` ${v}` : v;
      edits.push({ blockId: o.blockId, start: o.start, end: o.end, expected: o.expected, value });
    }
  }
  return edits;
}

/** Anchors for every occurrence written by `draftEdits`, keyed by field, located by paragraph id. */
export function anchorsFrom(fields: Field[], applied: AppliedEdit[], paraIds: ReadonlyMap<string, string>): FieldState["draftAnchors"] {
  const anchors: FieldState["draftAnchors"] = {};
  for (const f of fields) {
    for (const o of f.occurrences) {
      const hit = applied.find((a) => a.edit.blockId === o.blockId && a.edit.start === o.start && a.edit.end === o.end);
      if (hit) (anchors[f.id] ??= []).push({ ...hit.result, paraId: paraIds.get(o.blockId) ?? null, lang: o.lang, mode: o.mode });
    }
  }
  return anchors;
}

export type AnchoredEdit = TextEdit & { fieldId: string; anchor: number };
export type AnchoredUpdate = { edits: AnchoredEdit[]; conflicts: string[] };

/**
 * After a draft exists, a changed answer is applied only where the previous value (or the still
 * unfilled marker) is exactly where we put it. Anything the user edited is reported as a conflict,
 * not overwritten. Anchors whose paragraph is absent (their clause is currently excluded) are
 * skipped; they are brought up to date if the clause is restored.
 */
export function anchoredUpdates(state: FieldState, changed: Field[], currentBlocks: Block[]): AnchoredUpdate {
  const byPara = new Map<string, Block>();
  for (const b of currentBlocks) if (b.paraId) byPara.set(b.paraId, b);
  const byId = new Map(currentBlocks.map((b) => [b.id, b]));
  const edits: AnchoredEdit[] = [];
  const conflicts: string[] = [];
  for (const f of changed) {
    const anchors = state.draftAnchors[f.id] ?? [];
    const present = anchors.flatMap((a, i) => {
      const b = a.paraId ? byPara.get(a.paraId) : byId.get(a.blockId);
      return b ? [{ a, i, b }] : [];
    });
    if (!present.length) continue;
    if (!present.every((x) => x.b.text.slice(x.a.start, x.a.end) === x.a.text)) {
      conflicts.push(f.id);
      continue;
    }
    for (const { a, i, b } of present) {
      const v = renderAt(f, a.lang, state.language.document);
      if (v === null) continue;
      const value = a.mode === "insert" ? ` ${v}` : v;
      if (value !== a.text) edits.push({ blockId: b.id, start: a.start, end: a.end, expected: a.text, value, fieldId: f.id, anchor: i });
    }
  }
  return { edits, conflicts };
}

/**
 * Keeps every anchor correct after server-side text edits: edited anchors take their new range and
 * text, and anchors later in the same paragraph shift by the length change of the edits before them.
 */
export function rebaseAnchors(anchors: FieldState["draftAnchors"], applied: AppliedEdit[], blocks: Block[]): FieldState["draftAnchors"] {
  const paraOf = new Map(blocks.map((b) => [b.id, b.paraId]));
  const byPara = new Map<string, AppliedEdit[]>();
  for (const a of applied) {
    const key = paraOf.get(a.edit.blockId) ?? a.edit.blockId;
    byPara.set(key, [...(byPara.get(key) ?? []), a]);
  }
  const out: FieldState["draftAnchors"] = {};
  for (const [fieldId, list] of Object.entries(anchors)) {
    out[fieldId] = list.map((a): DraftAnchor => {
      const edits = byPara.get(a.paraId ?? a.blockId);
      if (!edits) return a;
      const own = edits.find((e) => e.edit.start === a.start && e.edit.end === a.end && e.edit.expected === a.text);
      if (own) return { ...a, blockId: own.result.blockId, start: own.result.start, end: own.result.end, text: own.result.text };
      const delta = edits.filter((e) => e.edit.end <= a.start).reduce((n, e) => n + e.result.text.length - (e.edit.end - e.edit.start), 0);
      return delta ? { ...a, start: a.start + delta, end: a.end + delta } : a;
    });
  }
  return out;
}
