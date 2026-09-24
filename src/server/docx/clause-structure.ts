import { createHash } from "node:crypto";
import { Element as XmlElement, type Document as XmlDocument, type Node as XmlNode } from "@xmldom/xmldom";
import { mapParagraph, paraIdOf, runSpans } from "./paragraph-text";
import type { DocxPackage } from "./package";
import { firstChild, paragraphsOf, parseXml, serializeXml, W_NS } from "./xml";

/**
 * Structural changes for conditional clauses. A clause is a contiguous run of top-level body
 * elements (paragraphs, tables, block content controls), found by the w14:paraIds of its
 * paragraphs. Only whole elements are moved, so numbering definitions, styles and the rest of
 * the document are untouched; list numbers are computed by Word from what remains.
 */

const BODY_PART = "word/document.xml";
const MOVABLE = new Set(["p", "tbl", "sdt", "bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "permStart", "permEnd", "proofErr"]);

export class ClauseStructureError extends Error {
  override name = "ClauseStructureError";
}

export interface BodyDoc {
  doc: XmlDocument;
  body: XmlElement;
  /** Writes the modified body back into the package. */
  commit(): void;
}

export async function openBody(pkg: DocxPackage): Promise<BodyDoc> {
  const xml = await pkg.zip.file(BODY_PART)?.async("string");
  if (xml === undefined) throw new ClauseStructureError("The document has no body.");
  const doc = parseXml(xml);
  const body = doc.getElementsByTagNameNS(W_NS, "body").item(0);
  if (!body) throw new ClauseStructureError("The document has no body.");
  return { doc, body, commit: () => pkg.zip.file(BODY_PART, serializeXml(doc)) };
}

const children = (body: XmlElement): XmlElement[] => {
  const out: XmlElement[] = [];
  for (let n = body.firstChild; n; n = n.nextSibling) if (n instanceof XmlElement) out.push(n);
  return out;
};

const paraIdsIn = (el: XmlElement): string[] => (el.localName === "p" ? [paraIdOf(el)] : paragraphsOf(el).map(paraIdOf)).filter((x): x is string => Boolean(x));

export interface LocatedClause {
  elements: XmlElement[];
  missing: string[];
}

/** Finds the top-level elements spanning the clause, from the first to the last of its paragraphs that still exist. */
export function locateClause(body: XmlElement, paraIds: string[]): LocatedClause | null {
  const wanted = new Set(paraIds);
  const kids = children(body);
  const found = new Set<string>();
  let first = -1;
  let last = -1;
  kids.forEach((el, i) => {
    const ids = paraIdsIn(el).filter((id) => wanted.has(id));
    if (!ids.length) return;
    ids.forEach((id) => found.add(id));
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;
  return { elements: kids.slice(first, last + 1), missing: paraIds.filter((id) => !found.has(id)) };
}

/** Rejects ranges we cannot move without risking the document's structure. */
export function unsupportedReason(elements: XmlElement[]): string | null {
  for (const el of elements) {
    if (el.namespaceURI !== W_NS || !MOVABLE.has(el.localName ?? "")) return `it contains an unsupported element (${el.tagName})`;
    if (el.localName === "sectPr" || el.getElementsByTagNameNS(W_NS, "sectPr").length) return "it contains a section break";
  }
  return null;
}

/** Hash of the clause's visible content (text, basic formatting, style and list level). Serialization details are ignored. */
export function clauseHash(elements: XmlElement[]): string {
  const h = createHash("sha256");
  for (const el of elements) {
    for (const p of el.localName === "p" ? [el] : paragraphsOf(el)) {
      const pPr = firstChild(p, "pPr");
      const style = pPr ? firstChild(pPr, "pStyle")?.getAttributeNS(W_NS, "val") : "";
      const numPr = pPr && firstChild(pPr, "numPr");
      const ilvl = pPr ? numPr && firstChild(numPr, "ilvl")?.getAttributeNS(W_NS, "val") : "";
      h.update(`${style ?? ""}|${ilvl ?? ""}|`);
      for (const r of runSpans(mapParagraph(p))) h.update(`${r.bold ? "b" : ""}${r.italic ? "i" : ""}${r.underline ? "u" : ""}:${r.text}\u0000`);
      h.update("\u0001");
    }
  }
  return h.digest("hex").slice(0, 32);
}

function neighbourId(kids: XmlElement[], from: number, step: 1 | -1): string | null {
  for (let i = from; i >= 0 && i < kids.length; i += step) {
    const kid = kids[i];
    const ids = kid ? paraIdsIn(kid) : [];
    const id = step === -1 ? ids.at(-1) : ids[0];
    if (id) return id;
  }
  return null;
}

export interface CutResult {
  xml: string;
  slot: { before: string | null; after: string | null };
  /** Bookmarks inside the removed clause that Word cross-reference fields elsewhere still point to. */
  brokenRefs: string[];
}

/** Removes the clause and returns its exact XML so it can be restored later with any manual edits intact. */
export function cutClause(bd: BodyDoc, elements: XmlElement[]): CutResult {
  const reason = unsupportedReason(elements);
  if (reason) throw new ClauseStructureError(`This clause can't be removed automatically because ${reason}.`);
  const kids = children(bd.body);
  const firstIdx = kids.findIndex((k) => k === elements[0]);
  const lastIdx = kids.findIndex((k) => k === elements.at(-1));
  const slot = { before: neighbourId(kids, firstIdx - 1, -1), after: neighbourId(kids, lastIdx + 1, 1) };
  const xml = elements.map((el) => serializeXml(el)).join("");
  const names = new Set<string>();
  for (const el of elements) {
    const marks = el.localName === "bookmarkStart" ? [el] : Array.from(el.getElementsByTagNameNS(W_NS, "bookmarkStart"));
    for (const b of marks) {
      const name = b.getAttributeNS(W_NS, "name");
      if (name) names.add(name);
    }
  }
  for (const el of elements) bd.body.removeChild(el);
  const brokenRefs = [...names].filter((n) => refersToBookmark(bd.doc, n));
  return { xml, slot, brokenRefs };
}

function refersToBookmark(doc: XmlDocument, name: string): boolean {
  const pattern = new RegExp(`\\b(REF|PAGEREF|NOTEREF)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  if (Array.from(doc.getElementsByTagNameNS(W_NS, "instrText")).some((el) => pattern.test(el.textContent ?? ""))) return true;
  return Array.from(doc.getElementsByTagNameNS(W_NS, "fldSimple")).some((el) => pattern.test(el.getAttributeNS(W_NS, "instr") ?? ""));
}

/** Relationship ids (images, links) a fragment depends on. */
export const relationshipIds = (xml: string): string[] => [...new Set([...xml.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)].map(([, id = ""]) => id))];

export async function documentRelationshipIds(pkg: DocxPackage): Promise<Set<string>> {
  const rels = (await pkg.zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  return new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map(([, id = ""]) => id));
}

/**
 * Puts a clause back after the paragraph it originally followed (or before the one it preceded).
 * Throws if neither neighbour still exists: guessing a position could put a clause in the wrong place.
 */
export function insertClause(bd: BodyDoc, xml: string, slot: { before: string | null; after: string | null }): void {
  const kids = children(bd.body);
  const holder = (id: string | null) => (id ? kids.find((el) => paraIdsIn(el).includes(id)) : undefined);
  const after = holder(slot.before);
  const before = after ? undefined : holder(slot.after);
  if (!after && !before)
    throw new ClauseStructureError("The paragraphs around this clause were removed in the editor, so it can't be put back in a safe place.");
  const wrapper = parseXml(`<w:body xmlns:w="${W_NS}">${xml}</w:body>`).documentElement;
  if (!wrapper) throw new ClauseStructureError("The removed clause could not be read back.");
  const nodes = children(wrapper).map((el) => bd.doc.importNode(el, true));
  let ref: XmlNode | null = after ? after.nextSibling : (before ?? null);
  for (const n of nodes) {
    if (ref) bd.body.insertBefore(n, ref);
    else {
      // Never after the body's final section properties.
      const sectPr = children(bd.body).find((el) => el.localName === "sectPr");
      if (sectPr) bd.body.insertBefore(n, sectPr);
      else bd.body.appendChild(n);
    }
    ref = n.nextSibling;
  }
}
