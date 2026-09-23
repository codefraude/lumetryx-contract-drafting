import { applyTextEdits, ensureParaIds, fillAndRender, indexBlocks, serializeXml, type RenderedBlock } from "./docx/ooxml";
import { loadDocxPackage, serializePackage, type DocxPackage } from "./docx/package";
import { ClauseStructureError, clauseHash, cutClause, documentRelationshipIds, insertClause, locateClause, openBody, relationshipIds, syncReferences, trackReferences } from "./docx/structure";
import { anchoredUpdates, anchorsFrom, draftEdits, rebaseAnchors } from "./fields/build";
import { evaluateRule, inactiveFields, keepsContent, omittedBlocks } from "./fields/rules";
import { outstandingFields, type Field, type FieldState, type Rule, type StructureIssue } from "./fields/types";
import type { DraftBlock } from "./events";

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
async function hashes(pkg: DocxPackage, rules: Rule[]): Promise<Map<string, string>> {
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

/** One clause filled from the template with current answers, for putting back a clause that was excluded when the draft was made. */
async function templateClause(original: Uint8Array, state: FieldState, rule: Rule) {
  const pkg = await loadDocxPackage(original);
  const paraIds = await ensureParaIds(pkg);
  const inClause = new Set(rule.blockIds);
  const scoped = state.fields
    .filter((f) => f.occurrences.some((o) => inClause.has(o.blockId)))
    .map((f) => ({ ...f, occurrences: f.occurrences.filter((o) => inClause.has(o.blockId)) }));
  const applied = await applyTextEdits(pkg, draftEdits(scoped, state.language.document));
  const bd = await openBody(pkg);
  const loc = locateClause(bd.body, rule.paraIds);
  if (!loc) throw new ClauseStructureError("the clause could not be found in the template");
  return { xml: loc.elements.map((el) => serializeXml(el)).join(""), anchors: anchorsFrom(scoped, applied, paraIds) };
}

export interface ClauseChange {
  ruleId: string;
  label: string;
  action: "exclude" | "include";
  reason: string;
}

export interface DraftUpdate {
  /** New working bytes, or null when nothing changed. */
  bytes: Uint8Array | null;
  state: FieldState;
  /** Changed answers written into the draft. */
  appliedFields: string[];
  /** Changed answers not written because the user edited the text where they appear. */
  conflicts: string[];
  clauseChanges: ClauseChange[];
  /** Clause changes waiting for the user because the clause was edited by hand. */
  needsConfirmation: ClauseChange[];
}

/**
 * Brings an existing (possibly hand-edited) working draft in line with the current answers and
 * clause decisions, without regenerating it. Only whole clauses are moved and only untouched
 * values are rewritten; a clause the user edited is removed only after explicit confirmation,
 * and its edited version is kept so that re-including it restores those edits.
 */
export async function updateWorkingDraft(input: { working: Uint8Array; original: Uint8Array; state: FieldState; changedFieldIds: string[]; confirmEdited?: ReadonlySet<string> }): Promise<DraftUpdate> {
  const { original, changedFieldIds } = input;
  const confirmEdited = input.confirmEdited ?? new Set<string>();
  const pkg = await loadDocxPackage(input.working);
  let state: FieldState = { ...input.state, rules: input.state.rules.map((r) => ({ ...r })) };
  const before = await hashes(pkg, state.rules);
  const clean = new Set(state.rules.filter((r) => r.applied === "included" && before.get(r.id) === r.contentHash).map((r) => r.id));
  const issues: StructureIssue[] = [];
  const clauseChanges: ClauseChange[] = [];
  const needsConfirmation: ClauseChange[] = [];
  const restored = new Set<string>();
  let changed = false;

  const bd = await openBody(pkg);
  const rels = await documentRelationshipIds(pkg);
  for (const r of state.rules) {
    if (r.applied === null) continue;
    const ev = evaluateRule(r, state.fields);
    if (ev.state === "unresolved") continue;
    const want = keepsContent(ev.state) ? "included" : "excluded";
    if (want === r.applied) continue;
    const change: ClauseChange = { ruleId: r.id, label: r.label, action: want === "included" ? "include" : "exclude", reason: ev.reason };
    if (want === "excluded") {
      const loc = locateClause(bd.body, r.paraIds);
      if (!loc) {
        // Already gone (deleted by hand): record it so a later include restores it from the template.
        Object.assign(r, { applied: "excluded", removedXml: null });
        clauseChanges.push(change);
        continue;
      }
      if (!clean.has(r.id) && !confirmEdited.has(r.id)) {
        needsConfirmation.push({ ...change, reason: `${ev.reason}. You edited this clause, so it is only removed if you confirm; your edited version is kept and comes back if the clause is included again.` });
        continue;
      }
      try {
        const cut = cutClause(bd, loc.elements);
        Object.assign(r, { applied: "excluded", removedXml: cut.xml, slot: cut.slot });
        cut.brokenRefs.forEach((b) => issues.push({ ruleId: r.id, message: `A Word cross-reference (${b}) points into “${r.label}”, which is now excluded.` }));
        clauseChanges.push(change);
        changed = true;
      } catch (err) {
        if (!(err instanceof ClauseStructureError)) throw err;
        issues.push({ ruleId: r.id, message: `“${r.label}” could not be removed: ${err.message}` });
      }
      continue;
    }
    try {
      let xml = r.removedXml;
      if (!xml) {
        const t = await templateClause(original, state, r);
        xml = t.xml;
        const inClause = new Set(r.paraIds);
        const anchors = { ...state.draftAnchors };
        for (const [fid, list] of Object.entries(t.anchors)) anchors[fid] = [...(anchors[fid] ?? []).filter((a) => !a.paraId || !inClause.has(a.paraId)), ...list];
        state = { ...state, draftAnchors: anchors };
      }
      if (relationshipIds(xml).some((id) => !rels.has(id))) throw new ClauseStructureError("it refers to images or links that are no longer in the document");
      insertClause(bd, xml, r.slot);
      Object.assign(r, { applied: "included", removedXml: null });
      restored.add(r.id);
      clauseChanges.push(change);
      changed = true;
    } catch (err) {
      if (!(err instanceof ClauseStructureError)) throw err;
      issues.push({ ruleId: r.id, message: `“${r.label}” could not be put back: ${err.message}` });
    }
  }
  if (changed) bd.commit();

  // Write changed answers, plus current values into restored clauses.
  let blocks = await indexBlocks(pkg);
  const restoredParas = new Set(state.rules.filter((r) => restored.has(r.id)).flatMap((r) => r.paraIds));
  const touched = state.fields.filter((f) => changedFieldIds.includes(f.id) || (state.draftAnchors[f.id] ?? []).some((a) => a.paraId && restoredParas.has(a.paraId)));
  const upd = anchoredUpdates(state, touched, blocks);
  const conflicts = upd.conflicts.filter((id) => changedFieldIds.includes(id));
  let anchors = state.draftAnchors;
  if (upd.edits.length) {
    anchors = rebaseAnchors(anchors, await applyTextEdits(pkg, upd.edits), blocks);
    changed = true;
    blocks = await indexBlocks(pkg);
  }
  const refs = syncReferences(state.references, blocks);
  if (refs.edits.length) {
    anchors = rebaseAnchors(anchors, await applyTextEdits(pkg, refs.edits), blocks);
    changed = true;
  }
  refs.issues.forEach((message) => issues.push({ ruleId: null, message }));

  // Clauses the server wrote (or that were untouched) stay "clean"; hand-edited ones keep their old hash.
  const after = await hashes(pkg, state.rules);
  for (const r of state.rules) if (r.applied === "included" && (clean.has(r.id) || restored.has(r.id))) r.contentHash = after.get(r.id) ?? r.contentHash;
  const appliedFields = [...new Set(upd.edits.map((e) => e.fieldId))].filter((id) => changedFieldIds.includes(id));
  state = { ...state, draftAnchors: anchors, references: refs.references, structureIssues: issues };
  return { bytes: changed ? await serializePackage(pkg) : null, state, appliedFields, conflicts, clauseChanges, needsConfirmation };
}

/** Required answers still missing (ignoring fields that only live in excluded or undecided clauses). */
export const requiredMissing = (state: FieldState): Field[] => outstandingFields(state.fields, inactiveFields(state));
