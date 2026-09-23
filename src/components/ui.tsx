"use client";

import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/* ---------- Buttons ---------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  // A disabled primary action turns neutral but stays legible (it is often the one people look for).
  primary: "bg-primary text-on-primary shadow-sm hover:bg-primary-hover disabled:bg-hover disabled:text-ink-3 disabled:opacity-100 disabled:shadow-none",
  secondary: "border border-control/50 bg-surface text-ink shadow-sm hover:border-control hover:bg-hover dark:bg-raised dark:hover:bg-hover",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  danger: "bg-danger text-on-danger shadow-sm hover:opacity-90",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px] pointer-coarse:h-10",
  md: "h-9 gap-2 px-3.5 text-sm pointer-coarse:h-11",
  lg: "h-11 gap-2 px-5 text-[15px]",
};
const ICON: Record<Size, string> = { sm: "size-3.5", md: "size-4", lg: "size-[18px]" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  icon?: LucideIcon;
  /** Shows a spinner and disables the button while its action runs. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon: Icon, busy = false, className = "", children, disabled, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {busy ? <LoaderCircle aria-hidden className={`${ICON[size]} animate-spin`} /> : Icon ? <Icon aria-hidden className={ICON[size]} strokeWidth={2} /> : null}
      {children}
    </button>
  );
});

const BOX: Record<Size, string> = { sm: "size-8 pointer-coarse:size-10", md: "size-9 pointer-coarse:size-11", lg: "size-11" };

/** An icon-only button; `label` is its accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "children"> & { label: string; icon: LucideIcon }>(function IconButton({ label, variant = "ghost", size = "md", className = "", ...rest }, ref) {
  return <Button ref={ref} variant={variant} size={size} aria-label={label} title={label} className={`${BOX[size]} px-0! ${className}`} {...rest} />;
});

/* ---------- Status ---------- */

export type Tone = "ok" | "warn" | "danger" | "neutral" | "accent";

export const TONE: Record<Tone, string> = {
  ok: "border-ok-line bg-ok-surface text-ok",
  warn: "border-warn-line bg-warn-surface text-warn",
  danger: "border-danger-line bg-danger-surface text-danger",
  neutral: "border-line bg-subtle text-ink-2",
  accent: "border-transparent bg-accent-surface text-accent-ink",
};

/** Status text with an icon; colour is never the only signal. */
export function StatusBadge({ tone, icon: Icon, children, className = "" }: { tone: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-semibold leading-4 ${TONE[tone]} ${className}`}>
      {Icon && <Icon aria-hidden className="size-3.5" strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Callout({ tone = "neutral", icon: Icon, title, children, actions, role, className = "" }: { tone?: Tone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; actions?: ReactNode; role?: "alert" | "status" | "note"; className?: string }) {
  return (
    <div role={role} className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${TONE[tone]} ${className}`}>
      {Icon && <Icon aria-hidden className="mt-[3px] size-4 shrink-0" strokeWidth={2.1} />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export const Skeleton = ({ className = "" }: { className?: string }) => <div aria-hidden className={`lx-skeleton rounded-md ${className}`} />;

/** Product mark: the section sign, the most legal of glyphs. */
export function BrandMark({ className = "size-7 text-[18px]" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-[8px] bg-primary pb-px font-serif font-semibold leading-none text-on-primary ${className}`}>
      §
    </span>
  );
}

/* ---------- Tabs ---------- */

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
export function TabBar<T extends string>({ items, value, onChange, label, idBase, className = "" }: { items: TabItem<T>[]; value: T; onChange(id: T): void; label: string; idBase: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, items.findIndex((t) => t.id === value));
  const move = (from: number, step: number) => {
    for (let k = 1; k <= items.length; k++) {
      const n = (((from + step * k) % items.length) + items.length) % items.length;
      if (!items[n]!.disabled) {
        onChange(items[n]!.id);
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
      <span aria-hidden className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-surface shadow-sm ring-1 ring-line transition-transform duration-200 ease-(--ease-out) dark:bg-raised" style={{ width: `calc((100% - 4px) / ${items.length})`, transform: `translateX(${index * 100}%)` }} />
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

/** Small count shown inside a tab. */
export function Count({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return <span className={`rounded-[5px] px-1.5 text-[11.5px] font-semibold tabular-nums leading-[18px] ${tone === "warn" ? "bg-warn-surface text-warn ring-1 ring-warn-line" : "bg-hover text-ink-2"}`}>{children}</span>;
}

/* ---------- Popover (disclosure menu) ---------- */

/**
 * A button that opens a small panel in the top layer (never clipped by scroll containers). Light
 * dismiss and Escape are native; the panel is placed next to its button and closes on scroll or resize.
 */
export function Popover({ label, icon: Icon, children, align = "end", buttonClassName = "", panelClassName = "" }: { label: string; icon: LucideIcon; children: (close: () => void) => ReactNode; align?: "start" | "end"; buttonClassName?: string; panelClassName?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => document.getElementById(id)?.hidePopover(), [id]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: Event) => {
      if (e.type === "scroll" && panel.current?.contains(e.target as Node)) return;
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
      <button ref={button} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id} aria-label={label} title={label} className={`grid size-9 shrink-0 place-items-center rounded-control text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink pointer-coarse:size-11 ${buttonClassName}`}>
        <Icon aria-hidden className="size-[18px]" strokeWidth={2} />
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
        className={`lx-popover fixed inset-auto m-0 min-w-56 max-w-[calc(100vw-16px)] rounded-xl border border-line bg-raised p-1.5 text-ink shadow-lg ${panelClassName}`}
      >
        {children(close)}
      </div>
    </>
  );
}

export function MenuItem({ icon: Icon, children, onClick, tone, disabled }: { icon?: LucideIcon; children: ReactNode; onClick(): void; tone?: "danger"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-45 pointer-coarse:py-3 ${tone === "danger" ? "text-danger" : "text-ink"}`}>
      {Icon && <Icon aria-hidden className={`size-4 shrink-0 ${tone === "danger" ? "" : "text-ink-2"}`} strokeWidth={2} />}
      {children}
    </button>
  );
}

/* ---------- Confirmation dialog ---------- */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirm: string;
  cancel?: string;
  tone?: "primary" | "danger";
}
type Request = ConfirmOptions & { resolve(ok: boolean): void; open: boolean };

/** A themed replacement for window.confirm. Render `dialog` once; `ask()` resolves true on confirm. */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...o, resolve, open: true })), []);
  const finish = useCallback((ok: boolean) => {
    setRequest((r) => {
      r?.resolve(ok);
      return r && { ...r, open: false };
    });
  }, []);
  return [<ConfirmDialog key="confirm" request={request} onFinish={finish} />, ask];
}

function ConfirmDialog({ request, onFinish }: { request: Request | null; onFinish(ok: boolean): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = Boolean(request?.open);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Destructive confirmations start on Cancel, others on the confirm action.
      d.querySelector<HTMLElement>("[data-default]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const danger = request?.tone === "danger";
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={() => onFinish(false)} className="lx-dialog m-auto w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-raised p-0 text-ink shadow-lg">
      {request && (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="text-[17px] font-semibold leading-snug text-ink">{request.title}</h2>
          {request.body && <div className="mt-2 text-sm leading-relaxed text-ink-2">{request.body}</div>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" data-default={danger ? "" : undefined} onClick={() => onFinish(false)}>{request.cancel ?? "Cancel"}</Button>
            <Button variant={danger ? "danger" : "primary"} data-default={danger ? undefined : ""} onClick={() => onFinish(true)}>{request.confirm}</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
