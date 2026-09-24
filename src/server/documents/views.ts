import "server-only";
import type { DocumentView, Phase, RuleView } from "@/features/documents/contracts/document-view";
import { evaluateRule, inactiveFields, requiredMissing, unresolvedRules } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { replyLanguage } from "@/server/fields/lang";
import type { FieldState } from "@/server/fields/state";
import { mustGet } from "./access";

/** The document view the browser receives, built from the persisted draft. */

/** A generation older than this with no completion was interrupted (the lock TTL is 60 s). */
const INTERRUPTED_AFTER_MS = 90_000;

export function phaseOf(doc: { draftStatus: repo.DocumentSummary["draftStatus"]; updatedAt: Date; fieldState: FieldState }): Phase {
  if (doc.draftStatus === "generating") return Date.now() - doc.updatedAt.getTime() > INTERRUPTED_AFTER_MS ? "interrupted" : "generating";
  if (doc.draftStatus === "ready") return "draft";
  return requiredMissing(doc.fieldState).length || unresolvedRules(doc.fieldState).length ? "interview" : "ready";
}

function ruleViews(state: FieldState): RuleView[] {
  return state.rules.map((r) => {
    const ev = evaluateRule(r, state.fields);
    return {
      id: r.id,
      label: r.label,
      source: r.source,
      condition: r.condition,
      confirmed: r.confirmed,
      dismissed: r.dismissed,
      override: r.override,
      evidence: r.evidence,
      state: ev.state,
      reason: ev.reason,
      applied: r.applied,
      pending: state.pendingClauses.includes(r.id),
      hasEditedVariant: Boolean(r.removedXml),
    };
  });
}

export async function documentView(sessionId: string, doc: repo.DocumentSummary): Promise<DocumentView> {
  const msgs = await repo.listMessages(sessionId, doc.id);
  const s = doc.fieldState;
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? null;
  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title || doc.filename.replace(/\.docx$/i, ""),
    fields: s.fields,
    fieldsVersion: doc.fieldsVersion,
    workingRevision: doc.workingRevision,
    draftStatus: doc.draftStatus,
    draftStale: doc.draftStatus === "ready" && doc.draftFieldsVersion !== doc.fieldsVersion,
    phase: phaseOf(doc),
    analysis: doc.analysis,
    savedAt: doc.savedAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    language: {
      document: s.language.document,
      conversation: s.conversationLanguage,
      effective: replyLanguage(s.conversationLanguage, lastUser, s.language.document),
    },
    rules: ruleViews(s),
    ruleIssues: s.ruleIssues,
    structureIssues: s.structureIssues,
    inactiveFieldIds: [...inactiveFields(s)],
    messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

export async function getView(sessionId: string, documentId: string) {
  return documentView(sessionId, await mustGet(sessionId, documentId));
}

export async function currentView(sessionId: string) {
  const doc = await repo.getLatestDocument(sessionId);
  return doc ? documentView(sessionId, doc) : null;
}
