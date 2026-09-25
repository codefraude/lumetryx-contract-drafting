import type { ReactNode } from "react";

/**
 * Stays mounted and hides with visibility, so scroll, unsent text and
 * the editor survive a switch. Active panels inherit visibility, never
 * force it, so a region hidden on narrow screens hides them too.
 */
export function TabPanel({
  base,
  id,
  active,
  scroll,
  className = "",
  children,
}: {
  base: string;
  id: string;
  active: boolean;
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`${base}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${base}-tab-${id}`}
      className={`absolute inset-0 transition-[opacity,visibility] duration-150 ${active ? "opacity-100" : "pointer-events-none invisible opacity-0"} ${scroll ? "overflow-y-auto overscroll-contain" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
