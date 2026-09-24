import { streamText, type LanguageModel } from "ai";
import { GROUP_ORDER, type ChatLanguage, type Field } from "@/features/documents/contracts/fields";
import { outstandingFields } from "@/features/documents/progress";
import type { Block } from "@/server/docx/blocks";
import type { TurnInput } from "./extraction";
import { providerOptions, SAFETY_RULES, untrusted } from "./model";

/** Stage 2 of a chat turn: the streamed reply, told exactly what was recorded and what is still needed. */

/** Relevant clause text: the referenced blocks plus their nested sub-clauses. */
export function clauseContext(blocks: Block[], ids: string[]): string {
  const body = blocks.filter((b) => b.partKind === "body");
  const parts: string[] = [];
  for (const id of ids) {
    const i = body.findIndex((b) => b.id === id);
    const root = body[i];
    if (!root) continue;
    const lvl = root.numbering?.ilvl ?? -1;
    const chunk = [root.text];
    for (const b of body.slice(i + 1)) {
      if (chunk.length >= 8 || !b.numbering || b.numbering.ilvl <= lvl) break;
      chunk.push(b.text);
    }
    parts.push(chunk.join("\n"));
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

/** The streamed reply. A failure inside the stream only ends it, so `failure()` says what went wrong. */
export function streamReply(model: LanguageModel, prompt: string, abortSignal?: AbortSignal) {
  let failure: unknown = null;
  const stream = streamText({ model, system: REPLY_SYSTEM, prompt, maxOutputTokens: 700, maxRetries: 2, abortSignal, providerOptions: providerOptions(), onError: ({ error }) => void (failure = error) });
  return { stream, failure: () => failure };
}

/** The analysis' own wording of a field's question, in the conversation language. */
export const questionIn = (f: Field, lang: ChatLanguage) => (lang === "fr" ? (f.questionFr ?? null) : (f.question ?? null));
