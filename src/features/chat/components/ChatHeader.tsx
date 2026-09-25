"use client";

import { useTranslations } from "next-intl";
import type {
  ChatLanguage,
  DocLanguage,
} from "@/features/documents/contracts/fields";

const LANGS: {
  value: ChatLanguage | null;
  label: string | null;
}[] = [
  {
    value: null,
    label: null,
  },
  {
    value: "en",
    label: "English",
  },
  {
    value: "fr",
    label: "Français",
  },
];

const TEMPLATE_LANG: Partial<
  Record<DocLanguage, "templateMixed" | "templateFr">
> = {
  mixed: "templateMixed",
  fr: "templateFr",
};

export function ChatHeader({
  language,
  onLanguage,
}: {
  language: {
    document: DocLanguage;
    conversation: ChatLanguage | null;
    effective: ChatLanguage;
  } | null;
  onLanguage(l: ChatLanguage | null): void;
}) {
  const t = useTranslations("chat");
  const templateNote = language && TEMPLATE_LANG[language.document];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold text-ink">{t("title")}</p>
        <p className="text-meta text-ink-3">
          {language
            ? `${t("replies", { language: language.effective })} ${templateNote ? t(templateNote) : ""}`
            : t("off")}
        </p>
      </div>
      {language && (
        <div
          role="group"
          aria-label={t("languageGroup")}
          title={t("languageHint")}
          className="flex shrink-0 rounded-control border border-line bg-subtle p-0.5"
        >
          {LANGS.map((l) => {
            const on = language.conversation === l.value;

            return (
              <button
                key={l.value ?? "auto"}
                type="button"
                aria-pressed={on}
                onClick={() => onLanguage(l.value)}
                className={`h-7 rounded-[4px] px-2 text-meta font-medium transition-colors duration-150 pointer-coarse:h-11 ${on ? "bg-surface text-ink ring-1 ring-control dark:bg-raised" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label ?? t("auto")}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
