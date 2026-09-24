"use client";

import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small panel in the top layer (never clipped by scroll containers). Light
 * dismiss and Escape are native; the panel is placed next to its button and closes on scroll or resize.
 */
export function Popover({
  label,
  icon: Icon,
  children,
  align = "end",
  buttonClassName = "",
  panelClassName = "",
}: {
  label: string;
  icon: LucideIcon;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => document.getElementById(id)?.hidePopover(), [id]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: Event) => {
      if (e.type === "scroll" && e.target instanceof Node && panel.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        className={`grid size-9 shrink-0 place-items-center rounded-control text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink pointer-coarse:size-11 ${buttonClassName}`}
      >
        <Icon aria-hidden className="size-[18px]" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        onToggle={(e) => {
          const el = panel.current;
          const b = button.current;
          if (!el || !b) return;
          if (e.newState !== "open") {
            delete el.dataset.placed;
            setOpen(false);
            return;
          }
          const r = b.getBoundingClientRect();
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const left = Math.max(8, Math.min(align === "end" ? r.right - w : r.left, window.innerWidth - w - 8));
          const below = r.bottom + 6;
          el.style.left = `${left}px`;
          el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
          el.dataset.placed = "";
          el.querySelector<HTMLElement>("button:not(:disabled), a[href], input")?.focus();
          setOpen(true);
        }}
        className={`lx-popover fixed inset-auto m-0 min-w-[min(14rem,calc(100vw-16px))] max-w-[calc(100vw-16px)] rounded-card border border-line bg-raised p-1 text-ink shadow-overlay ${panelClassName}`}
      >
        {children(close)}
      </div>
    </>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  tone,
  disabled,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick(): void;
  tone?: "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-ui font-medium transition-colors duration-150 hover:bg-hover focus-visible:-outline-offset-2 disabled:opacity-50 pointer-coarse:py-3 ${tone === "danger" ? "text-danger" : "text-ink"}`}
    >
      {Icon && <Icon aria-hidden className={`size-4 shrink-0 ${tone === "danger" ? "" : "text-ink-3"}`} />}
      {children}
    </button>
  );
}
