import type { DraftBlock } from "@/features/documents/contracts/stream-events";
import { evaluateRule, keepsContent, omittedBlocks } from "@/server/clauses/evaluation";
import type { RenderedBlock } from "@/server/docx/blocks";
import { syncReferences, trackReferences } from "@/server/docx/clause-references";
import { ClauseStructureError, clauseHash, cutClause, locateClause, openBody } from "@/server/docx/clause-structure";
import { loadDocxPackage, serializePackage, type DocxPackage } from "@/server/docx/package";
import { ensureParaIds } from "@/server/docx/para-ids";
import { applyTextEdits, fillAndRender, indexBlocks } from "@/server/docx/render";
import { anchorsFrom, draftEdits, rebaseAnchors } from "@/server/fields/draft-edits";
import type { StructureIssue } from "@/features/documents/contracts/fields";
import type { FieldState, Rule } from "@/server/fields/state";

export const toDraftBlock = (b: RenderedBlock, filled: boolean): DraftBlock => ({
  id: b.id,
  partKind: b.partKind,
  kind: b.kind,
  headingLevel: b.headingLevel,
  numberLabel: b.numberLabel,
  indentLevel: b.numbering?.ilvl ?? 0,
  table: b.table,
  runs: b.runs,
  filled,
});

export type DraftStep = { type: "block"; block: DraftBlock } | { type: "done"; bytes: Uint8Array; state: FieldState };

/** Hashes of included clauses as they stand in `pkg`, keyed by rule id. */
export async function hashes(pkg: DocxPackage, rules: Rule[]): Promise<Map<string, string>> {
  const bd = await openBody(pkg);
  const out = new Map<string, string>();
  for (const r of rules) {
    if (r.applied !== "included") continue;
    const loc = locateClause(bd.body, r.paraIds);
    if (loc) out.set(r.id, clauseHash(loc.elements));
  }
  return out;
}

/**
 * Fills the immutable original template with confirmed values, yielding each block as soon as
 * it has been processed. Excluded clauses and `[[IF]]` marker paragraphs are left out; clause
 * references are brought in line with the resulting numbering. The final bytes are the exact
 * document that becomes editable/exported.
 */
export async function* buildDraft(original: Uint8Array, state: FieldState): AsyncGenerator<DraftStep> {
  const pkg = await loadDocxPackage(original);
  const paraIds = await ensureParaIds(pkg);
  const template = await indexBlocks(pkg);
  const omit = omittedBlocks(state);
  const edits = draftEdits(state.fields, state.language.document, omit);
  const filledBlocks = new Set(edits.filter((e) => e.value !== e.expected).map((e) => e.blockId));
  let applied: Awaited<ReturnType<typeof applyTextEdits>> = [];
  for await (const ev of fillAndRender(pkg, edits, omit)) {
    if (ev.type === "block") {
      yield { type: "block", block: toDraftBlock(ev.block, filledBlocks.has(ev.block.id)) };
      // Yield to the event loop so each block is flushed as its own network write.
      await new Promise<void>((r) => setImmediate(r));
      continue;
    }
    applied = ev.applied;
  }

  const issues: StructureIssue[] = [];
  const bd = await openBody(pkg);
  const rules: Rule[] = state.rules.map((r) => ({ ...r, paraIds: r.blockIds.map((id) => paraIds.get(id)).filter((x): x is string => Boolean(x)), removedXml: null, contentHash: null }));
  for (const r of rules) {
    for (const id of r.markerBlockIds) {
      const loc = locateClause(bd.body, [paraIds.get(id)!]);
      if (loc) cutClause(bd, loc.elements);
    }
    const keep = keepsContent(evaluateRule(r, state.fields).state);
    r.applied = keep ? "included" : "excluded";
    if (keep) continue;
    const loc = locateClause(bd.body, r.paraIds);
    if (!loc) continue;
    try {
      const cut = cutClause(bd, loc.elements);
      r.slot = cut.slot;
      cut.brokenRefs.forEach((b) => issues.push({ ruleId: r.id, message: `A Word cross-reference (${b}) points into “${r.label}”, which is excluded.` }));
    } catch (err) {
      if (!(err instanceof ClauseStructureError)) throw err;
      r.applied = "included";
      issues.push({ ruleId: r.id, message: `“${r.label}” was kept: ${err.message}` });
    }
  }
  bd.commit();

  let anchors = anchorsFrom(state.fields, applied, paraIds);
  const after = await indexBlocks(pkg);
  const refs = syncReferences(trackReferences(template), after);
  if (refs.edits.length) anchors = rebaseAnchors(anchors, await applyTextEdits(pkg, refs.edits), after);
  refs.issues.forEach((message) => issues.push({ ruleId: null, message }));
  const h = await hashes(pkg, rules);
  for (const r of rules) r.contentHash = h.get(r.id) ?? null;
  yield { type: "done", bytes: await serializePackage(pkg), state: { ...state, rules, draftAnchors: anchors, references: refs.references, structureIssues: issues } };
}

/** Renders a draft without streaming (used for the comparison preview before a draft exists). */
export async function renderDraft(original: Uint8Array, state: FieldState): Promise<{ bytes: Uint8Array; state: FieldState }> {
  for await (const step of buildDraft(original, state)) if (step.type === "done") return { bytes: step.bytes, state: step.state };
  throw new Error("draft rendering produced no result");
}
