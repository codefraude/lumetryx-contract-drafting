import {
  generateText,
  NoObjectGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import {
  Resolution,
  VariantLang,
  type Field,
  type Lang,
} from "@/features/documents/contracts/fields";
import { variantLangs } from "@/features/documents/progress";
import type { Block } from "@/server/docx/blocks";
import { CURRENCY_WORDS, currencyOf } from "@/server/fields/currency";
import { issue, issueNote } from "@/server/fields/issues";
import { messageLanguage } from "@/server/fields/lang";
import { chronologyIssues, spelledNumbers } from "@/server/fields/normalize";
import { resolveField } from "@/server/fields/resolve";
import { ownerOf, plain } from "@/server/fields/semantics";
import { AiError, SAFETY_RULES, providerOptions, untrusted } from "./model";

export const Extraction = z.object({
  updates: z.array(
    z.object({
      fieldId: z.string(),
      resolution: Resolution.optional().describe(
        "Omit or value: the user gave the value. none: the user said there is none (e.g. no additional occupants). not_applicable: the user said it does not apply. unknown: the user said they do not know yet. left_blank: the user asked to leave it blank.",
      ),
      value: z
        .string()
        .max(400)
        .describe(
          "The value exactly as it should appear in the contract, using the user's wording. Empty unless resolution is value.",
        ),
      currency: z
        .string()
        .nullable()
        .describe(
          "ISO 4217 code ONLY if the user explicitly named the currency, else null",
        ),
      evidence: z
        .string()
        .max(400)
        .describe(
          "Verbatim substring of the user's latest message that states this value or resolution",
        ),
      keepFormat: z
        .boolean()
        .optional()
        .describe(
          "true only when the user explicitly asks for this date to be written the way they wrote it, e.g. in figures",
        ),
      sameAs: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Id of the field whose recorded value the user points to (e.g. 'same address as the landlord'), only when it is clear which field; else null",
        ),
      translation: z
        .object({
          lang: VariantLang,
          value: z.string().max(500),
        })
        .nullable()
        .optional()
        .describe(
          "Only for fields marked [bilingual]: the same value in the other language, a faithful translation that keeps names, numbers and meaning unchanged; else null",
        ),
    }),
  ),
  clauseBlockIds: z
    .array(z.string())
    .max(6)
    .describe("Block ids of clauses the user is asking about, if any"),
});

export type Extraction = z.infer<typeof Extraction>;
type Update = Extraction["updates"][number];

const squash = (s: string) => {
  return s
    .toLowerCase()
    .replace(/[\s,]+/g, " ")
    .trim();
};

const DATE_IN_FIGURES = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/g;
const FORMAT_REQUEST =
  /\b(format|figures?|digits|numeric|as written|write (it|the date)|chiffres|numérique|tel quel)\b/i;
