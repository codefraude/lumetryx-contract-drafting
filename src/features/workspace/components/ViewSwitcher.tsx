"use client";

import type { ReactNode } from "react";

export interface ViewItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Accessible name when the visible label carries extra marks such as counts. */
  name?: string;
  badge?: ReactNode;
}

/** Narrow screens show one region at a time: the assistant views, or the document. */
export function ViewSwitcher<T extends string>({ views, active, onSelect }: { views: ViewItem<T>[]; active: T; onSelect(id: T): void }) {
  const index = Math.max(0, views.findIndex((v) => v.id === active));
  return (
    <nav aria-label="Views" className="shrink-0 border-b border-line bg-surface px-3 py-2 lg:hidden">
      <div className="relative grid rounded-control border border-line bg-subtle p-0.5" style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}>
        <span aria-hidden className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-surface shadow-sm ring-1 ring-line transition-transform duration-200 ease-(--ease-out) dark:bg-raised" style={{ width: `calc((100% - 4px) / ${views.length})`, transform: `translateX(${index * 100}%)` }} />
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={active === v.id}
            aria-label={v.name}
            onClick={() => onSelect(v.id)}
            className={`relative inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-[8px] px-1 text-[13.5px] font-medium transition-colors duration-150 ${active === v.id ? "text-ink" : "text-ink-2"}`}
          >
            <span className="truncate">{v.label}</span>
            {/* On phones the Details count stays in the accessible name only; the Clauses warning count always shows. */}
            {v.badge && <span className={v.id === "details" ? "max-sm:hidden" : ""}>{v.badge}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
