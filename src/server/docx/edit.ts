import { Element as XmlElement } from "@xmldom/xmldom";
import type { ParagraphMap } from "./paragraph-text";
import {
  firstChild,
  nearestAncestor,
  toggleOn,
  W_NS,
  wAttr,
  XML_NS,
} from "./xml";

export interface TextEdit {
  blockId: string;
  start: number;
  end: number;
  expected: string;
  value: string;
}

export class AnchorConflictError extends Error {
  constructor(
    readonly edit: TextEdit,
    readonly actual: string,
  ) {
    super(
      `Anchor ${edit.blockId}[${edit.start},${edit.end}] expected "${edit.expected}" but found "${actual}"`,
    );

    this.name = "AnchorConflictError";
  }
}

function commitControl(
  sdt: XmlElement,
  placeholderStyles: ReadonlySet<string>,
): void {
  const pr = firstChild(sdt, "sdtPr");

  if (!pr || !toggleOn(firstChild(pr, "showingPlcHdr"))) {
    return;
  }

  for (const name of ["showingPlcHdr", "dataBinding"]) {
    const el = firstChild(pr, name);

    if (el) {
      pr.removeChild(el);
    }
  }

  const content = firstChild(sdt, "sdtContent");

  if (!content) {
    return;
  }

  for (const s of Array.from(content.getElementsByTagNameNS(W_NS, "rStyle"))) {
    if (placeholderStyles.has(wAttr(s, "val") ?? "")) {
      s.parentNode?.removeChild(s);
    }
  }
}

export function applyToParagraph(
  map: ParagraphMap,
  edit: TextEdit,
  placeholderStyles: ReadonlySet<string>,
): void {
  const actual = map.text.slice(edit.start, edit.end);

  if (actual !== edit.expected) {
    throw new AnchorConflictError(edit, actual);
  }

  const value = edit.value.replace(/[\r\n]+/g, " ");
  const touched = map.segments.filter((s) =>
    edit.start === edit.end
      ? s.end === edit.start || (s.start <= edit.start && s.end > edit.start)
      : s.start < edit.end && s.end > edit.start,
  );

  if (touched.some((s) => s.node === null && edit.start !== edit.end)) {
    throw new AnchorConflictError(edit, actual);
  }

  const textSegs = touched.flatMap((s) =>
    s.node
      ? [
          {
            ...s,
            node: s.node,
          },
        ]
      : [],
  );
  const first =
    edit.start === edit.end
      ? (textSegs.find((s) => s.end === edit.start) ?? textSegs[0])
      : textSegs[0];
  const doc = map.el.ownerDocument;

  if (!first && doc && !map.text && edit.start === 0 && edit.end === 0) {
    const run =
      firstChild(map.el, "r") ??
      map.el.appendChild(doc.createElementNS(W_NS, "w:r"));
    const t = doc.createElementNS(W_NS, "w:t");

    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(doc.createTextNode(value));
    run.appendChild(t);

    return;
  }

  if (!first || !doc) {
    throw new AnchorConflictError(edit, actual);
  }

  textSegs.forEach((seg) => {
    const { node } = seg;
    const current = node.textContent ?? "";
    const localStart = Math.max(0, edit.start - seg.start);
    const localEnd = Math.min(current.length, edit.end - seg.start);
    const next =
      seg === first
        ? current.slice(0, localStart) +
          value +
          current.slice(Math.max(localEnd, localStart))
        : edit.start === edit.end
          ? current
          : current.slice(0, localStart) + current.slice(localEnd);

    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }

    node.appendChild(doc.createTextNode(next));
    node.setAttributeNS(XML_NS, "xml:space", "preserve");
  });

  if (value === edit.expected) {
    return;
  }

  if (edit.expected.length && !edit.expected.trim()) {
    const run = nearestAncestor(first.node, "r");
    const rPr = run ? firstChild(run, "rPr") : null;
    const u = rPr ? firstChild(rPr, "u") : null;

    if (u && first.node.textContent === value) {
      rPr?.removeChild(u);
    }
  }

  for (const seg of edit.start === edit.end ? [first] : textSegs) {
    for (let n = seg.node.parentNode; n; n = n.parentNode) {
      if (
        n instanceof XmlElement &&
        n.namespaceURI === W_NS &&
        n.localName === "sdt"
      ) {
        commitControl(n, placeholderStyles);
      }
    }
  }
}
