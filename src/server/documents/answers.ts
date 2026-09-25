import "server-only";
import type { RuleAction } from "@/features/documents/contracts/document-view";
import type { ChatLanguage, Lang } from "@/features/documents/contracts/fields";
import type { FieldCorrection } from "@/features/documents/contracts/requests";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import { applyExtraction, extract } from "@/server/ai/extraction";
import { languageSwitchMessage } from "@/server/ai/interview-messages";
import {
  AiError,
  assertBudget,
  classifyAiError,
  currentModel,
  trackUsage,
  type SessionUsage,
} from "@/server/ai/model";
import {
  clauseContext,
  replyPrompt,
  streamReply,
  type DraftChange,
} from "@/server/ai/reply";
import { inactiveFields } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { updateWorkingDraft, type DraftUpdate } from "@/server/draft/update";
import { messageLanguage, replyLanguage } from "@/server/fields/lang";
import {
  chronologyIssues,
  templateCurrencyHint,
} from "@/server/fields/normalize";
import { issueNote } from "@/server/fields/issues";
import { resolveField } from "@/server/fields/resolve";
import { withLock } from "@/server/cache/redis";
import type { FieldState } from "@/server/fields/state";
import { NotFound } from "@/server/http/responses";
import { mustGet, mustGetBytes, templateBlocks } from "./access";
import { documentView } from "./views";

const docLangAsLang = (d: FieldState["language"]["document"]): Lang => {
  return d === "en" || d === "fr" ? d : "unknown";
};

export async function correctField(
  sessionId: string,
  documentId: string,
  input: FieldCorrection,
) {
  const doc = await mustGet(sessionId, documentId);
  const fields = doc.fieldState.fields.map((f) => ({ ...f }));
  const f = fields.find((x) => x.id === input.fieldId);

  if (!f) {
    throw new NotFound();
  }

  if (input.label) {
    f.label = input.label.slice(0, 120);
  }

  if (input.required !== undefined) {
    f.required = input.required;
  }

  if (input.value !== undefined || input.resolution !== undefined) {
    const blocks = await templateBlocks(
      sessionId,
      doc.templateHash,
      (await mustGetBytes(sessionId, documentId)).originalDocx,
    );
    const typed = input.value ? messageLanguage(input.value) : "unknown";
    const occurrence = f.occurrences
      .map((o) => o.lang)
      .find((l) => l !== "unknown");
    const context: Lang =
      typed !== "unknown"
        ? typed
        : (occurrence ?? docLangAsLang(doc.fieldState.language.document));

    Object.assign(
      f,
      resolveField(
        f,
        {
          resolution: input.resolution ?? "value",
          value: input.value ?? null,
          lang: input.lang ?? context,
          onlyLang: input.lang ?? null,
          evidence: null,
        },
        {
          currencyHint: templateCurrencyHint(
            blocks.map((b) => b.text).join("\n"),
          ),
          lang: context,
        },
      ),
    );

    for (const c of chronologyIssues(fields)) {
      const late = fields.find((x) => x.id === c.fieldId);

      if (late?.status === "confirmed") {
        Object.assign(late, {
          status: "needs_clarification",
          resolution: null,
          issue: c.issue,
          note: issueNote(c.issue),
        });
      }
    }
  }

  const updated = await repo.updateFieldState(
    sessionId,
    documentId,
    input.fieldsVersion,
    {
      ...doc.fieldState,
      fields,
    },
  );

  return documentView(sessionId, updated);
}

