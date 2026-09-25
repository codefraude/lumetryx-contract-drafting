import "server-only";
import type { DocumentView } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import { analyzeTemplate } from "@/server/ai/analyze";
import { openingMessage } from "@/server/ai/interview-messages";
import {
  assertBudget,
  classifyAiError,
  currentModelOrNull,
  modelId,
  trackUsage,
  type SessionUsage,
} from "@/server/ai/model";
import { withLock } from "@/server/cache/redis";
import { parseConditionMarkers } from "@/server/clauses/condition-markers";
import { inactiveFields } from "@/server/clauses/evaluation";
import * as repo from "@/server/db/repo";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage, sha256Hex } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import { buildFields } from "@/server/fields/build-fields";
import { documentLanguage } from "@/server/fields/lang";
import type { FieldState } from "@/server/fields/state";
import { documentView } from "./views";

/**
 * A new draft from an uploaded template: markers, the (cached)
 * AI analysis, fields, rules and the opening question.
 */

export async function createFromUpload(
  session: SessionUsage,
  filename: string,
  bytes: Uint8Array,
): Promise<DocumentView> {
  const pkg = await loadDocxPackage(bytes);
  const blocks = await indexBlocks(pkg);
  const templateHash = await sha256Hex(bytes);
  const markers = detectMarkers(blocks);
  const language = documentLanguage(
    blocks.filter((b) => b.partKind === "body").map((b) => b.text),
  );
  const conditionNames = parseConditionMarkers(blocks).conditionFields.map(
    (f) => f.id,
  );
  const m = currentModelOrNull();
  let analysis = null;
  let analysisNote = "";

  if (m) {
    try {
      assertBudget(session);
      const r = await withLock(
        `lx:lock:analyze:${session.id}:${templateHash}`,
        90,
        () =>
          analyzeTemplate({
            model: m,
            modelName: modelId(),
            sessionId: session.id,
            templateHash,
            blocks,
            markers,
            conditions: conditionNames,
          }),
      );

      analysis = r.analysis;

      if (!r.cached) {
        await trackUsage(session.id, r.usage);
      }
    } catch (err) {
      const e = classifyAiError(err);

      analysisNote = ` (AI analysis unavailable: ${e.message} Only explicitly marked fields were detected.)`;
    }
  } else {
    analysisNote =
      " (AI is not configured, so only explicitly marked fields were detected and the assistant cannot chat.)";
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
  const title =
    filename.replace(/\.docx$/i, "").slice(0, 120) || "Untitled draft";
  const doc = await repo.createDocument({
    sessionId: session.id,
    filename: filename.slice(0, 200),
    title,
    templateHash,
    originalDocx: Buffer.from(bytes),
    fieldState: state,
    analysis: analysis ? "ai" : "markers_only",
  });
  const lang: ChatLanguage = language.document === "fr" ? "fr" : "en";

  await repo.addMessage(
    doc.id,
    "assistant",
    openingMessage(state.fields, lang, inactiveFields(state)) + analysisNote,
  );

  return documentView(session.id, doc);
}
