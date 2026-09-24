import type { RenderedBlock } from "./blocks";
import type { TextEdit } from "./edit";

/**
 * Plain-text clause references (“see clause 6”) tracked from the template, so that removing or
 * restoring a conditional clause keeps the numbers written in the text in line with the numbering.
 */

/** “clause 6”, “clauses 6.1”, “article 3”, “paragraphe 2.1” … followed by a clause number. */
const REFERENCE = /\b(clauses?|articles?|sections?|paragraphs?|paragraphes?)\s+(\d+(?:\.\d+)*)\b/giu;
/** “section 3 of the Companies Act”, “article 1240 du Code civil”: references to other instruments are never rewritten. */
const EXTERNAL = /^\s*(of|du|de la|de l’|de l'|des)\s+(the\s+|la\s+|le\s+)?\p{Lu}/u;

const cleanLabel = (label: string) => label.replace(/[.)\s]+$/, "");

/** The sentence holding a reference, shortened at word boundaries. */
function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(". ", at) + 2, 0);
  const endDot = text.indexOf(".", at);
  let s = text.slice(start, endDot < 0 ? undefined : endDot + 1).trim();
  if (s.length > 140) s = `${s.slice(0, 137).replace(/\s+\S*$/, "")}…`;
  return s;
}

function labelsByParaId(blocks: RenderedBlock[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of blocks) if (b.partKind === "body" && b.paraId && b.numberLabel && /\d/.test(b.numberLabel)) m.set(b.paraId, cleanLabel(b.numberLabel));
  return m;
}

/** A plain-text clause reference, tracked from the template so later updates stay reversible. */
export interface TrackedReference {
  /** Paragraph holding the reference, and which reference in that paragraph it is. */
  paraId: string;
  nth: number;
  /** Paragraph of the clause it points to (by the template's own numbering). */
  target: string;
  /** Number currently written in the draft; if the text no longer says this, the user changed it and we leave it alone. */
  written: string;
}

/** Finds references in the template whose number matches exactly one numbered clause. */
export function trackReferences(template: RenderedBlock[]): TrackedReference[] {
  const labels = labelsByParaId(template);
  const byLabel = new Map<string, string[]>();
  for (const [id, label] of labels) byLabel.set(label, [...(byLabel.get(label) ?? []), id]);
  const out: TrackedReference[] = [];
  for (const b of template) {
    if (b.partKind !== "body" || !b.paraId) continue;
    [...b.text.matchAll(REFERENCE)].forEach((m, nth) => {
      if (EXTERNAL.test(b.text.slice(m.index + m[0].length))) return;
      const targets = byLabel.get(m[2]!);
      if (targets?.length === 1 && targets[0] !== b.paraId) out.push({ paraId: b.paraId!, nth, target: targets[0]!, written: m[2]! });
    });
  }
  return out;
}

export interface ReferenceSync {
  edits: TextEdit[];
  references: TrackedReference[];
  issues: string[];
}

/** Brings every untouched reference in line with the current numbering; reports references to clauses that are gone. */
export function syncReferences(refs: TrackedReference[], current: RenderedBlock[]): ReferenceSync {
  const labels = labelsByParaId(current);
  const byPara = new Map(current.filter((b) => b.paraId).map((b) => [b.paraId!, b]));
  const edits: TextEdit[] = [];
  const issues: string[] = [];
  const references = refs.map((r) => {
    const b = byPara.get(r.paraId);
    const m = b ? [...b.text.matchAll(REFERENCE)][r.nth] : undefined;
    if (!b || !m || m[2] !== r.written) return r;
    if (!byPara.has(r.target)) {
      issues.push(`“${sentenceAround(b.text, m.index)}” refers to ${m[1]} ${m[2]}, which is no longer in the draft.`);
      return r;
    }
    const next = labels.get(r.target);
    if (!next || next === r.written) return r;
    const start = m.index + m[0].length - m[2]!.length;
    edits.push({ blockId: b.id, start, end: start + m[2]!.length, expected: m[2]!, value: next });
    return { ...r, written: next };
  });
  return { edits, references, issues };
}
