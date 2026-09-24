import type { Field } from "@/features/documents/contracts/fields";
import type { Block } from "@/server/docx/blocks";
import { normalizeKey } from "@/server/docx/detect";
import type { Rule } from "@/server/fields/state";

/**
 * Conditional clauses. The supported template syntax is deliberately tiny and is parsed, never
 * executed. Each marker must be alone in its own body paragraph (not in a table, header or footer):
 *
 *   [[IF name]]            clause included when the yes/no answer `name` is yes
 *   [[IF NOT name]]        included when it is no
 *   [[IF name = value]]    included when the text answer `name` equals value (case/accent-insensitive)
 *   [[IF name IN a, b]]    included when it equals one of the listed values
 *   [[END IF]]             closes the clause
 *
 * French spellings are accepted: [[SI name]], [[SI NON name]], [[FIN SI]]. Nesting is rejected.
 * Everything between the two markers (paragraphs and whole tables) is the clause; the marker
 * paragraphs themselves never appear in a draft.
 */

const START = /^\[\[\s*(?:IF|SI)\s+(NOT\s+|NON\s+)?([\p{L}][\p{L}\p{N}_ ]{0,60}?)\s*(?:(=|\bIN\b|\bDANS\b)\s*(.+?))?\s*\]\]$/iu;
const END = /^\[\[\s*(?:END\s*IF|ENDIF|FIN\s*SI|FINSI)\s*\]\]$/iu;
const ANY_CONTROL = /\[\[[^\]]*\]\]/;

/** The answer id a condition name refers to (accent- and case-insensitive). */
export const conditionFieldId = (name: string) => normalizeKey(name).replace(/ /g, "_").replace(/^(\d)/, "c_$1").slice(0, 60);
export const labelFromId = (id: string) => {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export interface ParsedConditions {
  rules: Rule[];
  /** Yes/no or text answers the rules depend on, for conditions no other field provides. */
  conditionFields: Field[];
  issues: string[];
}

interface Marker {
  block: Block;
  kind: "start" | "end";
  negate: boolean;
  name: string;
  op: "=" | "in" | null;
  values: string[];
}

function parseMarker(b: Block, issues: string[]): Marker | null {
  const text = b.text.trim();
  if (!ANY_CONTROL.test(text)) return null;
  const where = `“${text.slice(0, 80)}”`;
  if (b.partKind !== "body" || b.table) {
    issues.push(`${where}: condition markers are only supported in the main text, not in tables, headers or footers. It was left as text.`);
    return null;
  }
  if (END.test(text)) return { block: b, kind: "end", negate: false, name: "", op: null, values: [] };
  const m = START.exec(text);
  if (!m) {
    issues.push(`${where}: unsupported condition syntax${text.replace(ANY_CONTROL, "").trim() ? " (a marker must be on its own line)" : ""}. It was left as text.`);
    return null;
  }
  const op = m[3] ? (m[3] === "=" ? "=" : "in") : null;
  const values = m[4] ? m[4].replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^["“'‘]|["”'’]$/g, "")).filter(Boolean) : [];
  if (op && !values.length) {
    issues.push(`${where}: the condition has no value to compare with. It was left as text.`);
    return null;
  }
  if (op && m[1]) {
    issues.push(`${where}: NOT cannot be combined with = or IN. It was left as text.`);
    return null;
  }
  return { block: b, kind: "start", negate: Boolean(m[1]), name: (m[2] ?? "").trim(), op, values };
}

export const clauseLabel = (blocks: Block[]) => {
  const first = blocks.find((b) => b.text.trim())?.text.trim() ?? "Conditional clause";
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
};

/** Reads `[[IF …]]` markers from the template body. Invalid, unpaired or nested markers are reported, never guessed at. */
export function parseConditionMarkers(blocks: Block[]): ParsedConditions {
  const issues: string[] = [];
  const body = blocks.filter((b) => b.partKind === "body");
  const markers: Marker[] = [];
  for (const b of blocks) {
    const m = parseMarker(b, issues);
    if (m) markers.push(m);
  }
  const rules: Rule[] = [];
  const fields = new Map<string, Field>();
  const ids = new Set<string>();
  let open: { m: Marker; nested: boolean } | null = null;
  let depth = 0;
  for (const m of markers) {
    if (m.kind === "start") {
      if (open) {
        open.nested = true;
        depth++;
        continue;
      }
      open = { m, nested: false };
      depth = 1;
      continue;
    }
    if (!open) {
      issues.push(`“${m.block.text.trim()}” has no matching [[IF …]] above it. It was left as text.`);
      continue;
    }
    if (--depth > 0) continue;
    const start = open.m;
    const nested = open.nested;
    open = null;
    if (nested) {
      issues.push(`“${start.block.text.trim()}”: nested conditions are not supported. The clause and its markers were left unchanged.`);
      continue;
    }
    const from = body.findIndex((b) => b.id === start.block.id);
    const to = body.findIndex((b) => b.id === m.block.id);
    const content = body.slice(from + 1, to);
    if (!content.length) {
      issues.push(`“${start.block.text.trim()}” encloses nothing. It was left as text.`);
      continue;
    }
    const fieldId = conditionFieldId(start.name);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(fieldId)) {
      issues.push(`“${start.block.text.trim()}”: “${start.name}” is not a usable answer name. It was left as text.`);
      continue;
    }
    const boolean = start.op === null;
    if (!fields.has(fieldId)) {
      const label = labelFromId(fieldId);
      fields.set(fieldId, {
        id: fieldId,
        label,
        question: boolean ? `Does this apply to this agreement: ${label.toLowerCase()}? (yes or no)` : `What is the ${label.toLowerCase()}?`,
        questionFr: boolean ? `Cette condition s'applique-t-elle à ce contrat : ${label.toLowerCase()} ? (oui ou non)` : `Quelle est la valeur de « ${label.toLowerCase()} » ?`,
        valueType: boolean ? "boolean" : "text",
        group: "other",
        occurrences: [],
        context: start.block.text.trim().slice(0, 400),
        required: true,
        confidence: 1,
        source: "condition",
        status: "missing",
        rawValue: null,
        displayValue: null,
        normalized: null,
        note: null,
        related: [],
      });
    }
    let id = `clause_${fieldId}`.slice(0, 60);
    for (let n = 2; ids.has(id); n++) id = `clause_${fieldId}_${n}`.slice(0, 64);
    ids.add(id);
    rules.push({
      id,
      label: clauseLabel(content),
      blockIds: content.map((b) => b.id),
      markerBlockIds: [start.block.id, m.block.id],
      condition: { fieldId, op: boolean ? (start.negate ? "is_false" : "is_true") : start.op === "=" ? "equals" : "in", values: start.values },
      source: "marker",
      confirmed: true,
      dismissed: false,
      evidence: start.block.text.trim().slice(0, 300),
      override: null,
      applied: null,
      paraIds: [],
      slot: { before: null, after: null },
      removedXml: null,
      contentHash: null,
    });
  }
  if (open) issues.push(`“${open.m.block.text.trim()}” is never closed with [[END IF]]. It was left as text.`);
  return { rules, conditionFields: [...fields.values()], issues };
}
