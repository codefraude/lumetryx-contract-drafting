import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import { DOCX_LIMITS, DocxValidationError, type DocxPackage } from "./package";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

export type BlockKind = "heading" | "paragraph" | "listItem" | "tableCell";
export type PartKind = "body" | "header" | "footer";

export interface RunSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** A Word content control that still shows its placeholder text (e.g. “Votre nom”), located in the paragraph text. */
export interface PlaceholderSpan {
  start: number;
  end: number;
  /** Controls bound to the same data are kept identical by Word; they share this key. */
  binding: string | null;
  /** The control's title (alias) or tag, when it has one. */
  title: string | null;
}

export interface Block {
  /** Stable anchor: `${part}#${paragraphOrdinal}`. */
  id: string;
  part: string;
  partKind: PartKind;
  ordinal: number;
  kind: BlockKind;
  styleId: string | null;
  numbering: { numId: string; ilvl: number } | null;
  table: { table: number; row: number; col: number } | null;
  text: string;
  /** Word's w14:paraId. The editor keeps it through edits and exports, so it identifies a paragraph across revisions. */
  paraId: string | null;
  placeholders?: PlaceholderSpan[];
}

export interface RenderedBlock extends Block {
  runs: RunSpan[];
  numberLabel: string | null;
  headingLevel: number | null;
}

export interface TextEdit {
  blockId: string;
  start: number;
  end: number;
  /** The text that must currently occupy [start, end); guards against stale anchors. */
  expected: string;
  value: string;
}

export class AnchorConflictError extends Error {
  constructor(
    readonly edit: TextEdit,
    readonly actual: string,
  ) {
    super(`Anchor ${edit.blockId}[${edit.start},${edit.end}] expected "${edit.expected}" but found "${actual}"`);
    this.name = "AnchorConflictError";
  }
}

// ---------- XML helpers ----------

export const parseXml = (xml: string): XmlDocument => {
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== "warning") throw new DocxValidationError("corrupt", `Invalid XML: ${msg}`); } }).parseFromString(xml, "application/xml");
  return doc;
};

export const serializeXml = (doc: XmlDocument | XmlNode): string => new XMLSerializer().serializeToString(doc);

const wAttr = (el: XmlElement, name: string): string | null => el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) || null;

export function firstChild(el: XmlElement, localName: string): XmlElement | null {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as XmlElement).namespaceURI === W_NS && (n as XmlElement).localName === localName) return n as XmlElement;
  }
  return null;
}

export function nearestAncestor(node: XmlNode, localName: string): XmlElement | null {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && (n as XmlElement).namespaceURI === W_NS && (n as XmlElement).localName === localName) return n as XmlElement;
  }
  return null;
}

const toggleOn = (el: XmlElement | null): boolean => {
  if (!el) return false;
  const v = wAttr(el, "val");
  return v === null || !["0", "false", "none", "off"].includes(v);
};

export function contentParts(pkg: DocxPackage): { part: string; kind: PartKind }[] {
  const parts: { part: string; kind: PartKind }[] = [{ part: "word/document.xml", kind: "body" }];
  for (const name of pkg.partNames.sort()) {
    if (/^word\/header\d*\.xml$/.test(name)) parts.push({ part: name, kind: "header" });
    if (/^word\/footer\d*\.xml$/.test(name)) parts.push({ part: name, kind: "footer" });
  }
  return parts;
}

// ---------- paragraph text mapping ----------

interface Segment {
  /** w:t node, or null for an immutable separator (tab/break). */
  node: XmlElement | null;
  start: number;
  end: number;
}

