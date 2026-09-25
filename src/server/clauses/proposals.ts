import type { Field } from "@/features/documents/contracts/fields";
import type { Block } from "@/server/docx/blocks";
import type { Rule } from "@/server/fields/state";
import {
  clauseLabel,
  conditionFieldId,
  labelFromId,
} from "./condition-markers";

/**
 * A clause proposed by the model from ordinary template
 * wording. It never applies until the user confirms it.
 */
export interface RuleProposal {
  label: string;
  firstBlockId: string;
  lastBlockId: string;
  conditionName: string;
  question: string;
  questionFr: string | null;
  evidence: string;
}

/**
 * Validates a proposal against the real document: blocks exist, are
 * in order, contain whole tables, and the evidence is verbatim.
 */
export function validateProposal(
  p: RuleProposal,
  blocks: Block[],
  taken: ReadonlySet<string>,
):
  | {
      rule: Rule;
      field: Field;
    }
  | string {
  const body = blocks.filter((b) => b.partKind === "body");
  const from = body.findIndex((b) => b.id === p.firstBlockId);
  const to = body.findIndex((b) => b.id === p.lastBlockId);

  if (from < 0 || to < from) {
    return `proposal “${p.label}”: unknown or reversed clause boundaries`;
  }

  const content = body.slice(from, to + 1);

  if (content.some((b) => taken.has(b.id))) {
    return `proposal “${p.label}”: overlaps another conditional clause`;
  }

  const tables = new Set(
    content.flatMap((b) => (b.table ? [b.table.table] : [])),
  );

  for (const t of tables) {
    const cells = body.filter((b) => b.table?.table === t);
    const [head] = cells;
    const tail = cells.at(-1);

    if (!head || !tail || !content.includes(head) || !content.includes(tail)) {
      return `proposal “${p.label}”: would cut through a table`;
    }
  }

  const evidence = p.evidence.trim();

  if (evidence.length < 8 || !blocks.some((b) => b.text.includes(evidence))) {
    return `proposal “${p.label}”: evidence is not verbatim template text`;
  }

  const fieldId = conditionFieldId(p.conditionName);

  if (!/^[a-z][a-z0-9_]{0,63}$/.test(fieldId)) {
    return `proposal “${p.label}”: unusable condition name`;
  }

  const label = labelFromId(fieldId);

  return {
    rule: {
      id: `clause_${fieldId}`.slice(0, 64),
      label: p.label.slice(0, 120) || clauseLabel(content),
      blockIds: content.map((b) => b.id),
      markerBlockIds: [],
      condition: {
        fieldId,
        op: "is_true",
        values: [],
      },
      source: "ai",
      confirmed: false,
      dismissed: false,
      evidence: evidence.slice(0, 300),
      override: null,
      applied: null,
      paraIds: [],
      slot: {
        before: null,
        after: null,
      },
      removedXml: null,
      contentHash: null,
    },
    field: {
      id: fieldId,
      label,
      question: p.question.slice(0, 240),
      ...(p.questionFr ? { questionFr: p.questionFr.slice(0, 240) } : {}),
      valueType: "boolean",
      group: "other",
      occurrences: [],
      context: evidence.slice(0, 400),
      required: true,
      confidence: 0.7,
      source: "condition",
      status: "missing",
      rawValue: null,
      displayValue: null,
      normalized: null,
      note: null,
      related: [],
    },
  };
}
