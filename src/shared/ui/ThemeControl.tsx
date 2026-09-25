"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  currentTheme,
  readPreference,
  setPreference,
  subscribeTheme,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: {
  value: ThemePreference;
  Icon: typeof Sun;
}[] = [
  {
    value: "light",
    Icon: Sun,
  },
  {
    value: "dark",
    Icon: Moon,
  },
  {
    value: "system",
    Icon: Monitor,
  },
];

const noop = () => {
  return undefined;
};

export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();

    return subscribeTheme(noop);
  }, []);

  return null;
}

export function ThemeControl({ className = "" }: { className?: string }) {
  const t = useTranslations("theme");
  const preference = useSyncExternalStore(
    subscribeTheme,
    readPreference,
    () => "system" as const,
  );
  const resolved = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "light" as const,
  );
  const name = useId();
  const index = OPTIONS.findIndex((o) => o.value === preference);

  return (
    <fieldset
      className={`relative inline-grid shrink-0 grid-cols-3 rounded-control border border-line bg-subtle p-0.5 ${className}`}
    >
      <legend className="sr-only">{t("legend")}</legend>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-[4px] bg-surface ring-1 ring-control transition-transform duration-150 ease-(--ease-out) dark:bg-raised"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map(({ value, Icon }) => (
        <label
          key={value}
          title={
            value === "system" ? t("systemNow", { theme: resolved }) : t(value)
          }
          className="relative grid size-8 place-items-center rounded-[4px] text-ink-3 transition-colors duration-150 hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-(--lx-focus) pointer-coarse:size-11"
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
            className="sr-only"
          />
          <Icon aria-hidden className="size-4" />
          <span className="sr-only">{t(value)}</span>
        </label>
      ))}
    </fieldset>
  );
}
