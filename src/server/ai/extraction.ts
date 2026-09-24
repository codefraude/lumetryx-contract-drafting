import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Field, Lang } from "@/features/documents/contracts/fields";
import type { Block } from "@/server/docx/blocks";
import { chronologyIssues, normalizeValue } from "@/server/fields/normalize";
import { AiError, SAFETY_RULES, providerOptions, untrusted } from "./model";

/**
 * Stage 1 of a chat turn: the model proposes field values from the user's latest message, and only
 * values backed by the user's own words that pass deterministic validation are committed.
 */

export const Extraction = z.object({
  // Gemini rejects maxItems on arrays of objects (HTTP 400); the 40 cap is applied in applyExtraction.
  updates: z.array(
    z.object({
      fieldId: z.string(),
      value: z.string().max(400).describe("The value exactly as it should appear in the contract, using the user's wording"),
      currency: z.string().nullable().describe("ISO 4217 code ONLY if the user explicitly named the currency, else null"),
      evidence: z.string().max(400).describe("Verbatim substring of the user's latest message that states this value"),
    }),
  ),
  clauseBlockIds: z.array(z.string()).max(6).describe("Block ids of clauses the user is asking about, if any"),
});
export type Extraction = z.infer<typeof Extraction>;

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s,]+/g, " ")
    .trim();
const DATE_IN_FIGURES = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/g;

const CURRENCY_WORDS: Record<string, RegExp> = {
  MUR: /\bmur\b|mauritian|mauritius|mauricienne?s?\b/i,
  INR: /\binr\b|indian/i,
  PKR: /\bpkr\b|pakistan/i,
  LKR: /\blkr\b|sri lank/i,
  NPR: /\bnpr\b|nepal/i,
  USD: /\busd\b|us ?\$|us dollar|american dollar/i,
  EUR: /\beur\b|euro|€/i,
  GBP: /\bgbp\b|pound|£|livres? sterling/i,
  AUD: /\baud\b|australian/i,
  CAD: /\bcad\b|canadian/i,
  SGD: /\bsgd\b|singapore/i,
  ZAR: /\bzar\b|\brand\b/i,
};

export interface ApplyResult {
  fields: Field[];
  changed: string[];
  rejected: string[];
}

/**
 * Commits only updates that (1) name a real field, (2) are backed by text the user actually
 * wrote, and (3) pass deterministic validation. Nothing is parsed out of prose.
 */
export function applyExtraction(
  fields: Field[],
  extraction: Extraction,
  userMessage: string,
  templateCurrency: string | null,
  lang: Lang = "unknown",
): ApplyResult {
  const next = fields.map((f) => ({ ...f }));
  const byId = new Map(next.map((f) => [f.id, f]));
  const msg = squash(userMessage);
  const changed = new Set<string>();
  const rejected: string[] = [];
  const confirmedCurrency = next.find((f) => f.normalized?.kind === "money" && f.status === "confirmed" && f.normalized.currency !== "XXX")?.normalized;
  for (const u of extraction.updates.slice(0, 40)) {
    const f = byId.get(u.fieldId);
    if (!f) {
      rejected.push(`unknown field ${u.fieldId}`);
      continue;
    }
    if (!u.evidence.trim() || !msg.includes(squash(u.evidence))) {
      rejected.push(`no evidence in message for ${u.fieldId}`);
      continue;
    }
    const userCurrency = u.currency && CURRENCY_WORDS[u.currency.toUpperCase()]?.test(userMessage) ? u.currency.toUpperCase() : null;
    const hint = userCurrency ?? templateCurrency ?? (confirmedCurrency?.kind === "money" ? confirmedCurrency.currency : null);
    // A date the user wrote in figures is checked as written: the model must not settle 03/04/2026 by itself.
    const figures = f.valueType === "date" ? [...u.evidence.matchAll(DATE_IN_FIGURES)].map(([d]) => d) : [];
    const value = figures.length === 1 ? (figures[0] ?? u.value) : u.value;
    const r = normalizeValue(f.valueType, value, { currencyHint: hint, lang });
    if (f.rawValue === value && f.status === r.status) continue;
    Object.assign(f, { rawValue: value, status: r.status, displayValue: r.displayValue, normalized: r.normalized, note: r.note });
    changed.add(f.id);
  }
  for (const issue of chronologyIssues(next)) {
    const f = byId.get(issue.fieldId);
    if (f?.status === "confirmed") {
      f.status = "needs_clarification";
      f.note = issue.note;
      changed.add(f.id);
    }
  }
  return { fields: next, changed: [...changed], rejected };
}

