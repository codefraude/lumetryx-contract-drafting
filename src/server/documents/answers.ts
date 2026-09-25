import "server-only";
import type { RuleAction } from "@/features/documents/contracts/document-view";
import type { ChatLanguage, Lang } from "@/features/documents/contracts/fields";
import type { FieldCorrection } from "@/features/documents/contracts/requests";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import { applyExtraction, extract } from "@/server/ai/extraction";
import { languageSwitchMessage } from "@/server/ai/interview-messages";
import { AiError, assertBudget, classifyAiError, currentModel, trackUsage, type SessionUsage } from "@/server/ai/model";
import { clauseContext, replyPrompt, streamReply } from "@/server/ai/reply";
import { inactiveFields } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { updateWorkingDraft, type DraftUpdate } from "@/server/draft/update";
import { messageLanguage, replyLanguage } from "@/server/fields/lang";
import { normalizeValue, templateCurrencyHint } from "@/server/fields/normalize";
import type { FieldState } from "@/server/fields/state";
import { NotFound } from "@/server/http/responses";
import { mustGet, mustGetBytes, templateBlocks } from "./access";
import { documentView } from "./views";

/**
 * Changes to a draft's answers or clause decisions: panel corrections, chat turns, language, clause actions.
 * An existing draft gets the change in the same statement, except where the user edited the text.
 */

const docLangAsLang = (d: FieldState["language"]["document"]): Lang => (d === "en" || d === "fr" ? d : "unknown");

/** Manual correction from the field panel. Deterministically validated like chat answers. */
export async function correctField(sessionId: string, documentId: string, input: FieldCorrection) {
  const doc = await mustGet(sessionId, documentId);
  const fields = doc.fieldState.fields.map((f) => ({ ...f }));
  const f = fields.find((x) => x.id === input.fieldId);
  if (!f) throw new NotFound();
  if (input.label) f.label = input.label.slice(0, 120);
  if (input.required !== undefined) f.required = input.required;
  if (input.value !== undefined) {
    const blocks = await templateBlocks(sessionId, doc.templateHash, (await mustGetBytes(sessionId, documentId)).originalDocx);
    const typed = input.value ? messageLanguage(input.value) : "unknown";
    const occurrence = f.occurrences.map((o) => o.lang).find((l) => l !== "unknown");
    const context: Lang = typed !== "unknown" ? typed : (occurrence ?? docLangAsLang(doc.fieldState.language.document));
    const r =
      input.value === null
        ? { status: "missing" as const, displayValue: null, normalized: null, note: null }
        : normalizeValue(f.valueType, input.value, { currencyHint: templateCurrencyHint(blocks.map((b) => b.text).join("\n")), lang: context });
    Object.assign(f, { rawValue: input.value, ...r });
  }
  const updated = await repo.updateFieldState(sessionId, documentId, input.fieldsVersion, { ...doc.fieldState, fields });
  return documentView(sessionId, updated);
}

/** Applies answer and clause changes to an existing working draft, persisting document and state in one statement. */
async function syncDraft(
  sessionId: string,
  doc: repo.DocumentSummary,
  state: FieldState,
  changedFieldIds: string[],
  confirmEdited: ReadonlySet<string> = new Set(),
): Promise<{ update: DraftUpdate; saved: repo.DocumentSummary }> {
  const bytes = await mustGetBytes(sessionId, doc.id);
  if (!bytes.workingDocx) throw new NotFound();
  const update = await updateWorkingDraft({
    working: new Uint8Array(bytes.workingDocx),
    original: new Uint8Array(bytes.originalDocx),
    state,
    changedFieldIds,
    confirmEdited,
  });
  const next: FieldState = { ...update.state, pendingClauses: update.needsConfirmation.map((c) => c.ruleId) };
  const saved = update.bytes
    ? await repo.saveWorkingDocx(sessionId, doc.id, bytes.workingRevision, Buffer.from(update.bytes), {
        state: next,
        draftCurrent: update.conflicts.length === 0,
        expectedFieldsVersion: doc.fieldsVersion,
      })
    : await repo.updateFieldState(sessionId, doc.id, doc.fieldsVersion, next);
  return { update, saved };
}

