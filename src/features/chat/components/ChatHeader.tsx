"use client";

import type { ChatLanguage, DocLanguage } from "@/features/documents/contracts/fields";

const LANGS: { value: ChatLanguage | null; label: string }[] = [
  { value: null, label: "Auto" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

const TEMPLATE_LANG: Partial<Record<DocLanguage, string>> = { mixed: "Bilingual template.", fr: "French template." };

/** Assistant identity and conversation language; progress lives in the header status and the tab counts. */
export function ChatHeader({
  language,
  onLanguage,
}: {
  language: { document: DocLanguage; conversation: ChatLanguage | null; effective: ChatLanguage } | null;
  onLanguage(l: ChatLanguage | null): void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold text-ink">Drafting assistant</p>
        <p className="text-meta text-ink-3">
          {language ? `Replies in ${language.effective === "fr" ? "French" : "English"}. ${TEMPLATE_LANG[language.document] ?? ""}` : "Off for this template"}
        </p>
      </div>
      {language && (
        <div
          role="group"
          aria-label="Conversation language"
          title="Auto answers in the language you write in"
          className="flex shrink-0 rounded-control border border-line bg-subtle p-0.5"
        >
          {LANGS.map((l) => {
            const on = language.conversation === l.value;
            return (
              <button
                key={l.label}
                type="button"
                aria-pressed={on}
                onClick={() => onLanguage(l.value)}
                className={`h-7 rounded-[4px] px-2 text-meta font-medium transition-colors duration-150 pointer-coarse:h-11 ${on ? "bg-surface text-ink ring-1 ring-control dark:bg-raised" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
