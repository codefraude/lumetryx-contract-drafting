import "server-only";
import type { LanguageModel } from "ai";
import { cacheDel, cacheGet, cacheSet, withLock } from "../cache/redis";
import * as repo from "../db/repo";
import { detectMarkers } from "../docx/detect";
import { ensureParaIds, indexBlocks, type Block } from "../docx/ooxml";
import { loadDocxPackage, sha256Hex } from "../docx/package";
import { compareBlocks, type DiffResult } from "../diff";
import { buildDraft, renderDraft, requiredMissing, updateWorkingDraft, type DraftUpdate } from "../draft";
import type { EventPayload } from "../events";
import { buildFields } from "../fields/build";
import { documentLanguage, messageLanguage, replyLanguage } from "../fields/lang";
import { normalizeValue, templateCurrencyHint } from "../fields/normalize";
import { evaluateRule, inactiveFields, parseConditionMarkers, unresolvedRules, type ClauseState } from "../fields/rules";
import type { ChatLanguage, Field, FieldState, Lang, Rule } from "../fields/types";
import { analysisCacheKey, analyzeTemplate, PARSER_VERSION } from "../ai/analyze";
import { applyExtraction, clauseContext, extract, languageSwitchMessage, openingMessage, replyPrompt, streamReply } from "../ai/interview";
import { AiError, assertBudget, classifyAiError, geminiModel, modelId, trackUsage, type SessionUsage } from "../ai/model";
import { NotFound } from "./http";

let modelOverride: LanguageModel | null | undefined;
export const setModelForTests = (m: LanguageModel | null | undefined) => {
  modelOverride = m;
};
function model(): LanguageModel {
  return modelOverride ?? geminiModel();
}
function modelOrNull(): LanguageModel | null {
  if (modelOverride !== undefined) return modelOverride;
  try {
    return geminiModel();
  } catch {
    return null;
  }
}

export interface RuleView {
  id: string;
  label: string;
  source: Rule["source"];
  condition: Rule["condition"];
  confirmed: boolean;
  dismissed: boolean;
  override: Rule["override"];
  evidence: string | null;
  state: ClauseState;
  reason: string;
  /** What the working draft contains (null before a draft exists). */
  applied: Rule["applied"];
  /** The draft differs from what the condition calls for and waits for confirmation (the clause was edited by hand). */
  pending: boolean;
  /** Excluded text the user edited, kept so re-including the clause restores it. */
  hasEditedVariant: boolean;
}

export type Phase = "interview" | "ready" | "generating" | "interrupted" | "draft";

export interface DocumentView {
  id: string;
  filename: string;
  title: string;
  fields: Field[];
  fieldsVersion: number;
  workingRevision: number;
  draftStatus: "none" | "generating" | "ready";
  draftStale: boolean;
  phase: Phase;
  analysis: "ai" | "markers_only";
  savedAt: string;
  expiresAt: string;
  language: { document: FieldState["language"]["document"]; conversation: ChatLanguage | null; effective: ChatLanguage };
  rules: RuleView[];
  ruleIssues: string[];
  structureIssues: FieldState["structureIssues"];
  inactiveFieldIds: string[];
  messages: { id: string; role: "user" | "assistant"; content: string }[];
}

/** A generation older than this with no completion was interrupted (the lock TTL is 60 s). */
const INTERRUPTED_AFTER_MS = 90_000;

