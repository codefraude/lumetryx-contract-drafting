export function BrandMark({
  className = "size-7 text-[18px]",
}: {
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[6px] bg-accent-ink pb-px font-serif leading-none font-semibold text-surface ${className}`}
    >
      §
    </span>
  );
}
