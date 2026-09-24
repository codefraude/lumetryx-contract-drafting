/** Product mark: the section sign, the most legal of glyphs, in the one accent colour. */
export function BrandMark({ className = "size-7 text-[18px]" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[6px] bg-accent-ink pb-px font-serif font-semibold leading-none text-surface ${className}`}
    >
      §
    </span>
  );
}
