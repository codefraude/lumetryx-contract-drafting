"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useTransition } from "react";
import { LOCALES, type AppLocale } from "@/i18n/locales";
import { setLocale } from "@/i18n/set-locale";

const NAMES: Record<AppLocale, string> = {
  en: "English",
  fr: "Français",
};

export function LanguageControl({ className = "" }: { className?: string }) {
  const t = useTranslations("language");
  const router = useRouter();
  const locale = useLocale();
  const [shown, show] = useOptimistic(locale);
  const [pending, startTransition] = useTransition();
  const name = useId();

  const choose = (next: AppLocale) => {
    startTransition(async () => {
      show(next);
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <fieldset
      aria-busy={pending || undefined}
      className={`relative inline-grid shrink-0 grid-cols-2 rounded-control border border-line bg-subtle p-0.5 ${className}`}
    >
      <legend className="sr-only">{t("legend")}</legend>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/2)] rounded-[4px] bg-surface ring-1 ring-control transition-transform duration-150 ease-(--ease-out) dark:bg-raised"
        style={{ transform: `translateX(${LOCALES.indexOf(shown) * 100}%)` }}
      />
      {LOCALES.map((value) => (
        <label
          key={value}
          lang={value}
          title={NAMES[value]}
          className="relative grid size-8 place-items-center rounded-[4px] text-meta font-semibold text-ink-3 transition-colors duration-150 hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-(--lx-focus) pointer-coarse:size-11"
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={shown === value}
            onChange={() => choose(value)}
            className="sr-only"
          />
          <span aria-hidden>{value.toUpperCase()}</span>
          <span className="sr-only">{NAMES[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
