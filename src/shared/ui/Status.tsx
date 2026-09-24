
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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

/** Small count shown inside a tab. */
export function Count({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return <span className={`rounded-[5px] px-1.5 text-[11.5px] font-semibold tabular-nums leading-[18px] ${tone === "warn" ? "bg-warn-surface text-warn ring-1 ring-warn-line" : "bg-hover text-ink-2"}`}>{children}</span>;
}