function phaseOf(doc: { draftStatus: repo.DocumentSummary["draftStatus"]; updatedAt: Date; fieldState: FieldState }): Phase {
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

async function view(sessionId: string, doc: repo.DocumentSummary): Promise<DocumentView> {
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
    language: { document: s.language.document, conversation: s.conversationLanguage, effective: replyLanguage(s.conversationLanguage, lastUser, s.language.document) },
    rules: ruleViews(s),
    ruleIssues: s.ruleIssues,
    structureIssues: s.structureIssues,
    inactiveFieldIds: [...inactiveFields(s)],
    messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

async function mustGet(sessionId: string, documentId: string) {
  const doc = await repo.getDocument(sessionId, documentId);
  if (!doc) throw new NotFound();
  return doc;
}

async function mustGetBytes(sessionId: string, documentId: string) {
  const bytes = await repo.getDocumentBytes(sessionId, documentId);
  if (!bytes) throw new NotFound();
  return bytes;
}

/** Called before opening a stream so config errors become a plain HTTP error, not a stream event. */
export function assertAiAvailable(): void {
  model();
}

export async function getView(sessionId: string, documentId: string) {
  return view(sessionId, await mustGet(sessionId, documentId));
}

export async function currentView(sessionId: string) {
  const doc = await repo.getLatestDocument(sessionId);
  return doc ? view(sessionId, doc) : null;
}

export interface DraftListItem {
  id: string;
  title: string;
  filename: string;
  savedAt: string;
  expiresAt: string;
  phase: Phase;
  outstanding: number;
  /** Separate counts, so a clause decision is not also counted as the yes/no detail that settles it. */
  detailsLeft: number;
  decisionsLeft: number;
  language: FieldState["language"]["document"];
}

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
    detailsLeft: requiredMissing(d.fieldState).filter((f) => f.source !== "condition").length,
    decisionsLeft: unresolvedRules(d.fieldState).length,
    language: d.fieldState.language.document,
  }));
}

/** Parsed template blocks are cached per session + template hash + parser version. */
async function templateBlocks(sessionId: string, templateHash: string, original: Uint8Array): Promise<Block[]> {
  const key = `lx:blocks:${sessionId}:${templateHash}:${PARSER_VERSION}`;
  const hit = await cacheGet<Block[]>(key, (raw) => raw as Block[]);
  if (hit) return hit;
  const rendered = await indexBlocks(await loadDocxPackage(original));
  const blocks: Block[] = rendered.map(({ runs: _runs, numberLabel: _n, headingLevel: _h, ...b }) => b);
  await cacheSet(key, blocks, 60 * 60 * 6);
  return blocks;
}

const docLangAsLang = (d: FieldState["language"]["document"]): Lang => (d === "en" || d === "fr" ? d : "unknown");

export async function createFromUpload(session: SessionUsage, filename: string, bytes: Uint8Array): Promise<DocumentView> {
  const pkg = await loadDocxPackage(bytes);
  const blocks = await indexBlocks(pkg);
  const templateHash = await sha256Hex(bytes);
  const markers = detectMarkers(blocks);
  const language = documentLanguage(blocks.filter((b) => b.partKind === "body").map((b) => b.text));
  const conditionNames = parseConditionMarkers(blocks).conditionFields.map((f) => f.id);
  const m = modelOrNull();
  let analysis = null;
  let analysisNote = "";
  if (m) {
    try {
      assertBudget(session);
      const r = await withLock(`lx:lock:analyze:${session.id}:${templateHash}`, 90, () =>
        analyzeTemplate({ model: m, modelName: modelId(), sessionId: session.id, templateHash, blocks, markers, conditions: conditionNames }),
      );
      analysis = r.analysis;
      if (!r.cached) await trackUsage(session.id, r.usage);
    } catch (err) {
      const e = classifyAiError(err);
      analysisNote = ` (AI analysis unavailable: ${e.message} Only explicitly marked fields were detected.)`;
    }
  } else {
    analysisNote = " (AI is not configured, so only explicitly marked fields were detected and the assistant cannot chat.)";
  }
  const built = buildFields(blocks, markers, analysis);
  const state: FieldState = {
    version: 2,
    fields: built.fields,
    draftAnchors: {},
    rules: built.rules,
    ruleIssues: built.ruleIssues,
    structureIssues: [],
    pendingClauses: [],
    references: [],
    language,
    conversationLanguage: null,
  };
  const title = filename.replace(/\.docx$/i, "").slice(0, 120) || "Untitled draft";
  const doc = await repo.createDocument({ sessionId: session.id, filename: filename.slice(0, 200), title, templateHash, originalDocx: Buffer.from(bytes), fieldState: state, analysis: analysis ? "ai" : "markers_only" });
  const lang: ChatLanguage = language.document === "fr" ? "fr" : "en";
  await repo.addMessage(doc.id, "assistant", openingMessage(state.fields, lang, inactiveFields(state)) + analysisNote);
  return view(session.id, doc);
}