interface ParagraphMap {
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

// ---------- content controls ----------

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
function placeholderSpans(map: ParagraphMap): PlaceholderSpan[] {
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

/**
 * Word's own behaviour when someone types into a placeholder: the control stops showing its
 * placeholder and the text loses the placeholder formatting. The data binding is dropped as well,
 * otherwise Word would put the (empty) bound value back when the document is opened.
 */
function commitControl(sdt: XmlElement, placeholderStyles: ReadonlySet<string>): void {
  const pr = firstChild(sdt, "sdtPr");
  if (!pr || !toggleOn(firstChild(pr, "showingPlcHdr"))) return;
  for (const name of ["showingPlcHdr", "dataBinding"]) {
    const el = firstChild(pr, name);
    if (el) pr.removeChild(el);
  }
  const content = firstChild(sdt, "sdtContent");
  const styles = content ? content.getElementsByTagNameNS(W_NS, "rStyle") : null;
  for (let i = styles ? styles.length - 1 : -1; i >= 0; i--) {
    const s = styles!.item(i) as XmlElement;
    if (placeholderStyles.has(wAttr(s, "val") ?? "")) s.parentNode!.removeChild(s);
  }
}

export function paragraphsOf(doc: XmlDocument | XmlElement): XmlElement[] {
  const list = doc.getElementsByTagNameNS(W_NS, "p");
  const out: XmlElement[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as XmlElement);
  return out;
}

// ---------- styles & numbering ----------

interface StyleInfo {
  headingLevel: number | null;
  numbering: { numId: string; ilvl: number } | null;
}

interface NumberingLevel {
  fmt: string;
  text: string;
  start: number;
}

interface DocContext {
  styles: Map<string, StyleInfo>;
  /** numId -> levels */
  numbering: Map<string, NumberingLevel[]>;
  /** Ids of Word's “Placeholder Text” style (the id is localised, the name is not). */
  placeholderStyles: Set<string>;
}

async function loadContext(pkg: DocxPackage): Promise<DocContext> {
  const styles = new Map<string, StyleInfo>();
  const placeholderStyles = new Set<string>();
  const stylesXml = await pkg.zip.file("word/styles.xml")?.async("string");
  if (stylesXml) {
    const doc = parseXml(stylesXml);
    const list = doc.getElementsByTagNameNS(W_NS, "style");
    for (let i = 0; i < list.length; i++) {
      const s = list.item(i) as XmlElement;
      const id = wAttr(s, "styleId");
      if (!id) continue;
      const name = firstChild(s, "name");
      const nameVal = name ? (wAttr(name, "val") ?? "") : "";
      if (/^placeholder text$/i.test(nameVal)) placeholderStyles.add(id);
      const heading = /^heading (\d)$/i.exec(nameVal) ?? /^Heading(\d)$/.exec(id);
      const pPr = firstChild(s, "pPr");
      const outline = pPr ? firstChild(pPr, "outlineLvl") : null;
      const numPr = pPr ? firstChild(pPr, "numPr") : null;
      styles.set(id, {
        headingLevel: heading ? Number(heading[1]) : outline ? Number(wAttr(outline, "val")) + 1 : null,
        numbering: numPr ? readNumPr(numPr) : null,
      });
    }
  }
  const numbering = new Map<string, NumberingLevel[]>();
  const numXml = await pkg.zip.file("word/numbering.xml")?.async("string");
  if (numXml) {
    const doc = parseXml(numXml);
    const abstract = new Map<string, NumberingLevel[]>();
    const abs = doc.getElementsByTagNameNS(W_NS, "abstractNum");
    for (let i = 0; i < abs.length; i++) {
      const a = abs.item(i) as XmlElement;
      const levels: NumberingLevel[] = [];
      const lvls = a.getElementsByTagNameNS(W_NS, "lvl");
      for (let j = 0; j < lvls.length; j++) {
        const l = lvls.item(j) as XmlElement;
        const ilvl = Number(wAttr(l, "ilvl") ?? j);
        const fmt = firstChild(l, "numFmt");
        const text = firstChild(l, "lvlText");
        const start = firstChild(l, "start");
        levels[ilvl] = { fmt: fmt ? (wAttr(fmt, "val") ?? "decimal") : "decimal", text: text ? (wAttr(text, "val") ?? "") : "", start: start ? Number(wAttr(start, "val") ?? 1) : 1 };
      }
      abstract.set(wAttr(a, "abstractNumId") ?? String(i), levels);
    }
    const nums = doc.getElementsByTagNameNS(W_NS, "num");
    for (let i = 0; i < nums.length; i++) {
      const n = nums.item(i) as XmlElement;
      const ref = firstChild(n, "abstractNumId");
      const levels = ref ? abstract.get(wAttr(ref, "val") ?? "") : undefined;
      if (levels) numbering.set(wAttr(n, "numId") ?? "", levels);
    }
  }
  return { styles, numbering, placeholderStyles };
}

function readNumPr(numPr: XmlElement): { numId: string; ilvl: number } | null {
  const numId = firstChild(numPr, "numId");
  const ilvl = firstChild(numPr, "ilvl");
  const id = numId ? wAttr(numId, "val") : null;
  if (!id || id === "0") return null;
  return { numId: id, ilvl: ilvl ? Number(wAttr(ilvl, "val") ?? 0) : 0 };
}

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

function formatCounter(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return String.fromCharCode(96 + (((n - 1) % 26) + 1));
    case "upperLetter":
      return String.fromCharCode(64 + (((n - 1) % 26) + 1));
    case "lowerRoman":
    case "upperRoman": {
      let r = "";
      let v = n;
      for (const [k, s] of ROMAN) while (v >= k) { r += s; v -= k; }
      return fmt === "upperRoman" ? r.toUpperCase() : r;
    }
    default:
      return String(n);
  }
}

/** Computes display labels (e.g. "1.1.2.") the way Word would for sequential paragraphs. Used for the streaming preview only. */
class NumberingCounter {
  private counters = new Map<string, number[]>();
  constructor(private ctx: DocContext) {}
  next(num: { numId: string; ilvl: number }): string | null {
    const levels = this.ctx.numbering.get(num.numId);
    const level = levels?.[num.ilvl];
    if (!levels || !level) return null;
    const c = this.counters.get(num.numId) ?? [];
    for (let i = 0; i < num.ilvl; i++) if (c[i] === undefined) c[i] = levels[i]?.start ?? 1;
    c[num.ilvl] = c[num.ilvl] === undefined ? level.start : c[num.ilvl]! + 1;
    c.length = num.ilvl + 1;
    this.counters.set(num.numId, c);
    if (level.fmt === "bullet") return "\u2022";
    if (level.fmt === "none") return null;
    return level.text.replace(/%(\d)/g, (_, d: string) => formatCounter(c[Number(d) - 1] ?? 1, levels[Number(d) - 1]?.fmt ?? "decimal"));
  }
}

// ---------- indexing ----------

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

export function assertIndexable(blocks: Block[]): void {
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (blocks.length > DOCX_LIMITS.maxBlocks || chars > DOCX_LIMITS.maxIndexedChars) {
    throw new DocxValidationError("too_complex", `This template is larger than the supported size (${DOCX_LIMITS.maxBlocks} paragraphs / ${DOCX_LIMITS.maxIndexedChars.toLocaleString("en")} characters).`);
  }
}

/**
 * Gives every paragraph without a w14:paraId a deterministic one derived from its part and
 * ordinal, so the same template always yields the same ids and the server can find a paragraph
 * again after the browser editor re-exports the document. Existing ids are kept. Returns
 * blockId → paraId for every paragraph.
 */
export async function ensureParaIds(pkg: DocxPackage): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const parts = contentParts(pkg);
  const docs: { part: string; doc: XmlDocument; paras: XmlElement[] }[] = [];
  const used = new Set<string>();
  for (const { part } of parts) {
    const xml = await pkg.zip.file(part)?.async("string");
    if (!xml) continue;
    const doc = parseXml(xml);
    const paras = paragraphsOf(doc);
    for (const p of paras) {
      const id = paraIdOf(p);
      if (id) used.add(id.toUpperCase());
    }
    docs.push({ part, doc, paras });
  }
  docs.forEach(({ part, doc, paras }, partIndex) => {
    let changed = false;
    paras.forEach((p, ord) => {
      let id = paraIdOf(p);
      if (!id) {
        // Word requires values below 0x80000000; each part gets its own range.
        let n = 0x10000000 + partIndex * 0x00100000 + ord;
        while (used.has(n.toString(16).toUpperCase().padStart(8, "0"))) n++;
        id = n.toString(16).toUpperCase().padStart(8, "0");
        used.add(id);
        p.setAttributeNS(W14_NS, "w14:paraId", id);
        changed = true;
      }
      map.set(`${part}#${ord}`, id);
    });
    if (changed) {
      declareW14(doc);
      pkg.zip.file(part, serializeXml(doc));
    }
  });
  return map;
}

