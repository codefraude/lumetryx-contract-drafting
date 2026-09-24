"use client";

import type { ChatLanguage, DocLanguage } from "@/features/documents/contracts/fields";
import type { DetailProgress } from "@/features/documents/progress";
import { BrandMark } from "@/shared/ui/BrandMark";

const LANGS: { value: ChatLanguage | null; label: string }[] = [
  { value: null, label: "Auto" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

const TEMPLATE_LANG: Partial<Record<DocLanguage, string>> = { mixed: "Bilingual template.", fr: "French template." };

export interface Progress extends DetailProgress {
  /** Clause decisions still to make. */
  decisions: number;
}

/** Assistant identity, conversation language and a short, truthful progress summary. */
export function ChatHeader({ language, onLanguage, progress, onReviewDetails, onReviewClauses }: { language: { document: DocLanguage; conversation: ChatLanguage | null; effective: ChatLanguage } | null; onLanguage(l: ChatLanguage | null): void; progress: Progress; onReviewDetails(): void; onReviewClauses(): void }) {
  const { confirmed, total, decisions } = progress;
  const left = total - confirmed;
  return (
    <div className="shrink-0 border-b border-line px-4 pb-3.5 pt-3 sm:px-5 [@media(max-height:560px)]:py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandMark className="size-7 text-[17px]" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight text-ink">Assistant</p>
            <p className="text-[12.5px] leading-snug text-ink-3">
              {language ? `Replies in ${language.effective === "fr" ? "French" : "English"}. ${TEMPLATE_LANG[language.document] ?? ""}` : "Unavailable for this template"}
            </p>
          </div>
        </div>
        {language && (
          <div role="group" aria-label="Conversation language" title="Auto answers in the language you write in" className="flex shrink-0 rounded-control border border-line bg-subtle p-0.5">
            {LANGS.map((l) => {
              const on = language.conversation === l.value;
              return (
                <button key={l.label} type="button" aria-pressed={on} onClick={() => onLanguage(l.value)} className={`h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors duration-150 pointer-coarse:h-9 ${on ? "bg-surface text-ink shadow-sm ring-1 ring-line dark:bg-raised" : "text-ink-2 hover:text-ink"}`}>
                  {l.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* On short screens (phones held sideways) the header status and the Details tab carry the progress. */}
      {total > 0 && (
        <div className="mt-3 [@media(max-height:560px)]:hidden">
          <div className="flex items-center gap-3">
            <div role="progressbar" aria-label="Required details confirmed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={confirmed} className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-(--ease-out)" style={{ width: `${(confirmed / total) * 100}%` }} />
            </div>
            <span className="text-[12.5px] font-medium tabular-nums text-ink-2">
              {confirmed} of {total}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
            <span>{left ? `${left} ${left === 1 ? "detail" : "details"} still to confirm.` : "All required details are confirmed."}</span>
            {left > 0 && (
              <button type="button" onClick={onReviewDetails} className="font-medium text-accent-ink underline-offset-2 hover:underline">
                Review details
              </button>
            )}
            {decisions > 0 && (
              <button type="button" onClick={onReviewClauses} className="font-medium text-warn underline-offset-2 hover:underline">
                {decisions} clause {decisions === 1 ? "decision" : "decisions"} pending
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
