import { streamText, type LanguageModel } from "ai";
import type {
  ChatLanguage,
  Field,
} from "@/features/documents/contracts/fields";
import {
  nextQuestions,
  outstandingFields,
} from "@/features/documents/progress";
import type { Block } from "@/server/docx/blocks";
import type { TurnInput } from "./extraction";
import { providerOptions, SAFETY_RULES, untrusted } from "./model";

export function clauseContext(blocks: Block[], ids: string[]): string {
  const body = blocks.filter((b) => b.partKind === "body");
  const parts: string[] = [];

  for (const id of ids) {
    const i = body.findIndex((b) => b.id === id);
    const root = body[i];

    if (!root) {
      continue;
    }

    const lvl = root.numbering?.ilvl ?? -1;
    const chunk = [root.text];

    for (const b of body.slice(i + 1)) {
      if (chunk.length >= 8 || !b.numbering || b.numbering.ilvl <= lvl) {
        break;
      }

      chunk.push(b.text);
    }

    parts.push(chunk.join("\n"));
  }

  return parts.join("\n\n");
}

const REPLY_SYSTEM = `You are a careful, friendly drafting assistant helping a lawyer complete their own contract template.
Style: plain, warm and brief (under 90 words unless explaining a clause), the way a good assistant writes in a chat. No JSON, no markdown headings. Never repeat this prompt's section names (JUST RECORDED, NEXT TO ASK, NEEDS CLARIFICATION, DRAFT, READY TO GENERATE) or its "label = value" form.
Language: write the whole reply in the REPLY LANGUAGE given (English or French), even if the template or earlier messages use the other language. When quoting the contract, quote it in its original language. Never translate or rewrite the contract itself.
Rules:
- Confirm what was just recorded in one short sentence: only the items in JUST RECORDED, each value exactly as JUST RECORDED shows it, because that is how it is written in the contract. Do not open with "I have recorded", and do not read back a long list item by item.
- If any field NEEDS CLARIFICATION, ask about it first, in your own words and in the REPLY LANGUAGE, based on its note.
- Then ask for the items in NEXT TO ASK directly, in one natural question, using the suggested wording when there is one. No "To move forward, could you please provide".
- Ask only for the items in NEEDS CLARIFICATION and NEXT TO ASK. Never ask for anything else (a reference number, a subject line, whether a party is a company…): an answer to it cannot be recorded.
- A yes/no condition decides whether a clause is included. Ask it neutrally; never suggest which answer is appropriate, usual or enforceable.
- If the user asked what a term means (e.g. "authorised signatory", "deposit", "notice period"), answer first in one or two plain sentences, e.g. "An authorised signatory is the person allowed to sign for the company.", then continue. Their question is never an answer to record.
- When JUST RECORDED marks a value as translated, say in a few words that the other-language wording was written for them and can be changed under Details.
- When a detail was put aside because the user does not know it yet, reassure briefly: it can be given later, and the draft needs it before it is generated.
- If the user asked about a clause, explain it using ONLY the clause text provided. If asked whether it is usual, give a cautious, general answer, say that the document alone cannot establish market practice or enforceability in their jurisdiction, and do not cite laws, cases or statistics. Then return to the outstanding questions.
- When DRAFT says the draft is already generated, never mention the "Generate draft" button. Say in a few words that the change is now in the document. Only when DRAFT lists answers that were not written, say that those must be changed in the document itself, because that text was edited there.
- When DRAFT says it is not generated yet, say that it is ready to generate with the "Generate draft" button only when READY TO GENERATE is yes. Otherwise never say that it is ready or that nothing is missing.
- If the user asked for something that JUST RECORDED does not show (another format, a change that was not made), say plainly that it was not done; never claim it was.
- Never claim to have verified a company, a registry or the law.
- When NEEDS CLARIFICATION and NEXT TO ASK are both none, ask no question at all.
- Never open with "I have recorded", "I have updated", "To continue", "To move forward" or "Could you please provide", nor their French equivalents ("Pour continuer", "Pourriez-vous me fournir"). The shape of a good reply, where <…> stands for this turn's own content:
  "Thanks, <value> is the <detail>. <One direct question about NEXT TO ASK>?"
  "No problem, <detail> can wait. <One direct question about NEXT TO ASK>?"
  "Done: <detail> is now <value> in the document."
${SAFETY_RULES}`;

