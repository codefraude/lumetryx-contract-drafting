import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "danger" | "neutral" | "accent";

/** Only the box is tinted; text inside keeps the regular ink colours. */
export const TONE_BOX: Record<Tone, string> = {
  ok: "border-ok-line bg-ok-surface",
  warn: "border-warn-line bg-warn-surface",
  danger: "border-danger-line bg-danger-surface",
  neutral: "border-line bg-subtle",
  accent: "border-transparent bg-accent-surface",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink-3",
  accent: "text-accent-ink",
};

/** A status in words, with an icon, so colour is never the only signal. */
export function StatusText({
  tone,
  icon: Icon,
  children,
  className = "",
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-meta font-medium ${TONE_TEXT[tone]} ${className}`}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

export function Callout({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  actions,
  role,
  className = "",
}: {
  tone?: Tone;
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status" | "note";
  className?: string;
}) {
  return (
    <div
      role={role}
      className={`flex gap-2.5 rounded-card border px-3.5 py-3 ${TONE_BOX[tone]} ${className}`}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 ${TONE_TEXT[tone]}`}
        />
      )}
      <div className="min-w-0 flex-1">
        {title && (
          <p
            className={`font-semibold ${tone === "neutral" ? "text-ink" : TONE_TEXT[tone]}`}
          >
            {title}
          </p>
        )}
        {children && (
          <div className={`text-ink-2 ${title ? "mt-0.5" : ""}`}>
            {children}
          </div>
        )}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export const Skeleton = ({ className = "" }: { className?: string }) => {
  return <div aria-hidden className={`lx-skeleton rounded ${className}`} />;
};

export function Count({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <span
      className={`text-meta tabular-nums ${tone === "warn" ? "font-semibold text-warn" : "font-normal text-ink-3"}`}
    >
      {children}
    </span>
  );
}