const QUESTION_START =
  /^(is|are|was|were|do|does|did|can|could|should|would|will|shall|may|must|what|why|how|when|where|who|whom|which|isn't|aren't|est-ce|est-il|est-elle|qu['’]est|que|quel|quelle|quels|quelles|pourquoi|comment|quand|où|qui|combien|peut-on|faut-il|dois-je|puis-je|pouvez-vous)\b/i;
const REFERENCE =
  /\b(same|identical|as above|idem|ditto|like the|as for|même|identique|pareil|comme (pour|celle|celui))\b/i;
const MONTH =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|fev|mars|avr|mai|juin|juil|aout|sept|dec)/;
const RELATIVE =
  /\b(today|tomorrow|yesterday|next|last|aujourd|demain|hier|prochain|dernier)/;

type Kind = NonNullable<Update["resolution"]>;

const RESOLUTION_WORDS: Record<Exclude<Kind, "value">, RegExp> = {
  none: /\b(none|no one|nobody|nothing|nil|there (are|is|will be) no|no (additional|other|extra|more|one)|aucun|aucune|personne|néant|rien|il n['’]y a pas|pas d['e])\b|^\s*no\b|^\s*non\b/i,
  not_applicable:
    /(not applicable|n\/a|\bna\b|does(n['’]t| not) apply|irrelevant|sans objet|non applicable|ne s['’]applique pas|pas applicable)/i,
  unknown:
    /(don['’]?t know|do not know|not sure|unsure|no idea|(haven['’]?t|not) decided|not yet|tbd|to be (confirmed|determined)|later|je ne sais pas|sais pas|pas sûr|aucune idée|pas encore|plus tard|à confirmer|inconnu)/i,
  left_blank:
    /(blank|empty|by hand|fill (it )?in (later|myself)|en blanc|vide|à la main)/i,
};
const ROLE_WORDS = {
  contact: /\bcontact/i,
  signatory: /\b(sign|signator|signataire|signe|signera|authori[sz]ed)/i,
};
const GENERIC_WORDS = new Set([
  "address",
  "adresse",
  "name",
  "nom",
  "date",
  "email",
  "the",
  "of",
  "du",
  "de",
  "la",
  "le",
]);

export interface ApplyResult {
  fields: Field[];
  changed: string[];
  rejected: string[];
}

const sentenceOf = (message: string, evidence: string) => {
  const needle = squash(evidence);

  return (
    message
      .split(/(?<=[.!?])\s+|\n+/)
      .find((s) => squash(s).includes(needle)) ?? message
  );
};

export const asksRatherThanAnswers = (message: string, evidence: string) => {
  const s = sentenceOf(message, evidence).trim();

  return s.endsWith("?") && QUESTION_START.test(s);
};

const tokensIn = (value: string, message: string) => {
  const m = ` ${plain(message)} `;
  const tokens = plain(value)
    .split(" ")
    .filter((t) => t.length >= 2);

  if (!tokens.length) {
    return plain(message).includes(plain(value));
  }

  const found = tokens.filter((t) => m.includes(` ${t} `) || m.includes(t));

  return found.length / tokens.length >= 0.8;
};

export function grounded(f: Field, u: Update, message: string): boolean {
  const value = u.value.trim();

  switch (f.valueType) {
    case "date": {
      const e = plain(u.evidence);

      return /\d/.test(e) || MONTH.test(e) || RELATIVE.test(e);
    }
    case "money":
    case "number":
    case "duration":
    case "percentage": {
      const d = value.replace(/\D/g, "");

      return d
        ? message.replace(/\D/g, "").includes(d) ||
            spelledNumbers(message).includes(Number(d))
        : tokensIn(value, message);
    }
    case "boolean":
      return true;
    case "currency":
      return (
        (currencyOf(value) !== null &&
          currencyOf(value) === currencyOf(message)) ||
        tokensIn(value, message)
      );
    default:
      return tokensIn(value, message);
  }
}

const mentions = (evidence: string, target: Field) => {
  const e = plain(evidence);
  const words = plain(target.label)
    .split(" ")
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));

  return (
    words.some((w) => e.includes(w)) ||
    (target.owner !== null && ownerOf(evidence) === target.owner)
  );
};

