import type { ReactNode } from "react";

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
