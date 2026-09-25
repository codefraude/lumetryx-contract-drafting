/**
 * Groups reply lines into paragraphs, lists and
 * **bold** spans; the text is never treated as HTML.
 */
export type MessageBlock =
  | {
      kind: "p";
      lines: string[];
    }
  | {
      kind: "ul" | "ol";
      items: string[];
    };

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

export function messageBlocks(text: string): MessageBlock[] {
  const out: MessageBlock[] = [];
  // The last block stays open for more lines of its kind until a blank line.
  let open = false;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      open = false;
      continue;
    }

    const last = open ? out.at(-1) : undefined;

    open = true;
    const bullet = BULLET.exec(line);
    const item = bullet ?? NUMBERED.exec(line);

    if (item) {
      const kind = bullet ? "ul" : "ol";
      const [, content = ""] = item;

      if (last && last.kind !== "p" && last.kind === kind) {
        last.items.push(content);
      } else {
        out.push({
          kind,
          items: [content],
        });
      }
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      out.push({
        kind: "p",
        lines: [line],
      });
    }
  }

  return out;
}

export const boldSpans = (s: string) => {
  return s
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map((t) =>
      t.length > 4 && t.startsWith("**") && t.endsWith("**")
        ? {
            bold: true,
            text: t.slice(2, -2),
          }
        : {
            bold: false,
            text: t,
          },
    );
};
