import "server-only";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import { AiError } from "@/server/ai/model";
import { withLock } from "@/server/cache/redis";
import { requiredMissing, unresolvedRules } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { loadDocxPackage } from "@/server/docx/package";
import { buildDraft } from "@/server/draft/generate";
import { NotFound } from "@/server/http/responses";
import { mustGet, mustGetBytes } from "./access";

/** Generating the draft, and reading or saving the working DOCX the editor works on. */

export async function generateDraft(
  sessionId: string,
  documentId: string,
  input: { fieldsVersion: number },
  emit: (e: EventPayload) => void,
  signal: AbortSignal,
) {
  await withLock(`lx:lock:draft:${sessionId}:${documentId}`, 60, async () => {
    const doc = await mustGet(sessionId, documentId);
    if (doc.fieldsVersion !== input.fieldsVersion) throw new repo.StaleRevisionError("The answers");
    const missing = requiredMissing(doc.fieldState);
    const undecided = unresolvedRules(doc.fieldState);
    if (missing.length || undecided.length) {
      const parts = [...missing.map((f) => f.label), ...undecided.map((r) => `a decision for “${r.label}”`)];
      emit({ type: "error", code: "incomplete", message: `Still needed: ${parts.join(", ")}.`, retryable: false });
      return;
    }
    const bytes = await mustGetBytes(sessionId, documentId);
    await repo.beginDraft(sessionId, documentId, input.fieldsVersion);
    emit({ type: "draft_started", fieldsVersion: input.fieldsVersion });
    try {
      for await (const step of buildDraft(new Uint8Array(bytes.originalDocx), doc.fieldState)) {
        if (signal.aborted) throw new AiError("aborted", "Draft generation stopped.", true);
        if (step.type === "block") {
          emit({ type: "draft_block_ready", block: step.block });
          continue;
        }
        const saved = await repo.finishDraft(sessionId, documentId, {
          fieldsVersion: input.fieldsVersion,
          bytes: Buffer.from(step.bytes),
          state: { ...step.state, pendingClauses: [] },
        });
        emit({ type: "draft_complete", workingRevision: saved.workingRevision, fieldsVersion: saved.fieldsVersion });
      }
    } catch (err) {
      await repo.abandonDraft(sessionId, documentId);
      throw err;
    }
  });
}

export async function saveEditorDocx(sessionId: string, documentId: string, expectedRevision: number, bytes: Uint8Array) {
  await loadDocxPackage(bytes); // the editor's output must still be a valid, bounded package
  const saved = await repo.saveWorkingDocx(sessionId, documentId, expectedRevision, Buffer.from(bytes));
  return { workingRevision: saved.workingRevision, savedAt: saved.savedAt.toISOString() };
}

export async function readDocx(sessionId: string, documentId: string, which: "working" | "original") {
  const row = await mustGetBytes(sessionId, documentId);
  const bytes = which === "working" ? row.workingDocx : row.originalDocx;
  if (!bytes) throw new NotFound();
  return { bytes, filename: row.filename, title: row.title, workingRevision: row.workingRevision };
}
