import "server-only";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { cacheGet, cacheSet } from "@/server/cache/redis";
import type { MarkerOccurrence } from "@/server/docx/detect";
import type { Block } from "@/server/docx/blocks";
import { TemplateAnalysis } from "@/server/fields/template-analysis";
import { AiError, PROMPT_VERSION, SAFETY_RULES, providerOptions, untrusted } from "@/server/ai/model";

export const PARSER_VERSION = "x4";
const ANALYSIS_TTL_SECONDS = 60 * 60 * 24;

export const analysisCacheKey = (sessionId: string, templateHash: string, model: string) =>
  `lx:analysis:${sessionId}:${templateHash}:${PARSER_VERSION}:${PROMPT_VERSION}:${model}`;

const SYSTEM = `You analyse contract templates (English, French or both) for a lawyer's drafting assistant.
Identify every piece of information the lawyer must supply to complete the contract.
- Group markers that mean the same thing under one field (e.g. {{tenant_name}} and [TENANT NAME]), including across languages (e.g. [TENANT NAME] and [NOM DU LOCATAIRE], landlord/bailleur, start date/date de début) — but only when exactly the same value is written at each place. Two different parties are never merged because both are names, and the lines of one address (street, then postcode and town) are separate fields. Never merge markers with different meanings.
- ids are English snake_case whatever the template language; labels use the template's own wording; give each question in English (question) and French (questionFr).
- Every label is different. When the template uses the same wording for different information (e.g. "Adresse postale" for the sender and for the recipient), say whose it is, e.g. "Adresse postale (expéditeur)" and "Adresse postale (destinataire)".
- Markers of kind control are Word content controls showing placeholder text (their text is the placeholder, their title names the control). A placeholder that names what to enter ("Votre nom", "Date", "Nom du destinataire") is a field. A placeholder that is sample wording to keep or rewrite (part of a sentence, a closing such as "Cordialement", a label such as "Pièce jointe") goes in notFields.
- Put markers that are ordinary contract text (citations, cross-references, defined terms) in notFields.
- Find IMPLICIT gaps: places where information is plainly missing but there is no marker (e.g. "the Tenant, of" followed by nothing, "a deposit of" with no amount). For each, give the block id and a verbatim quote, copied exactly, unique within that block: either the text immediately BEFORE the gap (replace: false), or, when the template writes placeholder wording where the value goes (e.g. a line that only reads "Nom du destinataire", or "Dear Client Name,"), that placeholder wording itself (replace: true) so that the value replaces it. A caption followed by a blank ("Date:") stays: replace: false.
- Do not invent fields for content that is already complete. Signature blanks are not fields.
- Questions must be plain language a lawyer would ask a client, e.g. "Who is the landlord, and are they an individual or a company?"
- groups: parties, subject (property/services), dates, money, other.
- For each CONDITION listed, write a plain yes/no question (question and questionFr) in conditions, using its name.
- proposedRules: ONLY for clauses the template itself explicitly marks as optional or conditional in ordinary wording (e.g. "[Optional — include only if the employee is senior]", "Applicable uniquement si…"). Give the first and last block ids of the clause, a condition name, a yes/no question and the verbatim evidence. Never propose a condition based on your own view of what is appropriate or enforceable.
${SAFETY_RULES}`;

function buildPrompt(blocks: Block[], markers: MarkerOccurrence[], conditions: string[]): string {
  const markerLines = [...new Map(markers.map((m) => [m.key, m])).values()].map(
    (m) => `${m.key} | ${m.marker} | ${m.text} | ${m.context.replace(/\s+/g, " ")}${m.title ? ` (control title: ${m.title})` : ""}`,
  );
  const blockLines = blocks.filter((b) => b.text.trim()).map((b) => `${b.id} | ${b.partKind}/${b.kind} | ${b.text.replace(/\s+/g, " ")}`);
  return `${untrusted("template", `MARKERS (key | kind | text | context):\n${markerLines.join("\n")}\n\nCONDITIONS (from [[IF …]] markers):\n${conditions.join("\n") || "none"}\n\nBLOCKS (id | location | text):\n${blockLines.join("\n")}`)}\n\nReturn the analysis.`;
}

export interface AnalysisResult {
  analysis: TemplateAnalysis;
  cached: boolean;
  usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
}

export async function analyzeTemplate(opts: {
  model: LanguageModel;
  modelName: string;
  sessionId: string;
  templateHash: string;
  blocks: Block[];
  markers: MarkerOccurrence[];
  conditions?: string[];
  abortSignal?: AbortSignal;
}): Promise<AnalysisResult> {
  const key = analysisCacheKey(opts.sessionId, opts.templateHash, opts.modelName);
  const hit = await cacheGet(key, (raw) => TemplateAnalysis.parse(raw));
  if (hit) return { analysis: hit, cached: true, usage: undefined };

  const prompt = buildPrompt(opts.blocks, opts.markers, opts.conditions ?? []);
  const run = (extra = "") =>
    generateText({
      model: opts.model,
      system: SYSTEM,
      prompt: prompt + extra,
      output: Output.object({ schema: TemplateAnalysis }),
      maxOutputTokens: 8000,
      maxRetries: 2,
      abortSignal: opts.abortSignal,
      providerOptions: providerOptions(),
    });

  let result;
  try {
    result = await run();
  } catch (err) {
    if (!NoObjectGeneratedError.isInstance(err) || err.finishReason === "length") throw mapNoObject(err);
    // One bounded repair attempt; never an open-ended loop.
    try {
      result = await run("\n\nYour previous reply did not match the required JSON schema. Reply again with valid JSON only.");
    } catch (err2) {
      throw mapNoObject(err2);
    }
  }
  if (result.finishReason === "length") throw new AiError("truncated", "The template analysis was cut off. Try a shorter template.", true);
  await cacheSet(key, result.output, ANALYSIS_TTL_SECONDS);
  return { analysis: result.output, cached: false, usage: result.usage };
}

function mapNoObject(err: unknown): unknown {
  if (NoObjectGeneratedError.isInstance(err)) {
    return err.finishReason === "length"
      ? new AiError("truncated", "The AI response was cut off before it was complete.", true)
      : new AiError("invalid_output", "The AI returned an invalid analysis.", true);
  }
  return err;
}
