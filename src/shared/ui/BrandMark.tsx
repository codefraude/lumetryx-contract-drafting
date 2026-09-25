/** The product mark is the section sign, in the accent colour. */
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
