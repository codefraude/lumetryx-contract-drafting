import { generateText, NoObjectGeneratedError, Output, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import type { Block } from "../docx/ooxml";
import { chronologyIssues, normalizeValue } from "../fields/normalize";
import { GROUP_ORDER, outstandingFields, type ChatLanguage, type Field, type Lang } from "../fields/types";
import { AiError, SAFETY_RULES, providerOptions, untrusted } from "./model";

export const Extraction = z.object({
  // Gemini rejects maxItems on arrays of objects (HTTP 400); the 40 cap is applied in applyExtraction.
  updates: z
    .array(
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

const squash = (s: string) => s.toLowerCase().replace(/[\s,]+/g, " ").trim();

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
export function applyExtraction(fields: Field[], extraction: Extraction, userMessage: string, templateCurrency: string | null, lang: Lang = "unknown"): ApplyResult {
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
    const r = normalizeValue(f.valueType, u.value, { currencyHint: hint, lang });
    if (f.rawValue === u.value && f.status === r.status) continue;
    Object.assign(f, { rawValue: u.value, status: r.status, displayValue: r.displayValue, normalized: r.normalized, note: r.note });
    changed.add(f.id);
  }
  for (const issue of chronologyIssues(next)) {
    const f = byId.get(issue.fieldId)!;
    if (f.status === "confirmed") {
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

const fieldLine = (f: Field) => `${f.id} | ${f.label} | ${f.valueType} | ${f.status}${f.displayValue ? ` = ${f.displayValue}` : ""} | ${(f.question ?? f.context).replace(/\s+/g, " ").slice(0, 140)}`;

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
    generateText({ model: input.model, system: EXTRACT_SYSTEM, prompt: prompt + extra, output: Output.object({ schema: Extraction }), maxOutputTokens: 2000, maxRetries: 2, abortSignal: input.abortSignal, providerOptions: providerOptions() });
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
    if (NoObjectGeneratedError.isInstance(err)) throw new AiError(err.finishReason === "length" ? "truncated" : "invalid_output", "I couldn't process that answer reliably; nothing was saved. Please retry.", true);
    throw err;
  }
}

/** Relevant clause text: the referenced blocks plus their nested sub-clauses. */
export function clauseContext(blocks: Block[], ids: string[]): string {
  const body = blocks.filter((b) => b.partKind === "body");
  const parts: string[] = [];
  for (const id of ids) {
    const i = body.findIndex((b) => b.id === id);
    if (i < 0) continue;
    const root = body[i]!;
    const lvl = root.numbering?.ilvl ?? -1;
    const chunk = [root.text];
    for (let j = i + 1; j < body.length && chunk.length < 8; j++) {
      const b = body[j]!;
      if (!b.numbering || b.numbering.ilvl <= lvl) break;
      chunk.push(b.text);
    }
    parts.push(`[${id}] ${chunk.join("\n")}`);
  }
  return parts.join("\n\n");
}

const REPLY_SYSTEM = `You are a careful, friendly drafting assistant helping a lawyer complete their own contract template.
Style: plain language, concise (under 120 words unless explaining a clause), no JSON, no markdown headings.
Language: write the whole reply in the REPLY LANGUAGE given (English or French), even if the template or earlier messages use the other language. When quoting the contract, quote it in its original language. Never translate or rewrite the contract itself.
Rules:
- Briefly confirm what was just recorded: only the items in JUST RECORDED, with their values exactly. Never say that anything else was recorded.
- If any field NEEDS CLARIFICATION, ask about it first using its note.
- Then ask for the items in NEXT TO ASK in one natural question, using the suggested wording when there is one.
- Ask only for the items in NEEDS CLARIFICATION and NEXT TO ASK. Never ask for anything else (a reference number, a subject line, whether a party is a company…): an answer to it cannot be recorded.
- A yes/no condition decides whether a clause is included. Ask it neutrally; never suggest which answer is appropriate, usual or enforceable.
- If the user asked about a clause, explain it using ONLY the clause text provided. If asked whether it is usual, give a cautious, general answer, say that the document alone cannot establish market practice or enforceability in their jurisdiction, and do not cite laws, cases or statistics. Then return to the outstanding questions.
- Say that the draft is ready to generate with the "Generate draft" button only when READY TO GENERATE is yes. Otherwise never say that it is ready or that nothing is missing.
- Never claim to have verified a company, a registry or the law.
${SAFETY_RULES}`;

export function replyPrompt(fields: Field[], changed: string[], clauseText: string, userMessage: string, history: TurnInput["history"], lang: ChatLanguage = "en", inactive: ReadonlySet<string> = new Set()): string {
  const outstanding = outstandingFields(fields, inactive);
  const nextGroup = GROUP_ORDER.find((g) => outstanding.some((f) => f.group === g && f.status === "missing"));
  const clarify = outstanding.filter((f) => f.status === "needs_clarification");
  const next = outstanding.filter((f) => f.status === "missing" && f.group === nextGroup).slice(0, 3);
  // Named, not counted: given only a number, the model made up questions to fill it and took the
  // list for done when two fields had similar names.
  const later = outstanding.filter((f) => !clarify.includes(f) && !next.includes(f));
  return [
    `JUST RECORDED: ${changed.length ? fields.filter((f) => changed.includes(f.id) && f.status === "confirmed").map((f) => `${f.label} = ${f.displayValue}`).join("; ") || "nothing confirmed" : "nothing"}`,
    `NEEDS CLARIFICATION: ${clarify.map((f) => `${f.label}: ${f.note ?? "unclear"}`).join("; ") || "none"}`,
    `REPLY LANGUAGE: ${lang === "fr" ? "French" : "English"}`,
    `NEXT TO ASK: ${next.map((f) => `${f.label}${f.valueType === "boolean" ? " [yes/no]" : ""}${questionIn(f, lang) ? ` (suggested: ${questionIn(f, lang)})` : ""}`).join("; ") || "none"}`,
    `STILL NEEDED LATER (do not ask yet): ${later.map((f) => f.label).join("; ") || "none"}`,
    `READY TO GENERATE: ${outstanding.length ? "no" : "yes"}`,
    clauseText ? untrusted("clause", clauseText) : "",
    `RECENT CONVERSATION:\n${history.slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join("\n")}`,
    untrusted("user_message", userMessage),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function streamReply(model: LanguageModel, prompt: string, abortSignal?: AbortSignal) {
  return streamText({ model, system: REPLY_SYSTEM, prompt, maxOutputTokens: 700, maxRetries: 2, abortSignal, providerOptions: providerOptions() });
}

const questionIn = (f: Field, lang: ChatLanguage) => (lang === "fr" ? (f.questionFr ?? null) : (f.question ?? null));

const GROUP_NAMES: Record<ChatLanguage, Record<Field["group"], string>> = {
  en: { parties: "the parties", subject: "the property or services", dates: "the dates", money: "the amounts", other: "the remaining details" },
  fr: { parties: "les parties", subject: "le bien ou les services", dates: "les dates", money: "les montants", other: "les autres éléments" },
};

const joinList = (items: string[], lang: ChatLanguage = "en") => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${lang === "fr" ? "et" : "and"} ${items.at(-1)}`);

/** Deterministic next question (no LLM call), in the conversation language. */
function nextQuestion(out: Field[], lang: ChatLanguage): string {
  const group = out[0]!.group;
  const first = out.filter((f) => f.group === group).slice(0, 3);
  const q = questionIn(first[0]!, lang);
  if (lang === "fr") return q ? `Commençons par ${GROUP_NAMES.fr[group]}. ${q}` : `Commençons par ${GROUP_NAMES.fr[group]} : ${joinList(first.map((f) => f.label.toLowerCase()), "fr")}.`;
  return q ? `Let's start with ${GROUP_NAMES.en[group]}. ${q}` : `Let's start with ${GROUP_NAMES.en[group]}: ${joinList(first.map((f) => f.label.toLowerCase()))}.`;
}

/** Opening message; asks the first group without an LLM call. */
export function openingMessage(fields: Field[], lang: ChatLanguage = "en", inactive: ReadonlySet<string> = new Set()): string {
  const out = outstandingFields(fields, inactive);
  if (lang === "fr") {
    if (!out.length) return "Je n'ai trouvé aucun élément à compléter dans ce modèle. Vous pouvez le relire dans le panneau du document.";
    return `J'ai trouvé ${out.length} élément${out.length === 1 ? "" : "s"} à compléter dans ce modèle. ${nextQuestion(out, "fr")}`;
  }
  if (!out.length) return "I didn't find any fields to fill in this template. You can review it in the document panel.";
  return `I found ${out.length} item${out.length === 1 ? "" : "s"} to complete in this template. ${nextQuestion(out, "en")}`;
}

/** Posted when the user switches the conversation language: confirms, keeps every answer, and asks the next open question. */
export function languageSwitchMessage(fields: Field[], lang: ChatLanguage, inactive: ReadonlySet<string>): string {
  const out = outstandingFields(fields, inactive);
  const done = fields.filter((f) => f.status === "confirmed").length;
  if (lang === "fr") return `D'accord, je continue en français. Vos ${done} réponse${done === 1 ? "" : "s"} déjà confirmée${done === 1 ? "" : "s"} sont conservées et le contrat n'est pas traduit.${out.length ? ` ${nextQuestion(out, "fr").replace(/^Commençons par/, "Poursuivons avec")}` : " Tout est prêt pour générer le projet."}`;
  return `Sure, I'll continue in English. Your ${done} confirmed answer${done === 1 ? " is" : "s are"} kept and the contract itself is not translated.${out.length ? ` ${nextQuestion(out, "en").replace(/^Let's start with/, "Next,")}` : " Everything is ready to generate the draft."}`;
}
