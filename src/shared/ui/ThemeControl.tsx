"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { applyTheme, currentTheme, readPreference, setPreference, subscribeTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

const noop = () => undefined;

/** Follows OS and other-tab changes, and re-applies the theme after React's dev remount clears <html>. */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    return subscribeTheme(noop);
  }, []);
  return null;
}

/** Light / Dark / System as a native radio group, so arrow keys and screen readers work as expected. */
export function ThemeControl({ className = "" }: { className?: string }) {
  const preference = useSyncExternalStore(subscribeTheme, readPreference, () => "system" as const);
  const resolved = useSyncExternalStore(subscribeTheme, currentTheme, () => "light" as const);
  const name = useId();
  const index = OPTIONS.findIndex((o) => o.value === preference);
  return (
    <fieldset className={`relative inline-grid shrink-0 grid-cols-3 rounded-control border border-line bg-subtle p-0.5 ${className}`}>
      <legend className="sr-only">Colour theme</legend>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-[4px] bg-surface ring-1 ring-control transition-transform duration-150 ease-(--ease-out) dark:bg-raised"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map(({ value, label, Icon }) => (
        <label
          key={value}
          title={value === "system" ? `System (now ${resolved})` : label}
          className="relative grid size-8 place-items-center rounded-[4px] text-ink-3 transition-colors duration-150 hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-(--lx-focus) pointer-coarse:size-11"
        >
          <input type="radio" name={name} value={value} checked={preference === value} onChange={() => setPreference(value)} className="sr-only" />
          <Icon aria-hidden className="size-4" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