const labelOf = (f: Field) => {
  return f.label;
};

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
  const seen = new Map<string, string>();
  const answeredCurrency = currencyOf(
    next.find(
      (f) =>
        f.status === "confirmed" &&
        f.valueType !== "money" &&
        (f.valueType === "currency" || /currency|devise/i.test(f.label)),
    )?.displayValue ?? "",
  );
  const confirmedCurrency = next.find(
    (f) =>
      f.normalized?.kind === "money" &&
      f.status === "confirmed" &&
      f.normalized.currency !== "XXX",
  )?.normalized;
  const updates = extraction.updates.slice(0, 40);

  const sharedRole = (u: Update, f: Field) => {
    if (!f.role || ROLE_WORDS[f.role].test(u.evidence)) {
      return false;
    }

    return updates.some((other) => {
      const g = other !== u ? byId.get(other.fieldId) : undefined;

      return (
        g !== undefined &&
        g.role !== null &&
        g.role !== f.role &&
        squash(other.value) === squash(u.value)
      );
    });
  };

  const unclear = (f: Field, i: ReturnType<typeof issue>) => {
    Object.assign(f, {
      status: "needs_clarification",
      resolution: null,
      note: issueNote(i),
      issue: i,
    });

    changed.add(f.id);
  };

  for (const u of updates) {
    const f = byId.get(u.fieldId);
    const kind: Kind = u.resolution ?? "value";

    if (!f) {
      rejected.push(`unknown field ${u.fieldId}`);
      continue;
    }

    if (!u.evidence.trim() || !msg.includes(squash(u.evidence))) {
      rejected.push(`no evidence in message for ${u.fieldId}`);
      continue;
    }

    if (asksRatherThanAnswers(userMessage, u.evidence)) {
      rejected.push(`question, not an answer, for ${u.fieldId}`);
      continue;
    }

    if (kind !== "value" && !RESOLUTION_WORDS[kind].test(u.evidence)) {
      rejected.push(`${kind} not stated for ${u.fieldId}`);
      continue;
    }

    if (sharedRole(u, f)) {
      rejected.push(`${f.role} not stated for ${u.fieldId}`);
      continue;
    }

    let value = u.value;

    if (kind === "value" && u.sameAs) {
      const target = byId.get(u.sameAs);

      if (
        !target ||
        target === f ||
        target.status !== "confirmed" ||
        !target.rawValue ||
        !REFERENCE.test(u.evidence)
      ) {
        rejected.push(`unclear reference for ${u.fieldId}`);
        continue;
      }

      const rivals = next.filter(
        (g) =>
          g !== target &&
          g !== f &&
          g.status === "confirmed" &&
          g.valueType === target.valueType &&
          g.rawValue !== null &&
          g.rawValue !== target.rawValue,
      );

      if (rivals.length && !mentions(u.evidence, target)) {
        unclear(
          f,
          issue("ambiguous_reference", {
            evidence: u.evidence,
            candidates: [target, ...rivals].map(labelOf).join(" / "),
          }),
        );

        continue;
      }

      value = target.rawValue;
    } else if (
      kind === "value" &&
      !grounded(f, u, userMessage) &&
      !(f.rawValue !== null && squash(u.value) === squash(f.rawValue))
    ) {
      rejected.push(`value not in the message for ${u.fieldId}`);
      continue;
    }

    const key = `${kind}:${squash(value)}`;
    const prior = seen.get(f.id);

    if (prior !== undefined && prior !== key) {
      unclear(
        f,
        issue("conflicting_values", {
          values: [prior, key]
            .map((k) => k.replace(/^[a-z_]+:/, ""))
            .join(" / "),
        }),
      );

      continue;
    }

    seen.set(f.id, key);

    const userCurrency =
      u.currency && CURRENCY_WORDS[u.currency.toUpperCase()]?.test(userMessage)
        ? u.currency.toUpperCase()
        : null;
    const hint =
      userCurrency ??
      templateCurrency ??
      answeredCurrency ??
      (confirmedCurrency?.kind === "money" ? confirmedCurrency.currency : null);
    const figures =
      f.valueType === "date"
        ? [...u.evidence.matchAll(DATE_IN_FIGURES)].map(([d]) => d)
        : [];
    const [only] = figures;
    const given = figures.length === 1 && only ? only : value;
    const keptFigures =
      f.normalized?.kind === "date" && Boolean(f.normalized.figures);
    const keep =
      figures.length === 1 &&
      ((u.keepFormat === true && FORMAT_REQUEST.test(userMessage)) ||
        keptFigures);
    const typed = messageLanguage(given);
    const resolved = resolveField(
      f,
      {
        resolution: kind,
        value: given,
        lang: typed !== "unknown" ? typed : lang,
        translation: variantLangs(f).length ? (u.translation ?? null) : null,
        evidence: u.evidence,
        figures: keep ? given : null,
      },
      {
        currencyHint: hint,
        lang,
      },
    );

    if (
      resolved.rawValue === f.rawValue &&
      resolved.status === f.status &&
      resolved.displayValue === f.displayValue &&
      resolved.resolution === f.resolution &&
      JSON.stringify(resolved.variants) === JSON.stringify(f.variants)
    ) {
      continue;
    }

    Object.assign(f, resolved);
    changed.add(f.id);
  }

  for (const c of chronologyIssues(next)) {
    const f = byId.get(c.fieldId);

    if (f?.status === "confirmed") {
      unclear(f, c.issue);
    }
  }

  return {
    fields: next,
    changed: [...changed],
    rejected,
  };
}

