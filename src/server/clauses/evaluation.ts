import type { ClauseState } from "@/features/documents/contracts/document-view";
import type { Field } from "@/features/documents/contracts/fields";
import { outstandingFields } from "@/features/documents/progress";
import { normalizeKey } from "@/server/docx/detect";
import type { FieldState, Rule } from "@/server/fields/state";

/** Deterministic evaluation of conditional clauses against the answers. There is no expression language. */

export interface Evaluation {
  state: ClauseState;
  reason: string;
}

const same = (a: string, b: string) => normalizeKey(a) === normalizeKey(b);

/** An unanswered or unclear condition leaves the rule unresolved, never false. */
export function evaluateRule(rule: Rule, fields: Field[]): Evaluation {
  if (rule.dismissed) return { state: "dismissed", reason: "You dismissed this suggested condition; the clause stays as written." };
  if (!rule.confirmed) return { state: "proposed", reason: "Suggested from the template wording. Confirm it to make the clause conditional." };
  if (rule.override) return { state: rule.override === "include" ? "included" : "excluded", reason: `Manual override: always ${rule.override}.` };
  const f = fields.find((x) => x.id === rule.condition.fieldId);
  if (!f) return { state: "unresolved", reason: `The answer it depends on (${rule.condition.fieldId}) does not exist.` };
  if (f.status !== "confirmed" || !f.normalized)
    return {
      state: "unresolved",
      reason: f.status === "needs_clarification" ? `${f.label} needs clarification: ${f.note ?? "unclear answer"}` : `Waiting for an answer: ${f.label}.`,
    };
  const n = f.normalized;
  const { op, values } = rule.condition;
  let include: boolean;
  if (op === "is_true" || op === "is_false") {
    if (n.kind !== "boolean") return { state: "unresolved", reason: `${f.label} must be answered yes or no.` };
    include = op === "is_true" ? n.value : !n.value;
  } else {
    const actual = n.kind === "text" || n.kind === "number" ? n.value : (f.displayValue ?? "");
    include = op === "equals" ? same(actual, values[0] ?? "") : values.some((v) => same(actual, v));
  }
  return { state: include ? "included" : "excluded", reason: `${f.label} = ${f.displayValue}` };
}

export const evaluateAll = (state: Pick<FieldState, "rules" | "fields">) => new Map(state.rules.map((r) => [r.id, evaluateRule(r, state.fields)]));

/** Clause content stays in the document unless its rule evaluates to excluded (or is still undecided at draft time). */
export const keepsContent = (s: ClauseState) => s === "included" || s === "proposed" || s === "dismissed";

/**
 * Fields not needed right now: those that appear only inside excluded or undecided clauses,
 * and condition answers no active rule depends on. Their answers are kept for later reuse.
 */
export function inactiveFields(state: Pick<FieldState, "rules" | "fields">): Set<string> {
  const evals = evaluateAll(state);
  const hidden = new Set<string>();
  for (const r of state.rules) {
    const s = evals.get(r.id)?.state;
    if (s === "excluded" || s === "unresolved") r.blockIds.forEach((id) => hidden.add(id));
  }
  const neededConditions = new Set(state.rules.filter((r) => r.confirmed && !r.dismissed && !r.override).map((r) => r.condition.fieldId));
  const out = new Set<string>();
  for (const f of state.fields) {
    if (f.source === "condition") {
      if (!neededConditions.has(f.id)) out.add(f.id);
      continue;
    }
    if (f.occurrences.length && f.occurrences.every((o) => hidden.has(o.blockId))) out.add(f.id);
  }
  return out;
}

export const unresolvedRules = (state: Pick<FieldState, "rules" | "fields">) => state.rules.filter((r) => evaluateRule(r, state.fields).state === "unresolved");

/** Template blocks to leave out of a draft: control markers always, and content of excluded clauses. */
export function omittedBlocks(state: Pick<FieldState, "rules" | "fields">): Set<string> {
  const out = new Set<string>();
  for (const r of state.rules) {
    r.markerBlockIds.forEach((id) => out.add(id));
    if (!keepsContent(evaluateRule(r, state.fields).state)) r.blockIds.forEach((id) => out.add(id));
  }
  return out;
}

/** Required answers still missing, ignoring fields that only live in excluded or undecided clauses. */
export const requiredMissing = (state: FieldState): Field[] => outstandingFields(state.fields, inactiveFields(state));
