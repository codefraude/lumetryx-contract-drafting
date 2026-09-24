import type { Document as XmlDocument, Element as XmlElement } from "@xmldom/xmldom";
import { assertIndexable, type Block, type BlockKind, type PartKind, type RenderedBlock } from "./blocks";
import { AnchorConflictError, applyToParagraph, type TextEdit } from "./edit";
import type { DocxPackage } from "./package";
import { mapParagraph, paraIdOf, placeholderSpans, runSpans } from "./paragraph-text";
import { loadContext, NumberingCounter, readNumPr, type DocContext } from "./styles";
import { contentParts, firstChild, nearestAncestor, paragraphsOf, parseXml, serializeXml, W_NS, wAttr } from "./xml";

/** The single walk over body, headers and footers that applies edits and renders blocks. */

function describeParagraph(p: XmlElement, ctx: DocContext): Pick<Block, "kind" | "styleId" | "numbering" | "table"> & { headingLevel: number | null } {
  const pPr = firstChild(p, "pPr");
  const pStyle = pPr ? firstChild(pPr, "pStyle") : null;
  const styleId = pStyle ? wAttr(pStyle, "val") : null;
  const style = styleId ? ctx.styles.get(styleId) : undefined;
  const direct = pPr ? firstChild(pPr, "numPr") : null;
  const numbering = (direct ? readNumPr(direct) : null) ?? style?.numbering ?? null;
  const tc = nearestAncestor(p, "tc");
  let table: Block["table"] = null;
  if (tc) {
    const tr = nearestAncestor(tc, "tr");
    const tbl = tr ? nearestAncestor(tr, "tbl") : null;
    const indexIn = (el: XmlElement | null, name: string) => {
      if (!el?.parentNode) return 0;
      let i = 0;
      for (let n = el.parentNode.firstChild; n && n !== el; n = n.nextSibling) if (n.nodeType === 1 && (n as XmlElement).localName === name) i++;
      return i;
    };
    const allTables = tbl ? tbl.ownerDocument!.getElementsByTagNameNS(W_NS, "tbl") : null;
    let tIndex = 0;
    if (allTables && tbl) for (let i = 0; i < allTables.length; i++) if (allTables.item(i) === tbl) tIndex = i;
    table = { table: tIndex, row: indexIn(tr, "tr"), col: indexIn(tc, "tc") };
  }
  const headingLevel = style?.headingLevel ?? null;
  const kind: BlockKind = table ? "tableCell" : headingLevel ? "heading" : numbering ? "listItem" : "paragraph";
  return { kind, styleId, numbering, table, headingLevel };
}

function renderParagraph(p: XmlElement, part: string, partKind: PartKind, ordinal: number, ctx: DocContext, counter: NumberingCounter): RenderedBlock {
  const map = mapParagraph(p);
  const d = describeParagraph(p, ctx);
  return {
    id: `${part}#${ordinal}`,
    part,
    partKind,
    ordinal,
    kind: d.kind,
    styleId: d.styleId,
    numbering: d.numbering,
    table: d.table,
    text: map.text,
    paraId: paraIdOf(p),
    placeholders: placeholderSpans(map),
    runs: runSpans(map),
    numberLabel: d.numbering && partKind === "body" ? counter.next(d.numbering) : null,
    headingLevel: d.headingLevel,
  };
}

/** Indexes every paragraph in body, headers and footers. */
export async function indexBlocks(pkg: DocxPackage): Promise<RenderedBlock[]> {
  const blocks: RenderedBlock[] = [];
  for await (const ev of fillAndRender(pkg, [])) if (ev.type === "block") blocks.push(ev.block);
  assertIndexable(blocks);
  return blocks;
}

export interface AppliedEdit {
  edit: TextEdit;
  /** Anchor of the inserted value after all edits in its paragraph are applied. */
  result: { blockId: string; start: number; end: number; text: string };
}

export type FillEvent = { type: "block"; block: RenderedBlock } | { type: "done"; applied: AppliedEdit[] };

/**
 * Walks every paragraph of body, headers and footers in document order, applies that paragraph's
 * edits through the XML DOM (escaping is handled by the serializer), and yields the rendered result.
 * Within a paragraph edits run from the end backwards so earlier offsets stay valid. All edits are
 * validated against their expected text first; a single conflict aborts before anything is yielded.
 */
export async function* fillAndRender(pkg: DocxPackage, edits: TextEdit[], omit: ReadonlySet<string> = new Set()): AsyncGenerator<FillEvent> {
  const ctx = await loadContext(pkg);
  const counter = new NumberingCounter(ctx);
  const byBlock = new Map<string, TextEdit[]>();
  for (const e of edits) byBlock.set(e.blockId, [...(byBlock.get(e.blockId) ?? []), e]);
  const parts = contentParts(pkg);
  const docs = new Map<string, XmlDocument>();
  for (const { part } of parts) {
    const xml = await pkg.zip.file(part)?.async("string");
    if (xml) docs.set(part, parseXml(xml));
  }
  // Validate every anchor before mutating anything.
  for (const [blockId, pe] of byBlock) {
    const part = blockId.slice(0, blockId.lastIndexOf("#"));
    const p = docs.get(part) ? paragraphsOf(docs.get(part)!)[Number(blockId.slice(blockId.lastIndexOf("#") + 1))] : undefined;
    if (!p) throw new AnchorConflictError(pe[0]!, "");
    const text = mapParagraph(p).text;
    const sorted = [...pe].sort((a, b) => b.start - a.start || b.end - a.end);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]!;
      if (text.slice(e.start, e.end) !== e.expected) throw new AnchorConflictError(e, text.slice(e.start, e.end));
      if (i > 0 && e.end > sorted[i - 1]!.start) throw new Error(`Overlapping edits in ${blockId}`);
    }
  }
  const applied: AppliedEdit[] = [];
  for (const { part, kind } of parts) {
    const doc = docs.get(part);
    if (!doc) continue;
    const paragraphs = paragraphsOf(doc);
    for (let ord = 0; ord < paragraphs.length; ord++) {
      const p = paragraphs[ord]!;
      const pe = byBlock.get(`${part}#${ord}`);
      if (pe) {
        for (const e of [...pe].sort((a, b) => b.start - a.start || b.end - a.end)) applyToParagraph(mapParagraph(p), e, ctx.placeholderStyles);
        let shift = 0;
        for (const e of [...pe].sort((a, b) => a.start - b.start)) {
          const v = e.value.replace(/[\r\n]+/g, " ");
          applied.push({ edit: e, result: { blockId: e.blockId, start: e.start + shift, end: e.start + shift + v.length, text: v } });
          shift += v.length - (e.end - e.start);
        }
      }
      // Omitted blocks (excluded clauses, condition markers) are about to be removed: they are
      // not shown and do not advance list numbering, exactly as in the resulting document.
      if (!omit.has(`${part}#${ord}`)) yield { type: "block", block: renderParagraph(p, part, kind, ord, ctx, counter) };
    }
    if (edits.length) pkg.zip.file(part, serializeXml(doc));
  }
  yield { type: "done", applied };
}

/** Non-streaming convenience wrapper. */
export async function applyTextEdits(pkg: DocxPackage, edits: TextEdit[]): Promise<AppliedEdit[]> {
  let applied: AppliedEdit[] = [];
  for await (const ev of fillAndRender(pkg, edits)) if (ev.type === "done") applied = ev.applied;
  return applied;
}