export async function chatTurn(
  session: SessionUsage,
  documentId: string,
  input: { message: string; fieldsVersion: number },
  emit: (e: EventPayload) => void,
  signal: AbortSignal,
) {
  const doc = await mustGet(session.id, documentId);
  if (doc.fieldsVersion !== input.fieldsVersion) throw new repo.StaleRevisionError("The answers");
  assertBudget(session);
  const m = currentModel();
  const bytes = await mustGetBytes(session.id, documentId);
  const blocks = await templateBlocks(session.id, doc.templateHash, bytes.originalDocx);
  const recent = await repo.recentMessages(documentId, 8);
  // Retrying a failed turn resends a message that was stored but never answered: keep a single copy.
  const retry = recent.at(-1)?.role === "user" && recent.at(-1)?.content === input.message;
  const history = retry ? recent.slice(0, -1) : recent;
  if (!retry) await repo.addMessage(documentId, "user", input.message);
  const state = doc.fieldState;
  const typed = messageLanguage(input.message);
  const lang = replyLanguage(state.conversationLanguage, input.message, state.language.document);

  // Only extracted values that fully validate are committed.
  const { extraction, usage } = await extract({ model: m, fields: state.fields, blocks, history, userMessage: input.message, abortSignal: signal });
  await trackUsage(session.id, usage);
  const numberContext: Lang = typed !== "unknown" ? typed : docLangAsLang(state.language.document);
  const applied = applyExtraction(state.fields, extraction, input.message, templateCurrencyHint(blocks.map((b) => b.text).join("\n")), numberContext);
  let fields = applied.fields;
  if (applied.changed.length) {
    const next: FieldState = { ...state, fields };
    const changedConfirmed = fields.filter((f) => applied.changed.includes(f.id) && f.status === "confirmed").map((f) => f.id);
    if (doc.draftStatus === "ready") {
      const { update, saved } = await syncDraft(session.id, doc, next, changedConfirmed);
      fields = saved.fieldState.fields;
      emit({
        type: "draft_patch",
        workingRevision: saved.workingRevision,
        applied: update.appliedFields,
        conflicts: update.conflicts,
        clauseChanges: update.clauseChanges,
        needsConfirmation: update.needsConfirmation,
      });
      emit({ type: "fields_updated", fields, fieldsVersion: saved.fieldsVersion, changed: applied.changed });
    } else {
      const saved = await repo.updateFieldState(session.id, documentId, doc.fieldsVersion, next);
      emit({ type: "fields_updated", fields, fieldsVersion: saved.fieldsVersion, changed: applied.changed });
    }
  }

  // Answers saved above stay saved if the reply fails.
  const clauseText = clauseContext(blocks, extraction.clauseBlockIds);
  const inactive = inactiveFields({ rules: state.rules, fields });
  const reply = streamReply(m, replyPrompt(fields, applied.changed, clauseText, input.message, history, lang, inactive), signal);
  let text = "";
  try {
    for await (const delta of reply.stream.textStream) {
      text += delta;
      emit({ type: "assistant_delta", text: delta });
    }
    const finish = await reply.stream.finishReason;
    if (finish === "length") text += "…";
  } catch (err) {
    // The stream reports "no output" when the call behind it failed; that failure is the one to classify.
    const cause = classifyAiError(reply.failure() ?? err);
    throw applied.changed.length && cause.retryable && cause.code !== "aborted"
      ? new AiError(cause.code, `${cause.message} Your answers were saved.`, true)
      : cause;
  } finally {
    await trackUsage(session.id, await Promise.resolve(reply.stream.usage).catch(() => undefined));
  }
  if (!text.trim()) throw new AiError("invalid_output", "The assistant returned an empty reply. Your answers were saved; retry to get a reply.", true);
  await repo.addMessage(documentId, "assistant", text);
  emit({ type: "assistant_done", text });
}

export async function setConversationLanguage(sessionId: string, documentId: string, input: { fieldsVersion: number; language: ChatLanguage | null }) {
  const doc = await mustGet(sessionId, documentId);
  const state = { ...doc.fieldState, conversationLanguage: input.language };
  const saved = await repo.updateFieldState(sessionId, documentId, input.fieldsVersion, state);
  // Deterministic confirmation in the new language; no model call, nothing is re-asked.
  if (input.language) await repo.addMessage(documentId, "assistant", languageSwitchMessage(state.fields, input.language, inactiveFields(state)));
  return documentView(sessionId, saved);
}

/**
 * Confirms/dismisses a proposed rule, sets or clears an explicit override, or (`apply`) confirms
 * removing a clause the user had edited. When a draft exists, the change is applied to it at once.
 */
export async function ruleAction(sessionId: string, documentId: string, input: { fieldsVersion: number; ruleId: string; action: RuleAction }) {
  const doc = await mustGet(sessionId, documentId);
  if (doc.fieldsVersion !== input.fieldsVersion) throw new repo.StaleRevisionError("The answers");
  const rules = doc.fieldState.rules.map((r) => ({ ...r }));
  const rule = rules.find((r) => r.id === input.ruleId);
  if (!rule) throw new NotFound();
  if (input.action === "confirm") Object.assign(rule, { confirmed: true, dismissed: false });
  if (input.action === "dismiss") Object.assign(rule, { dismissed: true });
  if (input.action === "include" || input.action === "exclude") rule.override = input.action;
  if (input.action === "clear_override") rule.override = null;
  const state: FieldState = { ...doc.fieldState, rules };
  if (doc.draftStatus !== "ready") return documentView(sessionId, await repo.updateFieldState(sessionId, documentId, doc.fieldsVersion, state));
  const { saved } = await syncDraft(sessionId, doc, state, [], input.action === "apply" ? new Set([rule.id]) : new Set());
  return documentView(sessionId, saved);
}
