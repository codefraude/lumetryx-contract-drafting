import type { Document as XmlDocument, Element as XmlElement } from "@xmldom/xmldom";
import type { DocxPackage } from "./package";
import { paraIdOf } from "./paragraph-text";
import { contentParts, MC_NS, paragraphsOf, parseXml, serializeXml, W14_NS } from "./xml";

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