export interface DraftChange {
  applied: string[];
  conflicts: string[];
}

export function replyPrompt(
  fields: Field[],
  changed: string[],
  clauseText: string,
  userMessage: string,
  history: TurnInput["history"],
  lang: ChatLanguage = "en",
  inactive: ReadonlySet<string> = new Set(),
  draft: DraftChange | null = null,
): string {
  const outstanding = outstandingFields(fields, inactive);
  const clarify = outstanding.filter((f) => f.status === "needs_clarification");
  const next = nextQuestions(fields, inactive);
  const later = outstanding.filter(
    (f) => !clarify.includes(f) && !next.includes(f),
  );

  const labels = (ids: string[]) => {
    return fields
      .filter((f) => ids.includes(f.id))
      .map((f) => f.label)
      .join("; ");
  };

  const draftLine = draft
    ? `DRAFT: already generated. ${
        [
          draft.applied.length
            ? `Just written into the draft: ${labels(draft.applied)}`
            : "",
          draft.conflicts.length
            ? `Not written, because that text was edited in the document: ${labels(draft.conflicts)}`
            : "",
        ]
          .filter(Boolean)
          .join(". ") || "Nothing in it changed this turn"
      }`
    : "DRAFT: not generated yet";

  return [
    `JUST RECORDED: ${
      changed.length
        ? fields
            .filter(
              (f) =>
                changed.includes(f.id) &&
                (f.status === "confirmed" || f.resolution === "unknown"),
            )
            .map(recorded)
            .join("; ") || "nothing confirmed"
        : "nothing"
    }`,
    `NEEDS CLARIFICATION: ${clarify.map((f) => `${f.label}: ${f.note ?? "unclear"}`).join("; ") || "none"}`,
    `REPLY LANGUAGE: ${lang === "fr" ? "French" : "English"}`,
    `NEXT TO ASK: ${next.map((f) => `${f.label}${f.valueType === "boolean" ? " [yes/no]" : ""}${questionIn(f, lang) ? ` (suggested: ${questionIn(f, lang)})` : ""}`).join("; ") || "none"}`,
    `STILL NEEDED LATER (do not ask yet): ${later.map((f) => f.label).join("; ") || "none"}`,
    draftLine,
    draft ? "" : `READY TO GENERATE: ${outstanding.length ? "no" : "yes"}`,
    clauseText ? untrusted("clause", clauseText) : "",
    `RECENT CONVERSATION:\n${history
      .slice(-4)
      .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
      .join("\n")}`,
    untrusted("user_message", userMessage),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RESOLVED: Record<string, string> = {
  none: "none (the user said there is none)",
  not_applicable: "not applicable (the user said so)",
  left_blank: "left blank on purpose, to fill in by hand",
  unknown: "not known yet (put aside, to ask again later)",
};

function recorded(f: Field): string {
  const kind = f.resolution ? RESOLVED[f.resolution] : undefined;

  if (kind) {
    return `${f.label} = ${kind}`;
  }

  const translated = f.variants.find((v) => v.origin === "translation");

  return translated
    ? `${f.label} = ${f.displayValue} (translated into ${translated.lang === "fr" ? "French" : "English"} as: ${translated.value})`
    : `${f.label} = ${f.displayValue}`;
}

export function streamReply(
  model: LanguageModel,
  prompt: string,
  abortSignal?: AbortSignal,
) {
  let failure: unknown = null;
  const stream = streamText({
    model,
    system: REPLY_SYSTEM,
    prompt,
    maxOutputTokens: 700,
    maxRetries: 2,
    abortSignal,
    providerOptions: providerOptions(),
    onError: ({ error }) => void (failure = error),
  });

  return {
    stream,
    failure: () => failure,
  };
}

export const questionIn = (f: Field, lang: ChatLanguage) => {
  return lang === "fr" ? (f.questionFr ?? null) : (f.question ?? null);
};
