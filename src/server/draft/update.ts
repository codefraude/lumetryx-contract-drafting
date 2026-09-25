import type { ClauseChange } from "@/features/documents/contracts/stream-events";
import { evaluateRule, keepsContent } from "@/server/clauses/evaluation";
import { syncReferences } from "@/server/docx/clause-references";
import {
  ClauseStructureError,
  cutClause,
  documentRelationshipIds,
  insertClause,
  locateClause,
  openBody,
  relationshipIds,
} from "@/server/docx/clause-structure";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import { ensureParaIds } from "@/server/docx/para-ids";
import { applyTextEdits, indexBlocks } from "@/server/docx/render";
import { serializeXml } from "@/server/docx/xml";
import { anchoredUpdates, anchorsFrom, draftEdits, rebaseAnchors } from "@/server/fields/draft-edits";
import type { StructureIssue } from "@/features/documents/contracts/fields";
import type { FieldState, Rule } from "@/server/fields/state";
import { hashes } from "./generate";

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
 * Brings a hand-edited working draft in line with the current answers and clauses, without regenerating it.
 * Only untouched values are rewritten; an edited clause goes only once confirmed, and returns with its edits.
 */
export async function updateWorkingDraft(input: {
  working: Uint8Array;
  original: Uint8Array;
  state: FieldState;
  changedFieldIds: string[];
  confirmEdited?: ReadonlySet<string>;
}): Promise<DraftUpdate> {
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
        needsConfirmation.push({
          ...change,
          reason: `${ev.reason}. You edited this clause, so it is only removed if you confirm; your edited version is kept and comes back if the clause is included again.`,
        });
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
        for (const [fid, list] of Object.entries(t.anchors))
          anchors[fid] = [...(anchors[fid] ?? []).filter((a) => !a.paraId || !inClause.has(a.paraId)), ...list];
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
  const touched = state.fields.filter(
    (f) => changedFieldIds.includes(f.id) || (state.draftAnchors[f.id] ?? []).some((a) => a.paraId && restoredParas.has(a.paraId)),
  );
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