/** Manual correction from the field panel. Deterministically validated like chat answers. */
export async function correctField(sessionId: string, documentId: string, input: { fieldsVersion: number; fieldId: string; value?: string | null; required?: boolean; label?: string }) {
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
    const r = input.value === null ? { status: "missing" as const, displayValue: null, normalized: null, note: null } : normalizeValue(f.valueType, input.value, { currencyHint: templateCurrencyHint(blocks.map((b) => b.text).join("\n")), lang: context });
    Object.assign(f, { rawValue: input.value, ...r });
  }
  const updated = await repo.updateFieldState(sessionId, documentId, input.fieldsVersion, { ...doc.fieldState, fields });
  return view(sessionId, updated);
}

/** Applies answer and clause changes to an existing working draft, persisting document and state in one statement. */
async function syncDraft(sessionId: string, doc: repo.DocumentSummary, state: FieldState, changedFieldIds: string[], confirmEdited: ReadonlySet<string> = new Set()): Promise<{ update: DraftUpdate; saved: repo.DocumentSummary }> {
  const bytes = await mustGetBytes(sessionId, doc.id);
  if (!bytes.workingDocx) throw new NotFound();
  const update = await updateWorkingDraft({ working: new Uint8Array(bytes.workingDocx), original: new Uint8Array(bytes.originalDocx), state, changedFieldIds, confirmEdited });
  const next: FieldState = { ...update.state, pendingClauses: update.needsConfirmation.map((c) => c.ruleId) };
  const saved = update.bytes
    ? await repo.saveWorkingDocx(sessionId, doc.id, bytes.workingRevision, Buffer.from(update.bytes), { state: next, draftCurrent: update.conflicts.length === 0, expectedFieldsVersion: doc.fieldsVersion })
    : await repo.updateFieldState(sessionId, doc.id, doc.fieldsVersion, next);
  return { update, saved };
}

export async function chatTurn(session: SessionUsage, documentId: string, input: { message: string; fieldsVersion: number }, emit: (e: EventPayload) => void, signal: AbortSignal) {
  const doc = await mustGet(session.id, documentId);
  if (doc.fieldsVersion !== input.fieldsVersion) throw new repo.StaleRevisionError("The answers");
  assertBudget(session);
  const m = model();
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

  // Stage 1: validated structured extraction. Nothing is committed unless it fully validates.
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
      emit({ type: "draft_patch", workingRevision: saved.workingRevision, applied: update.appliedFields, conflicts: update.conflicts, clauseChanges: update.clauseChanges, needsConfirmation: update.needsConfirmation });
      emit({ type: "fields_updated", fields, fieldsVersion: saved.fieldsVersion, changed: applied.changed });
    } else {
      const saved = await repo.updateFieldState(session.id, documentId, doc.fieldsVersion, next);
      emit({ type: "fields_updated", fields, fieldsVersion: saved.fieldsVersion, changed: applied.changed });
    }
  }

  // Stage 2: stream the user-facing reply. Earlier answers stay saved if this fails.
  const clauseText = clauseContext(blocks, extraction.clauseBlockIds);
  const inactive = inactiveFields({ rules: state.rules, fields });
  const result = streamReply(m, replyPrompt(fields, applied.changed, clauseText, input.message, history, lang, inactive), signal);
  let text = "";
  try {
    for await (const delta of result.textStream) {
      text += delta;
      emit({ type: "assistant_delta", text: delta });
    }
    const finish = await result.finishReason;
    if (finish === "length") text += "…";
  } finally {
    await trackUsage(session.id, await Promise.resolve(result.usage).catch(() => undefined));
  }
  if (!text.trim()) throw new AiError("invalid_output", "The assistant returned an empty reply. Your answers were saved; please retry.", true);
  await repo.addMessage(documentId, "assistant", text);
  emit({ type: "assistant_done", text });
}