async function syncDraft(
  sessionId: string,
  doc: repo.DocumentSummary,
  state: FieldState,
  changedFieldIds: string[],
  confirmEdited: ReadonlySet<string> = new Set(),
): Promise<{
  update: DraftUpdate;
  saved: repo.DocumentSummary;
}> {
  const bytes = await mustGetBytes(sessionId, doc.id);

  if (!bytes.workingDocx) {
    throw new NotFound();
  }

  const update = await updateWorkingDraft({
    working: new Uint8Array(bytes.workingDocx),
    original: new Uint8Array(bytes.originalDocx),
    state,
    changedFieldIds,
    confirmEdited,
  });
  const next: FieldState = {
    ...update.state,
    pendingClauses: update.needsConfirmation.map((c) => c.ruleId),
  };
  const saved = update.bytes
    ? await repo.saveWorkingDocx(
        sessionId,
        doc.id,
        bytes.workingRevision,
        Buffer.from(update.bytes),
        {
          state: next,
          draftCurrent: update.conflicts.length === 0,
          expectedFieldsVersion: doc.fieldsVersion,
        },
      )
    : await repo.updateFieldState(sessionId, doc.id, doc.fieldsVersion, next);

  return {
    update,
    saved,
  };
}

export async function chatTurn(
  session: SessionUsage,
  documentId: string,
  input: {
    message: string;
    fieldsVersion: number;
    today?: string | undefined;
  },
  emit: (e: EventPayload) => void,
  signal: AbortSignal,
) {
  await withLock(`lx:lock:chat:${session.id}:${documentId}`, 90, () =>
    runTurn(session, documentId, input, emit, signal),
  );
}

const nearToday = (today: string | undefined) => {
  if (!today) {
    return undefined;
  }

  const offset = Math.abs(Date.parse(today) - Date.now());

  return offset < 2 * 24 * 60 * 60 * 1000 ? today : undefined;
};

async function runTurn(
  session: SessionUsage,
  documentId: string,
  input: {
    message: string;
    fieldsVersion: number;
    today?: string | undefined;
  },
  emit: (e: EventPayload) => void,
  signal: AbortSignal,
) {
  const doc = await mustGet(session.id, documentId);

  if (doc.fieldsVersion !== input.fieldsVersion) {
    throw new repo.StaleRevisionError("The answers");
  }

  assertBudget(session);
  const m = currentModel();
  const bytes = await mustGetBytes(session.id, documentId);
  const blocks = await templateBlocks(
    session.id,
    doc.templateHash,
    bytes.originalDocx,
  );
  const recent = await repo.recentMessages(documentId, 8);
  const retry =
    recent.at(-1)?.role === "user" && recent.at(-1)?.content === input.message;
  const history = retry ? recent.slice(0, -1) : recent;

  if (!retry) {
    await repo.addMessage(documentId, "user", input.message);
  }

  const state = doc.fieldState;
  const typed = messageLanguage(input.message);
  const lang = replyLanguage(
    state.conversationLanguage,
    input.message,
    state.language.document,
  );

  const { extraction, usage } = await extract({
    model: m,
    fields: state.fields,
    blocks,
    history,
    userMessage: input.message,
    today: nearToday(input.today),
    abortSignal: signal,
  });

  await trackUsage(session.id, usage);
  const numberContext: Lang =
    typed !== "unknown" ? typed : docLangAsLang(state.language.document);
  const applied = applyExtraction(
    state.fields,
    extraction,
    input.message,
    templateCurrencyHint(blocks.map((b) => b.text).join("\n")),
    numberContext,
  );
  let fields = applied.fields;
  let draft: DraftChange | null =
    doc.draftStatus === "ready"
      ? {
          applied: [],
          conflicts: [],
        }
      : null;

  if (applied.changed.length) {
    const next: FieldState = {
      ...state,
      fields,
    };
    const changedConfirmed = fields
      .filter((f) => applied.changed.includes(f.id) && f.status === "confirmed")
      .map((f) => f.id);

    if (doc.draftStatus === "ready") {
      const { update, saved } = await syncDraft(
        session.id,
        doc,
        next,
        changedConfirmed,
      );

      fields = saved.fieldState.fields;

      draft = {
        applied: update.appliedFields,
        conflicts: update.conflicts,
      };

      emit({
        type: "draft_patch",
        workingRevision: saved.workingRevision,
        applied: update.appliedFields,
        conflicts: update.conflicts,
        clauseChanges: update.clauseChanges,
        needsConfirmation: update.needsConfirmation,
      });

      emit({
        type: "fields_updated",
        fields,
        fieldsVersion: saved.fieldsVersion,
        changed: applied.changed,
      });
    } else {
      const saved = await repo.updateFieldState(
        session.id,
        documentId,
        doc.fieldsVersion,
        next,
      );

      emit({
        type: "fields_updated",
        fields,
        fieldsVersion: saved.fieldsVersion,
        changed: applied.changed,
      });
    }
  }

  const clauseText = clauseContext(blocks, extraction.clauseBlockIds);
  const inactive = inactiveFields({
    rules: state.rules,
    fields,
  });
  const reply = streamReply(
    m,
    replyPrompt(
      fields,
      applied.changed,
      clauseText,
      input.message,
      history,
      lang,
      inactive,
      draft,
    ),
    signal,
  );
  let text = "";

  try {
    for await (const delta of reply.stream.textStream) {
      text += delta;

      emit({
        type: "assistant_delta",
        text: delta,
      });
    }

    const finish = await reply.stream.finishReason;

    if (finish === "length") {
      text += "…";
    }
  } catch (err) {
    const cause = classifyAiError(reply.failure() ?? err);

    throw applied.changed.length && cause.retryable && cause.code !== "aborted"
      ? new AiError(
          cause.code,
          `${cause.message} Your answers were saved.`,
          true,
        )
      : cause;
  } finally {
    await trackUsage(
      session.id,
      await Promise.resolve(reply.stream.usage).catch(() => undefined),
    );
  }

  if (!text.trim()) {
    throw new AiError(
      "invalid_output",
      "The assistant returned an empty reply. Your answers were saved; retry to get a reply.",
      true,
    );
  }

  await repo.addMessage(documentId, "assistant", text);

  emit({
    type: "assistant_done",
    text,
  });
}

