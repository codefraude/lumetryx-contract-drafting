"use client";

import type { ReactNode } from "react";

export interface ViewItem<T extends string> {
  id: T;
  label: ReactNode;
  /**
   * Accessible name when the visible label carries extra marks such as counts.
   */
  name?: string;
  badge?: ReactNode;
}

/**
 * Narrow screens show one region at a time:
 * the assistant views, or the document.
 */
export function ViewSwitcher<T extends string>({
  views,
  active,
  onSelect,
}: {
  views: ViewItem<T>[];
  active: T;
  onSelect(id: T): void;
}) {
  return (
    <nav
      aria-label="Views"
      className="flex shrink-0 border-b border-line bg-surface px-2 lg:hidden"
    >
      {views.map((v) => {
        const on = active === v.id;

        return (
          <button
            key={v.id}
            type="button"
            aria-pressed={on}
            aria-label={v.name}
            onClick={() => onSelect(v.id)}
            className={`relative inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-ui font-medium transition-colors duration-150 focus-visible:-outline-offset-2 ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            <span className="truncate">{v.label}</span>
            {/* On phones the Details count stays in the accessible name
                only; the Clauses warning count always shows. */}
            {v.badge && (
              <span className={v.id === "details" ? "max-sm:hidden" : ""}>
                {v.badge}
              </span>
            )}
            <span
              aria-hidden
              className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${on ? "bg-ink" : "bg-transparent"}`}
            />
          </button>
        );
      })}
    </nav>
  );
}
