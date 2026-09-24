import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import type { PartKind } from "./blocks";
import { DocxValidationError, type DocxPackage } from "./package";

/** WordprocessingML namespaces and the small DOM helpers every other docx module uses. */

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
export const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export const parseXml = (xml: string): XmlDocument => {
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== "warning") throw new DocxValidationError("corrupt", `Invalid XML: ${msg}`); } }).parseFromString(xml, "application/xml");
  return doc;
};

export const serializeXml = (doc: XmlDocument | XmlNode): string => new XMLSerializer().serializeToString(doc);

export const wAttr = (el: XmlElement, name: string): string | null => el.getAttributeNS(W_NS, name) || el.getAttribute(`w:${name}`) || null;

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

export const toggleOn = (el: XmlElement | null): boolean => {
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

export function paragraphsOf(doc: XmlDocument | XmlElement): XmlElement[] {
  const list = doc.getElementsByTagNameNS(W_NS, "p");
  const out: XmlElement[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as XmlElement);
  return out;
}
