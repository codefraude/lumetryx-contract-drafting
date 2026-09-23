/**
 * Light formatting for assistant replies: paragraphs, bullet and numbered lists, **bold**.
 * Text is never interpreted as HTML; this only groups lines.
 */
export type MessageBlock = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

export function messageBlocks(text: string): MessageBlock[] {
  const out: MessageBlock[] = [];
  // Asserted rather than annotated: the helpers below reassign these, which narrowing cannot see.
  let para = null as string[] | null;
  let list = null as { kind: "ul" | "ol"; items: string[] } | null;
  const endPara = () => {
    if (para) out.push({ kind: "p", lines: para });
    para = null;
  };
  const endList = () => {
    if (list) out.push(list);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const kind = bullet ? "ul" : "ol";
      endPara();
      if (list?.kind !== kind) endList();
      (list ??= { kind, items: [] }).items.push(item[1]!);
    } else {
      endList();
      (para ??= []).push(line);
    }
  }
  endPara();
  endList();
  return out;
}

export const boldSpans = (s: string) =>
  s
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map((t) => (t.length > 4 && t.startsWith("**") && t.endsWith("**") ? { bold: true, text: t.slice(2, -2) } : { bold: false, text: t }));
