"use client";

import type { DraftBlock } from "../contracts/stream-events";

const Runs = ({ block }: { block: DraftBlock }) => {
  return (
    <>
      {block.runs.map((r, i) => (
        <span
          key={i}
          className={[
            r.bold && "font-bold",
            r.italic && "italic",
            r.underline && "underline",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {r.text}
        </span>
      ))}
    </>
  );
};

function Paragraph({ block }: { block: DraftBlock }) {
  if (block.kind === "heading") {
    const size =
      block.headingLevel === 1
        ? "text-2xl text-center text-[#1F3A5F]"
        : "text-lg";

    return (
      <p className={`${size} mt-5 mb-2 font-bold`}>
        <Runs block={block} />
      </p>
    );
  }

  if (block.numberLabel) {
    return (
      <p
        className="mb-1.5 flex"
        style={{ paddingLeft: `${block.indentLevel * 1.6}rem` }}
      >
        <span className="w-14 shrink-0 tabular-nums">{block.numberLabel}</span>
        <span>
          <Runs block={block} />
        </span>
      </p>
    );
  }

  return (
    <p className="mb-2 min-h-[1em]">
      <Runs block={block} />
    </p>
  );
}

/** The desk around the page; it scrolls on its own, never the whole app. */
export function Canvas({
  children,
  busy,
}: {
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div
      aria-busy={busy}
      className="h-full overflow-auto overscroll-contain bg-canvas px-3 py-6 sm:px-8 sm:py-8"
    >
      {children}
    </div>
  );
}

/**
 * Placeholder page while the editor loads: paper-coloured
 * in both themes, like the document itself.
 */
export function PaperSkeleton({
  label = "Opening the document…",
}: {
  label?: string;
}) {
  return (
    <Canvas busy>
      <div
        className="mx-auto w-full max-w-[816px] rounded-[2px] bg-paper px-8 py-14 shadow-paper sm:px-20"
        role="status"
      >
        <span className="sr-only">{label}</span>
        <div aria-hidden className="space-y-3">
          <div className="lx-skeleton-paper mx-auto mb-8 h-5 w-1/2 rounded" />
          {[
            "w-full",
            "w-11/12",
            "w-full",
            "w-4/5",
            "w-0",
            "w-full",
            "w-10/12",
            "w-full",
            "w-3/5",
          ].map((w, i) => (
            <div key={i} className={`lx-skeleton-paper h-3 rounded ${w}`} />
          ))}
        </div>
      </div>
    </Canvas>
  );
}

/**
 * Built from the same filled document the editor opens afterwards,
 * not a paraphrase. Exact layout only comes with the editor.
 */
export function DraftPreview({
  blocks,
  generating,
}: {
  blocks: DraftBlock[];
  generating: boolean;
}) {
  const body = blocks.filter((b) => b.partKind === "body");
  const header = blocks.filter((b) => b.partKind === "header" && b.runs.length);
  // Consecutive cells of one table are drawn
  // together; every other block on its own.
  const groups: DraftBlock[][] = [];

  for (const b of body) {
    const last = groups.at(-1);

    if (b.table && last?.[0]?.table?.table === b.table.table) {
      last.push(b);
    } else {
      groups.push([b]);
    }
  }

  const out: React.ReactNode[] = [];

  for (const [b, ...more] of groups) {
    if (!b) {
      continue;
    }

    if (!b.table) {
      out.push(<Paragraph key={b.id} block={b} />);
      continue;
    }

    const rows = new Map<number, DraftBlock[]>();

    for (const c of [b, ...more]) {
      const row = c.table?.row ?? 0;

      rows.set(row, [...(rows.get(row) ?? []), c]);
    }

    out.push(
      <table
        key={`t${b.id}`}
        className="my-3 w-full border-collapse text-[0.95em]"
      >
        <tbody>
          {[...rows.values()].map((row, r) => (
            <tr key={r}>
              {row.map((c) => (
                <td
                  key={c.id}
                  className="border border-[#333] px-2 py-1 align-top"
                >
                  <Runs block={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    );
  }

  return (
    <Canvas busy={generating}>
      <article className="mx-auto w-full max-w-[816px] rounded-[2px] bg-paper px-6 py-10 font-serif text-[15px] leading-relaxed text-paper-ink shadow-paper sm:px-16">
        {header.map((h) => (
          <p key={h.id} className="mb-6 text-right text-xs text-[#555]">
            <Runs block={h} />
          </p>
        ))}
        {out}
        {generating && (
          <p
            className="mt-4 flex items-center gap-2 font-sans text-meta text-[#4f4e4a]"
            role="status"
          >
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-[#1d6b62]"
            />
            Filling the template… {body.length} paragraphs so far
          </p>
        )}
      </article>
    </Canvas>
  );
}