const EXTRACT_SYSTEM = `You extract contract field values from a lawyer's chat message. Messages may be in English, French or a mix; fields may have been asked in another language than the answer.
- Only extract values the user actually stated in their LATEST message. Never guess, infer or invent names, addresses, dates, amounts, numbers, currencies, authority to sign or contract terms.
- One message can answer several fields, in any order, including fields that were not asked yet. Extract every clearly supported answer, not only the answer to the last question. A correction ("actually the tenant is …", "change the rent to …") updates the field again.
- A question from the user ("Is a 500 EUR deposit usual?", "What does clause 3 mean?") is not an answer: return no update for it.
- Never copy a value into another field unless the user says so. A contact person is not the signatory, and a signatory's name is not their job title, unless the user says so.
- resolution: "none" when the user says there is none ("no additional occupants", "aucun"); "not_applicable" when they say it does not apply; "unknown" when they say they do not know yet; "left_blank" when they ask to leave it blank. Zero is a value ("0"), not none.
- When the user points to another recorded value ("same address as the landlord"), set sameAs to that field's id and value to its recorded value, only if it is clear which field; if several could match, return no update.
- A relative date the user states ("today", "aujourd'hui", "tomorrow", "demain") is worked out from TODAY and written in full, e.g. "24 September 2026".
- Dates are written in full in the contract ("26 September 2026"). Set keepFormat to true only when the user explicitly asks for a date to be written another way, e.g. "put the date as 26/09/2026" or "write it in figures"; then put the date exactly as they wrote it in value.
- Keep names, addresses, company names (with their suffix and punctuation) and identifiers exactly as written, with their accents. Do not translate them.
- For fields marked [bilingual], also give translation: the same text in the other language, faithful, keeping names, numbers and meaning unchanged. Never translate other fields.
- For boolean (yes/no) fields put "yes" or "no" in value only if the user clearly answered; "I don't know" or "maybe" is not an answer. Never infer a yes/no answer from a job title or other facts.
- For amounts keep the digits and separators exactly as written (e.g. "1 250,50 EUR"); set currency only if the user named it.
- For numbers counted in a unit, put the number the user gave; if they used another unit than the field's, still copy what they wrote.
- If the user asks what a clause means or whether it is usual, list the relevant block ids in clauseBlockIds.
- If the message only asks a question, return no updates.
${SAFETY_RULES}`;

const fieldLine = (f: Field) => {
  const bilingual = variantLangs(f).length ? " [bilingual]" : "";
  const unit = f.unit ? ` in ${f.unit.replace("_", " ")}` : "";
  const owner = f.owner ? ` (belongs to ${f.owner})` : "";
  const state =
    f.resolution && f.resolution !== "value"
      ? f.resolution
      : `${f.status}${f.displayValue ? ` = ${f.displayValue}` : ""}`;

  return `${f.id} | ${f.label}${owner} | ${f.valueType}${unit}${bilingual} | ${state} | ${(f.question ?? f.context).replace(/\s+/g, " ").slice(0, 140)}`;
};

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
  history: {
    role: "user" | "assistant";
    content: string;
  }[];
  userMessage: string;
  today?: string;
  abortSignal?: AbortSignal;
}

export const serverToday = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function extract(input: TurnInput) {
  const prompt = `TODAY: ${input.today ?? serverToday()}\n\nFIELDS (id | label | type | state | context):\n${input.fields.map(fieldLine).join("\n")}\n\n${untrusted("template", `CLAUSE OUTLINE (id | start of text):\n${outline(input.blocks)}`)}\n\nRECENT CONVERSATION:\n${input.history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join("\n")}\n\n${untrusted("user_message", input.userMessage)}`;

  const run = (extra = "") => {
    return generateText({
      model: input.model,
      system: EXTRACT_SYSTEM,
      prompt: prompt + extra,
      output: Output.object({ schema: Extraction }),
      maxOutputTokens: 2000,
      maxRetries: 2,
      abortSignal: input.abortSignal,
      providerOptions: providerOptions(),
    });
  };

  try {
    let result;

    try {
      result = await run();
    } catch (err) {
      if (
        !NoObjectGeneratedError.isInstance(err) ||
        err.finishReason === "length"
      ) {
        throw err;
      }

      result = await run("\n\nReturn valid JSON matching the schema.");
    }

    if (result.finishReason === "length") {
      throw new AiError(
        "truncated",
        "The response was cut off, so your answer was not saved. Retry, or send a shorter message.",
        true,
      );
    }

    return {
      extraction: result.output,
      usage: result.usage,
    };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      throw new AiError(
        err.finishReason === "length" ? "truncated" : "invalid_output",
        "That answer could not be read reliably, so nothing was saved. Retry, or rephrase it.",
        true,
      );
    }

    throw err;
  }
}