const EXTRACT_SYSTEM = `You extract contract field values from a lawyer's chat message. Messages may be in English, French or a mix; fields may have been asked in another language than the answer.
- Only extract values the user actually stated in their LATEST message. Never guess, infer or invent names, addresses, dates, amounts, numbers or registration details.
- A relative date the user states ("today", "aujourd'hui", "tomorrow", "demain") is worked out from TODAY and written in full, e.g. "24 September 2026".
- Keep names, addresses and identifiers exactly as written, with their accents. Do not translate them.
- For boolean (yes/no) fields put "yes" or "no" in value only if the user clearly answered; "I don't know" or "maybe" is not an answer. Never infer a yes/no answer from a job title or other facts.
- For amounts keep the digits and separators exactly as written (e.g. "1 250,50 EUR").
- One message can answer several fields. A correction ("actually the tenant is …") updates the field again.
- Keep the user's wording for names and addresses; fix obvious typos only in dates/amounts.
- For money, put the amount (and any symbol the user used) in value; set currency only if the user named it.
- If the user asks what a clause means or whether it is usual, list the relevant block ids in clauseBlockIds.
- If the message only asks a question, return no updates.
${SAFETY_RULES}`;

const fieldLine = (f: Field) =>
  `${f.id} | ${f.label} | ${f.valueType} | ${f.status}${f.displayValue ? ` = ${f.displayValue}` : ""} | ${(f.question ?? f.context).replace(/\s+/g, " ").slice(0, 140)}`;

export function outline(blocks: Block[]): string {
  return blocks
    .filter((b) => b.partKind === "body" && b.text.trim())
    .slice(0, 250)
    .map((b) => `${b.id} | ${b.text.replace(/\s+/g, " ").slice(0, 90)}`)
    .join("\n");
}

export interface TurnInput {
  model: LanguageModel;
  fields: Field[];
  blocks: Block[];
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  abortSignal?: AbortSignal;
}

/** The server's calendar date. ponytail: send the browser's date instead if users work in another time zone than the server. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function extract(input: TurnInput) {
  // Without today's date the model answered "take today's date" with a date of its own invention.
  const prompt = `TODAY: ${today()}\n\nFIELDS (id | label | type | status | context):\n${input.fields.map(fieldLine).join("\n")}\n\n${untrusted("template", `CLAUSE OUTLINE (id | start of text):\n${outline(input.blocks)}`)}\n\nRECENT CONVERSATION:\n${input.history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join("\n")}\n\n${untrusted("user_message", input.userMessage)}`;
  const run = (extra = "") =>
    generateText({
      model: input.model,
      system: EXTRACT_SYSTEM,
      prompt: prompt + extra,
      output: Output.object({ schema: Extraction }),
      maxOutputTokens: 2000,
      maxRetries: 2,
      abortSignal: input.abortSignal,
      providerOptions: providerOptions(),
    });
  try {
    let result;
    try {
      result = await run();
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err) || err.finishReason === "length") throw err;
      result = await run("\n\nReturn valid JSON matching the schema.");
    }
    if (result.finishReason === "length") throw new AiError("truncated", "The AI response was cut off; your answer was not saved. Please retry.", true);
    return { extraction: result.output, usage: result.usage };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err))
      throw new AiError(
        err.finishReason === "length" ? "truncated" : "invalid_output",
        "I couldn't process that answer reliably; nothing was saved. Please retry.",
        true,
      );
    throw err;
  }
}
