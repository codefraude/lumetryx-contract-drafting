import type { Segment } from "@/features/comparison/contracts";
import type { RenderedBlock, RunSpan } from "@/server/docx/blocks";
import { tokenize } from "./token-diff";

type Flags = string;

function charFlags(runs: RunSpan[]): Flags[] {
  const out: Flags[] = [];

  for (const r of runs) {
    for (let k = 0; k < r.text.length; k++) {
      out.push(
        `${r.bold ? "b" : ""}${r.italic ? "i" : ""}${r.underline ? "u" : ""}`,
      );
    }
  }

  return out;
}

const FLAG_NAMES: Record<string, string> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

export function formattingNotes(
  o: RenderedBlock,
  c: RenderedBlock,
  segs: Segment[],
): string[] {
  const fo = charFlags(o.runs);
  const fc = charFlags(c.runs);
  const notes = new Map<string, string[]>();
  let io = 0;
  let ic = 0;
  let last: string | null = null;

  for (const s of segs) {
    if (s.op !== "eq") {
      if (s.op === "del") {
        io += s.text.length;
      } else {
        ic += s.text.length;
      }

      last = null;
      continue;
    }

    for (const tok of tokenize(s.text)) {
      let key: string | null = null;

      if (tok.trim()) {
        for (const f of ["b", "i", "u"]) {
          const all = (flags: Flags[], at: number) => {
            return Array.from(
              { length: tok.length },
              (_, k) => flags[at + k]?.includes(f) ?? false,
            );
          };

          const was = all(fo, io).every(Boolean);
          const now = all(fc, ic).every(Boolean);

          if (was !== now) {
            key = `${FLAG_NAMES[f]} ${now ? "added to" : "removed from"}`;
          }
        }

        if (key) {
          const list = notes.get(key) ?? [];

          if (last === key && list.length) {
            list[list.length - 1] += ` ${tok}`;
          } else {
            list.push(tok);
          }

          notes.set(key, list);
        }

        last = key;
      }

      io += tok.length;
      ic += tok.length;
    }
  }

  return [...notes].map(
    ([k, v]) =>
      `${k.charAt(0).toUpperCase()}${k.slice(1)} ${v.map((x) => `“${x.slice(0, 60)}”`).join(", ")}`,
  );
}

export function structureNotes(o: RenderedBlock, c: RenderedBlock): string[] {
  const notes: string[] = [];

  if ((o.styleId ?? "") !== (c.styleId ?? "")) {
    notes.push(
      `Paragraph style ${o.styleId ?? "Normal"} → ${c.styleId ?? "Normal"}`,
    );
  } else if (o.headingLevel !== c.headingLevel) {
    notes.push(
      `Heading level ${o.headingLevel ?? "none"} → ${c.headingLevel ?? "none"}`,
    );
  }

  const lo = o.numbering?.ilvl;
  const lc = c.numbering?.ilvl;

  if (lo !== lc) {
    notes.push(
      lo === undefined
        ? "Became a list item"
        : lc === undefined
          ? "No longer a list item"
          : `List level ${lo + 1} → ${lc + 1}`,
    );
  }

  return notes;
}

export function location(b: RenderedBlock, body: RenderedBlock[]): string {
  if (b.partKind !== "body") {
    return b.partKind === "header" ? "Header" : "Footer";
  }

  if (b.table) {
    return `Table ${b.table.table + 1}, row ${b.table.row + 1}, column ${b.table.col + 1}`;
  }

  if (b.numberLabel && /\d/.test(b.numberLabel)) {
    return `Clause ${b.numberLabel.replace(/[.)]+$/, "")}`;
  }

  if (b.kind === "heading") {
    return `Heading “${b.text.trim().slice(0, 40)}”`;
  }

  return `Paragraph ${body.indexOf(b) + 1}`;
}
