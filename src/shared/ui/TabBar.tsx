"use client";

import { useRef, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Accessible name when the visible label carries extra marks such as counts. */
  name?: string;
  badge?: ReactNode;
  disabled?: boolean;
}

/**
 * Segmented tabs with a sliding indicator (automatic activation, arrow keys, Home/End).
 * Panels are rendered by the caller with ids `${idBase}-panel-${id}`.
 */
export function TabBar<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className = "",
}: {
  items: TabItem<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    items.findIndex((t) => t.id === value),
  );
  const move = (from: number, step: number) => {
    for (let k = 1; k <= items.length; k++) {
      const n = (((from + step * k) % items.length) + items.length) % items.length;
      const item = items[n];
      if (item && !item.disabled) {
        onChange(item.id);
        refs.current[n]?.focus();
        return;
      }
    }
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`relative grid rounded-control border border-line bg-subtle p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          move(index, e.key === "ArrowRight" ? 1 : -1);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          move(e.key === "Home" ? -1 : items.length, e.key === "Home" ? 1 : -1);
        }
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-surface shadow-sm ring-1 ring-line transition-transform duration-200 ease-(--ease-out) dark:bg-raised"
        style={{ width: `calc((100% - 4px) / ${items.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {items.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel-${t.id}`}
            aria-label={t.name}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[13.5px] font-medium transition-colors duration-150 disabled:opacity-45 pointer-coarse:h-10 ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            <span className="truncate">{t.label}</span>
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