/** Declares the w14 namespace on the part's root and marks it ignorable for older consumers, as Word does. */
function declareW14(doc: XmlDocument): void {
  const root = doc.documentElement!;
  const XMLNS = "http://www.w3.org/2000/xmlns/";
  if (!root.getAttribute("xmlns:w14")) root.setAttributeNS(XMLNS, "xmlns:w14", W14_NS);
  if (!root.getAttribute("xmlns:mc")) root.setAttributeNS(XMLNS, "xmlns:mc", MC_NS);
  const ignorable = root.getAttributeNS(MC_NS, "Ignorable") || root.getAttribute("mc:Ignorable") || "";
  if (!ignorable.split(/\s+/).includes("w14")) root.setAttributeNS(MC_NS, "mc:Ignorable", `${ignorable} w14`.trim());
}

// ---------- editing ----------

function applyToParagraph(map: ParagraphMap, edit: TextEdit, placeholderStyles: ReadonlySet<string>): void {
  const actual = map.text.slice(edit.start, edit.end);
  if (actual !== edit.expected) throw new AnchorConflictError(edit, actual);
  const value = edit.value.replace(/[\r\n]+/g, " ");
  const touched = map.segments.filter((s) => (edit.start === edit.end ? s.end === edit.start || (s.start <= edit.start && s.end > edit.start) : s.start < edit.end && s.end > edit.start));
  if (touched.some((s) => s.node === null && edit.start !== edit.end)) {
    throw new AnchorConflictError(edit, actual);
  }
  const textSegs = touched.filter((s) => s.node !== null);
  // Insertion at a point prefers the preceding run so the value inherits its formatting.
  const first = edit.start === edit.end ? (textSegs.find((s) => s.end === edit.start) ?? textSegs[0]) : textSegs[0];
  if (!first?.node) throw new AnchorConflictError(edit, actual);
  textSegs.forEach((seg) => {
    const node = seg.node!;
    const current = node.textContent ?? "";
    const localStart = Math.max(0, edit.start - seg.start);
    const localEnd = Math.min(current.length, edit.end - seg.start);
    const next = seg === first ? current.slice(0, localStart) + value + current.slice(Math.max(localEnd, localStart)) : edit.start === edit.end ? current : current.slice(0, localStart) + current.slice(localEnd);
    while (node.firstChild) node.removeChild(node.firstChild);
    node.appendChild(node.ownerDocument!.createTextNode(next));
    node.setAttributeNS(XML_NS, "xml:space", "preserve");
  });
  // An identity edit only anchors a still-unanswered blank; a real value turns a placeholder into content.
  if (value === edit.expected) return;
  for (const seg of edit.start === edit.end ? [first] : textSegs) {
    for (let n = seg.node!.parentNode; n; n = n.parentNode) {
      if (n.nodeType === 1 && (n as XmlElement).namespaceURI === W_NS && (n as XmlElement).localName === "sdt") commitControl(n as XmlElement, placeholderStyles);
    }
  }
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
