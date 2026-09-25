import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-hover disabled:bg-hover disabled:text-ink-3 disabled:opacity-100",
  secondary:
    "border border-control/45 bg-surface text-ink hover:border-control/70 hover:bg-hover dark:bg-raised dark:hover:bg-hover",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  danger: "bg-danger text-on-danger hover:opacity-90",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-ui pointer-coarse:h-11 pointer-coarse:min-w-11",
  md: "h-9 gap-2 px-3.5 text-ui pointer-coarse:h-11 pointer-coarse:min-w-11",
  lg: "h-11 gap-2 px-5 text-body",
};
const ICON: Record<Size, string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-[18px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  icon?: LucideIcon;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      icon: Icon,
      busy = false,
      className = "",
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={`inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
        {...rest}
      >
        {busy ? (
          <LoaderCircle aria-hidden className={`${ICON[size]} animate-spin`} />
        ) : Icon ? (
          <Icon aria-hidden className={ICON[size]} />
        ) : null}
        {children}
      </button>
    );
  },
);

const BOX: Record<Size, string> = {
  sm: "size-8 pointer-coarse:size-11",
  md: "size-9 pointer-coarse:size-11",
  lg: "size-11",
};

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "children"> & {
    label: string;
    icon: LucideIcon;
  }
>(function IconButton(
  { label, variant = "ghost", size = "md", className = "", ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={`${BOX[size]} px-0! ${className}`}
      {...rest}
    />
  );
});
