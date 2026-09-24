import type { Element as XmlElement } from "@xmldom/xmldom";
import type { DocxPackage } from "./package";
import { firstChild, parseXml, W_NS, wAttr } from "./xml";

/** Paragraph styles and list numbering: heading levels, list levels and Word-like number labels. */

interface StyleInfo {
  headingLevel: number | null;
  numbering: { numId: string; ilvl: number } | null;
}

interface NumberingLevel {
  fmt: string;
  text: string;
  start: number;
}

export interface DocContext {
  styles: Map<string, StyleInfo>;
  /** numId -> levels */
  numbering: Map<string, NumberingLevel[]>;
  /** Ids of Word's “Placeholder Text” style (the id is localised, the name is not). */
  placeholderStyles: Set<string>;
}

export async function loadContext(pkg: DocxPackage): Promise<DocContext> {
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

export function readNumPr(numPr: XmlElement): { numId: string; ilvl: number } | null {
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
export class NumberingCounter {
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