export async function setConversationLanguage(
  sessionId: string,
  documentId: string,
  input: {
    fieldsVersion: number;
    language: ChatLanguage | null;
  },
) {
  const doc = await mustGet(sessionId, documentId);
  const state = {
    ...doc.fieldState,
    conversationLanguage: input.language,
  };
  const saved = await repo.updateFieldState(
    sessionId,
    documentId,
    input.fieldsVersion,
    state,
  );

  if (input.language) {
    await repo.addMessage(
      documentId,
      "assistant",
      languageSwitchMessage(
        state.fields,
        input.language,
        inactiveFields(state),
      ),
    );
  }

  return documentView(sessionId, saved);
}

export async function ruleAction(
  sessionId: string,
  documentId: string,
  input: {
    fieldsVersion: number;
    ruleId: string;
    action: RuleAction;
  },
) {
  const doc = await mustGet(sessionId, documentId);

  if (doc.fieldsVersion !== input.fieldsVersion) {
    throw new repo.StaleRevisionError("The answers");
  }

  const rules = doc.fieldState.rules.map((r) => ({ ...r }));
  const rule = rules.find((r) => r.id === input.ruleId);

  if (!rule) {
    throw new NotFound();
  }

  if (input.action === "confirm") {
    Object.assign(rule, {
      confirmed: true,
      dismissed: false,
    });
  }

  if (input.action === "dismiss") {
    Object.assign(rule, { dismissed: true });
  }

  if (input.action === "include" || input.action === "exclude") {
    rule.override = input.action;
  }

  if (input.action === "clear_override") {
    rule.override = null;
  }

  const state: FieldState = {
    ...doc.fieldState,
    rules,
  };

  if (doc.draftStatus !== "ready") {
    return documentView(
      sessionId,
      await repo.updateFieldState(
        sessionId,
        documentId,
        doc.fieldsVersion,
        state,
      ),
    );
  }

  const { saved } = await syncDraft(
    sessionId,
    doc,
    state,
    [],
    input.action === "apply" ? new Set([rule.id]) : new Set(),
  );

  return documentView(sessionId, saved);
}
