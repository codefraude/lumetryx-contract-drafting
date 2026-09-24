/** Product mark: the section sign, the most legal of glyphs. */
export function BrandMark({ className = "size-7 text-[18px]" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[8px] bg-primary pb-px font-serif font-semibold leading-none text-on-primary ${className}`}
    >
      §
    </span>
  );
}
