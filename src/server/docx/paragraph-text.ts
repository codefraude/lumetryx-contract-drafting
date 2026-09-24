import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import type { PlaceholderSpan, RunSpan } from "./blocks";
import { firstChild, nearestAncestor, toggleOn, W14_NS, W_NS, wAttr } from "./xml";

/**
 * A paragraph's visible text, mapped back to the w:t nodes that hold it, so an edit at a text
 * offset lands in the right run. Also finds the Word content controls that still show placeholder text.
 */

export interface Segment {
  /** w:t node, or null for an immutable separator (tab/break). */
  node: XmlElement | null;
  start: number;
  end: number;
}

export interface ParagraphMap {
  el: XmlElement;
  text: string;
  segments: Segment[];
  /** Content controls inside the paragraph (run level), with the text range they cover. */
  controls: { el: XmlElement; start: number; end: number }[];
}

export function mapParagraph(p: XmlElement): ParagraphMap {
  const segments: Segment[] = [];
  const controls: ParagraphMap["controls"] = [];
  let text = "";
  const walk = (node: XmlNode) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as XmlElement;
      if (el.namespaceURI === W_NS) {
        // Nested paragraphs (text boxes) are indexed as their own blocks.
        if (el.localName === "p") continue;
        // Deleted tracked-change text is not part of visible content.
        if (el.localName === "del" || el.localName === "delText" || el.localName === "instrText") continue;
        if (el.localName === "t") {
          const value = el.textContent ?? "";
          segments.push({ node: el, start: text.length, end: text.length + value.length });
          text += value;
          continue;
        }
        if (el.localName === "tab" || el.localName === "br" || el.localName === "cr") {
          const sep = el.localName === "tab" ? "\t" : "\n";
          segments.push({ node: null, start: text.length, end: text.length + 1 });
          text += sep;
          continue;
        }
        if (el.localName === "sdt") {
          const start = text.length;
          walk(el);
          controls.push({ el, start, end: text.length });
          continue;
        }
      }
      walk(el);
    }
  };
  walk(p);
  return { el: p, text, segments, controls };
}

/** Controls that hold something other than text (galleries, pictures, check boxes, …) are never fields. */
const NON_TEXT_CONTROLS = new Set(["docPartObj", "docPartList", "picture", "group", "citation", "bibliography", "equation", "checkbox", "repeatingSection", "repeatingSectionItem"]);

const showsPlaceholder = (sdt: XmlElement): boolean => {
  const pr = firstChild(sdt, "sdtPr");
  if (!pr || !toggleOn(firstChild(pr, "showingPlcHdr"))) return false;
  for (let n = pr.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && NON_TEXT_CONTROLS.has((n as XmlElement).localName!)) return false;
  return true;
};

/**
 * Content controls of this paragraph that still show their placeholder text. A control around the
 * whole paragraph counts when it holds only this paragraph; when controls are nested, the innermost
 * one is the blank.
 */
export function placeholderSpans(map: ParagraphMap): PlaceholderSpan[] {
  const found = map.controls.filter((c) => showsPlaceholder(c.el));
  const outer = nearestAncestor(map.el, "sdt");
  if (!found.length && outer && showsPlaceholder(outer) && outer.getElementsByTagNameNS(W_NS, "p").length === 1) found.push({ el: outer, start: 0, end: map.text.length });
  const inside = (outerEl: XmlElement, el: XmlElement) => {
    for (let n = el.parentNode; n; n = n.parentNode) if (n === outerEl) return true;
    return false;
  };
  return found
    .filter((c) => !found.some((o) => o !== c && inside(c.el, o.el)))
    .map(({ el, start, end }) => {
      const pr = firstChild(el, "sdtPr")!;
      const bind = firstChild(pr, "dataBinding");
      const title = firstChild(pr, "alias") ?? firstChild(pr, "tag");
      return { start, end, binding: bind ? `${(wAttr(bind, "storeItemID") ?? "").toUpperCase()}${wAttr(bind, "xpath") ?? ""}` : null, title: title ? (wAttr(title, "val") ?? null) : null };
    });
}

export const paraIdOf = (p: XmlElement): string | null => p.getAttributeNS(W14_NS, "paraId") || p.getAttribute("w14:paraId") || null;

export function runSpans(map: ParagraphMap): RunSpan[] {
  const spans: RunSpan[] = [];
  for (const seg of map.segments) {
    const text = seg.node ? (seg.node.textContent ?? "") : map.text.slice(seg.start, seg.end);
    if (!text) continue;
    const r = seg.node ? nearestAncestor(seg.node, "r") : null;
    const rPr = r ? firstChild(r, "rPr") : null;
    const span: RunSpan = {
      text,
      bold: toggleOn(rPr ? firstChild(rPr, "b") : null),
      italic: toggleOn(rPr ? firstChild(rPr, "i") : null),
      underline: toggleOn(rPr ? firstChild(rPr, "u") : null),
    };
    const prev = spans.at(-1);
    if (prev && prev.bold === span.bold && prev.italic === span.italic && prev.underline === span.underline) prev.text += span.text;
    else spans.push(span);
  }
  return spans;
}
