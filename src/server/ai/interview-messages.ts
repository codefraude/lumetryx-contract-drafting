import type { ChatLanguage, Field } from "@/features/documents/contracts/fields";
import { outstandingFields } from "@/features/documents/progress";
import { questionIn } from "./reply";

/** Messages the assistant posts without a model call: the opening question and the language switch. */

const GROUP_NAMES: Record<ChatLanguage, Record<Field["group"], string>> = {
  en: { parties: "the parties", subject: "the property or services", dates: "the dates", money: "the amounts", other: "the remaining details" },
  fr: { parties: "les parties", subject: "le bien ou les services", dates: "les dates", money: "les montants", other: "les autres éléments" },
};

const joinList = (items: string[], lang: ChatLanguage = "en") =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${lang === "fr" ? "et" : "and"} ${items.at(-1)}`;

/** Deterministic next question (no LLM call), in the conversation language. */
function nextQuestion(out: Field[], lang: ChatLanguage): string {
  const [head] = out;
  if (!head) return "";
  const { group } = head;
  const first = out.filter((f) => f.group === group).slice(0, 3);
  const q = questionIn(head, lang);
  if (lang === "fr")
    return q
      ? `Commençons par ${GROUP_NAMES.fr[group]}. ${q}`
      : `Commençons par ${GROUP_NAMES.fr[group]} : ${joinList(
          first.map((f) => f.label.toLowerCase()),
          "fr",
        )}.`;
  return q
    ? `Let's start with ${GROUP_NAMES.en[group]}. ${q}`
    : `Let's start with ${GROUP_NAMES.en[group]}: ${joinList(first.map((f) => f.label.toLowerCase()))}.`;
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
  if (lang === "fr")
    return `D'accord, je continue en français. Vos ${done} réponse${done === 1 ? "" : "s"} déjà confirmée${done === 1 ? "" : "s"} sont conservées et le contrat n'est pas traduit.${out.length ? ` ${nextQuestion(out, "fr").replace(/^Commençons par/, "Poursuivons avec")}` : " Tout est prêt pour générer le projet."}`;
  return `Sure, I'll continue in English. Your ${done} confirmed answer${done === 1 ? " is" : "s are"} kept and the contract itself is not translated.${out.length ? ` ${nextQuestion(out, "en").replace(/^Let's start with/, "Next,")}` : " Everything is ready to generate the draft."}`;
}