export async function generateDraft(sessionId: string, documentId: string, input: { fieldsVersion: number }, emit: (e: EventPayload) => void, signal: AbortSignal) {
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
        const saved = await repo.finishDraft(sessionId, documentId, { fieldsVersion: input.fieldsVersion, bytes: Buffer.from(step.bytes), state: { ...step.state, pendingClauses: [] } });
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

// ---------- conversation language ----------

export async function setConversationLanguage(sessionId: string, documentId: string, input: { fieldsVersion: number; language: ChatLanguage | null }) {
  const doc = await mustGet(sessionId, documentId);
  const state = { ...doc.fieldState, conversationLanguage: input.language };
  const saved = await repo.updateFieldState(sessionId, documentId, input.fieldsVersion, state);
  // Deterministic confirmation in the new language; no model call, nothing is re-asked.
  if (input.language) await repo.addMessage(documentId, "assistant", languageSwitchMessage(state.fields, input.language, inactiveFields(state)));
  return view(sessionId, saved);
}

// ---------- conditional clauses ----------

export type RuleAction = "confirm" | "dismiss" | "include" | "exclude" | "clear_override" | "apply";

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
  if (doc.draftStatus !== "ready") return view(sessionId, await repo.updateFieldState(sessionId, documentId, doc.fieldsVersion, state));
  const { saved } = await syncDraft(sessionId, doc, state, [], input.action === "apply" ? new Set([rule.id]) : new Set());
  return view(sessionId, saved);
}

// ---------- comparison ----------

export interface CompareResponse {
  /** What the template was compared with. */
  source: "editor" | "working" | "preview";
  result: DiffResult;
}

/**
 * Compares the immutable template with the latest draft snapshot: the editor's current export when
 * the browser sends it (so unsaved edits are included without saving them), else the saved working
 * draft, else a preview of the draft the current answers would produce. No model call is made.
 */
export async function compare(sessionId: string, documentId: string, snapshot: Uint8Array | null): Promise<CompareResponse> {
  const doc = await mustGet(sessionId, documentId);
  const bytes = await mustGetBytes(sessionId, documentId);
  const originalPkg = await loadDocxPackage(new Uint8Array(bytes.originalDocx));
  await ensureParaIds(originalPkg); // the same deterministic ids the draft was given
  const original = await indexBlocks(originalPkg);
  let source: CompareResponse["source"];
  let current: Uint8Array;
  let state = doc.fieldState;
  if (snapshot && doc.draftStatus === "ready") {
    source = "editor";
    current = snapshot;
  } else if (bytes.workingDocx && doc.draftStatus === "ready") {
    source = "working";
    current = new Uint8Array(bytes.workingDocx);
  } else {
    source = "preview";
    const r = await renderDraft(new Uint8Array(bytes.originalDocx), state);
    current = r.bytes;
    state = r.state;
  }
  const currentBlocks = await indexBlocks(await loadDocxPackage(current));
  return { source, result: compareBlocks(original, currentBlocks, { fields: state.fields, rules: state.rules }) };
}

// ---------- saved drafts ----------

export async function renameDraft(sessionId: string, documentId: string, title: string) {
  if (!(await repo.renameDocument(sessionId, documentId, title.trim().slice(0, 120) || "Untitled draft"))) throw new NotFound();
  return getView(sessionId, documentId);
}

/** Deletes a draft and drops cached analyses of its template unless another draft of this browser still uses it. */
export async function deleteDraft(sessionId: string, documentId: string) {
  const gone = await repo.deleteDocument(sessionId, documentId);
  if (!gone) throw new NotFound();
  const stillUsed = (await repo.listDocuments(sessionId)).some((d) => d.templateHash === gone.templateHash);
  if (!stillUsed) await cacheDel([`lx:blocks:${sessionId}:${gone.templateHash}:${PARSER_VERSION}`, analysisCacheKey(sessionId, gone.templateHash, modelId())]);
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
  return view(sessionId, copy);
}
