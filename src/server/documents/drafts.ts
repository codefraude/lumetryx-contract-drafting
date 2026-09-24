import "server-only";
import type { DraftListItem } from "@/features/drafts/contracts";
import { detailsLeft } from "@/features/documents/progress";
import { analysisCacheKey } from "@/server/ai/analyze";
import { modelId } from "@/server/ai/model";
import { cacheDel } from "@/server/cache/redis";
import { inactiveFields, requiredMissing, unresolvedRules } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { loadDocxPackage } from "@/server/docx/package";
import { NotFound } from "@/server/http/responses";
import { blocksCacheKey, mustGet, mustGetBytes } from "./access";
import { documentView, getView, phaseOf } from "./views";

/** Saved drafts of this browser's anonymous identity (metadata only). */
export async function listDrafts(sessionId: string): Promise<DraftListItem[]> {
  const rows = await repo.listDocuments(sessionId);
  return rows.map((d) => ({
    id: d.id,
    title: d.title || d.filename.replace(/\.docx$/i, ""),
    filename: d.filename,
    savedAt: d.savedAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    phase: phaseOf(d),
    outstanding: requiredMissing(d.fieldState).length + unresolvedRules(d.fieldState).length,
    detailsLeft: detailsLeft(d.fieldState.fields, inactiveFields(d.fieldState)),
    decisionsLeft: unresolvedRules(d.fieldState).length,
    language: d.fieldState.language.document,
  }));
}

export async function renameDraft(sessionId: string, documentId: string, title: string) {
  if (!(await repo.renameDocument(sessionId, documentId, title.trim().slice(0, 120) || "Untitled draft"))) throw new NotFound();
  return getView(sessionId, documentId);
}

/** Deletes a draft and drops cached analyses of its template unless another draft of this browser still uses it. */
export async function deleteDraft(sessionId: string, documentId: string) {
  const gone = await repo.deleteDocument(sessionId, documentId);
  if (!gone) throw new NotFound();
  const stillUsed = (await repo.listDocuments(sessionId)).some((d) => d.templateHash === gone.templateHash);
  if (!stillUsed) await cacheDel([blocksCacheKey(sessionId, gone.templateHash), analysisCacheKey(sessionId, gone.templateHash, modelId())]);
}

/**
 * Saves a separate copy of a draft, optionally with the browser's current editor content (used to
 * keep local edits when another tab saved a newer version). Nothing in the source draft changes.
 */
export async function copyDraft(sessionId: string, documentId: string, editorBytes: Uint8Array | null) {
  const doc = await mustGet(sessionId, documentId);
  const bytes = await mustGetBytes(sessionId, documentId);
  if (editorBytes) await loadDocxPackage(editorBytes);
  const working = editorBytes ? Buffer.from(editorBytes) : bytes.workingDocx;
  const copy = await repo.createDocument({
    sessionId,
    filename: doc.filename,
    title: `${doc.title || doc.filename.replace(/\.docx$/i, "")} (copy)`.slice(0, 120),
    templateHash: doc.templateHash,
    originalDocx: Buffer.from(bytes.originalDocx),
    fieldState: doc.fieldState,
    analysis: doc.analysis,
    workingDocx: working ?? null,
    workingRevision: working ? 1 : 0,
    draftStatus: working ? "ready" : "none",
    draftFieldsVersion: working ? doc.draftFieldsVersion : null,
    fieldsVersion: doc.fieldsVersion,
  });
  await repo.copyMessages(documentId, copy.id);
  return documentView(sessionId, copy);
}
