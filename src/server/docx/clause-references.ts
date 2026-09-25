import type { RenderedBlock } from "./blocks";
import type { TextEdit } from "./edit";

const REFERENCE =
  /\b(clauses?|articles?|sections?|paragraphs?|paragraphes?)\s+(\d+(?:\.\d+)*)\b/giu;
const EXTERNAL =
  /^\s*(of|du|de la|de l’|de l'|des)\s+(the\s+|la\s+|le\s+)?\p{Lu}/u;

const cleanLabel = (label: string) => {
  return label.replace(/[.)\s]+$/, "");
};

function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(". ", at) + 2, 0);
  const endDot = text.indexOf(".", at);
  let s = text.slice(start, endDot < 0 ? undefined : endDot + 1).trim();

  if (s.length > 140) {
    s = `${s.slice(0, 137).replace(/\s+\S*$/, "")}…`;
  }

  return s;
}

function labelsByParaId(blocks: RenderedBlock[]): Map<string, string> {
  const m = new Map<string, string>();

  for (const b of blocks) {
    if (
      b.partKind === "body" &&
      b.paraId &&
      b.numberLabel &&
      /\d/.test(b.numberLabel)
    ) {
      m.set(b.paraId, cleanLabel(b.numberLabel));
    }
  }

  return m;
}

export interface TrackedReference {
  paraId: string;
  nth: number;
  target: string;
  written: string;
}

export function trackReferences(template: RenderedBlock[]): TrackedReference[] {
  const labels = labelsByParaId(template);
  const byLabel = new Map<string, string[]>();

  for (const [id, label] of labels) {
    byLabel.set(label, [...(byLabel.get(label) ?? []), id]);
  }

  const out: TrackedReference[] = [];

  for (const b of template) {
    const { paraId } = b;

    if (b.partKind !== "body" || !paraId) {
      continue;
    }

    [...b.text.matchAll(REFERENCE)].forEach((m, nth) => {
      if (EXTERNAL.test(b.text.slice(m.index + m[0].length))) {
        return;
      }

      const [, , written = ""] = m;
      const targets = byLabel.get(written);
      const target = targets?.length === 1 ? targets[0] : undefined;

      if (target && target !== paraId) {
        out.push({
          paraId,
          nth,
          target,
          written,
        });
      }
    });
  }

  return out;
}

export interface ReferenceSync {
  edits: TextEdit[];
  references: TrackedReference[];
  issues: string[];
}

export function syncReferences(
  refs: TrackedReference[],
  current: RenderedBlock[],
): ReferenceSync {
  const labels = labelsByParaId(current);
  const byPara = new Map<string, RenderedBlock>();

  for (const b of current) {
    if (b.paraId) {
      byPara.set(b.paraId, b);
    }
  }

  const edits: TextEdit[] = [];
  const issues: string[] = [];
  const references = refs.map((r) => {
    const b = byPara.get(r.paraId);
    const m = b ? [...b.text.matchAll(REFERENCE)][r.nth] : undefined;

    if (!b || !m || m[2] !== r.written) {
      return r;
    }

    if (!byPara.has(r.target)) {
      issues.push(
        `“${sentenceAround(b.text, m.index)}” refers to ${m[1]} ${m[2]}, which is no longer in the draft.`,
      );

      return r;
    }

    const next = labels.get(r.target);

    if (!next || next === r.written) {
      return r;
    }

    const start = m.index + m[0].length - r.written.length;

    edits.push({
      blockId: b.id,
      start,
      end: start + r.written.length,
      expected: r.written,
      value: next,
    });

    return {
      ...r,
      written: next,
    };
  });

  return {
    edits,
    references,
    issues,
  };
}
