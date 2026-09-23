import { z } from "zod";
import { normalizeKey, type MarkerOccurrence } from "../docx/detect";
import type { AppliedEdit, Block, TextEdit } from "../docx/ooxml";
import { detectLanguage, stripAccents } from "./lang";
import { renderAt } from "./normalize";
import { parseConditionMarkers, validateProposal, type RuleProposal } from "./rules";
import { FieldGroup, ValueType, type DocLanguage, type DraftAnchor, type Field, type FieldState, type Occurrence, type Rule } from "./types";

/** Schema the model must satisfy for template analysis. Kept small on purpose. */
export const TemplateAnalysis = z.object({
  // Gemini rejects maxItems on arrays of objects (HTTP 400); caps are applied in buildFields.
  fields: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).describe("English snake_case identifier, whatever the template language"),
      label: z.string().min(1).max(120).describe("Short label in the template's language"),
      question: z.string().max(240).describe("Plain-language question for a lawyer, in English"),
      questionFr: z.string().max(240).nullable().optional().describe("The same question in French"),
      valueType: ValueType,
      group: FieldGroup,
      required: z.boolean(),
      markerKeys: z.array(z.string()).describe("Keys of the detected markers that mean this same thing"),
      implicit: z
        .array(z.object({ blockId: z.string(), quote: z.string().min(3).max(160).describe("Verbatim text immediately BEFORE the missing information") }))
        .describe("Places where information is missing but no marker exists"),
    }),
  ),
  notFields: z.array(z.string()).describe("Marker keys that are ordinary contract text, not fillable fields"),
  conditions: z
    .array(z.object({ name: z.string().describe("Name used in the [[IF name]] marker"), question: z.string().max(240), questionFr: z.string().max(240).nullable().optional() }))
    .optional()
    .describe("A plain question for each [[IF …]] condition marker listed"),
  proposedRules: z
    .array(
      z.object({
        label: z.string().max(120),
        firstBlockId: z.string(),
        lastBlockId: z.string(),
        conditionName: z.string().describe("English snake_case name of the yes/no answer the clause depends on"),
        question: z.string().max(240),
        questionFr: z.string().max(240).nullable().optional(),
        evidence: z.string().max(300).describe("Verbatim template text that states the clause is conditional"),
      }),
    )
    .optional()
    .describe("Clauses the template itself says are optional or conditional, without [[IF]] markers"),
});
export type TemplateAnalysis = z.infer<typeof TemplateAnalysis>;

const slug = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 60) || "field";

/**
 * Deterministic fallback typing for markers the model did not describe (English and French
 * wording). Whole words only: “employer” must not match the French “loyer” (rent).
 */
export function guessType(label: string): { valueType: ValueType; group: FieldGroup } {
  const l = stripAccents(label.toLowerCase());
  const has = (words: string) => new RegExp(`\\b(${words})`).test(l);
  if (/\b(name|nom)\b/.test(l)) return { valueType: "party", group: "parties" };
  if (has("date\\b|commence|start|end\\b|expir|effective|debut|fin\\b|echeance|signature\\b|entree\\b")) return { valueType: "date", group: "dates" };
  if (has("rent|amount|price|fees?\\b|deposit|sum\\b|salary|payment|indemnit|loyer|montant|prix|depot|garantie|salaire|honoraires|remuneration|acompte|solde")) return { valueType: "money", group: "money" };
  if (has("rate|percent|interest|taux|pourcentage|interet")) return { valueType: "percentage", group: "money" };
  if (has("address|premises|property|situated|adresse|locaux|bien\\b|situe")) return { valueType: "address", group: has("property|premises|locaux|bien\\b") ? "subject" : "parties" };
  if (has("landlord|tenant|party|client|employee|employer|company|lessor|lessee|buyer|seller|bailleur|locataire|partie|salarie|employeur|societe|vendeur|acheteur|prestataire")) return { valueType: "party", group: "parties" };
  if (has("law\\b|jurisdiction|court|droit\\b|juridiction|tribunal")) return { valueType: "jurisdiction", group: "other" };
  if (has("years|months|period|term\\b|duration|duree|mois|annees|periode|preavis|notice")) return { valueType: "duration", group: "other" };
  return { valueType: "text", group: "other" };
}

export interface BuildResult {
  fields: Field[];
  rules: Rule[];
  /** Condition markers that were rejected, shown to the user. */
  ruleIssues: string[];
  /** Model claims that failed verification against the document, for logging/tests. */
  rejected: string[];
}

/**
 * Combines deterministic markers with an optional model analysis. Every model-proposed
 * location is verified against the real block text; unverifiable claims are dropped.
 * Conditional clauses come from `[[IF …]]` markers (deterministic) and, optionally, from model
 * proposals that stay unconfirmed until the user accepts them.
 */
export function buildFields(blocks: Block[], markers: MarkerOccurrence[], analysis: TemplateAnalysis | null): BuildResult {
  const byKey = new Map<string, MarkerOccurrence[]>();
  for (const m of markers) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const langOf = new Map(blocks.map((b) => [b.id, detectLanguage(b.text)]));
  const used = new Set<string>();
  const ids = new Set<string>();
  const rejected: string[] = [];
  const fields: Field[] = [];
  const toOccurrence = (m: MarkerOccurrence): Occurrence => ({ blockId: m.blockId, start: m.start, end: m.end, expected: m.text, mode: "replace", marker: m.marker, lang: langOf.get(m.blockId) ?? "unknown" });

  const uniqueId = (base: string) => {
    let id = slug(base);
    let n = 2;
    while (ids.has(id)) id = `${slug(base)}_${n++}`;
    ids.add(id);
    return id;
  };

  // Models often echo a key without its "k:" prefix or with other spacing; resolve it against the
  // real markers (never invent one). Underscore keys are positional and must match exactly.
  const resolveKey = (key: string) => (byKey.has(key) ? key : byKey.has(`k:${normalizeKey(key.replace(/^k:/, ""))}`) ? `k:${normalizeKey(key.replace(/^k:/, ""))}` : key);
  const notFields = new Set((analysis?.notFields ?? []).map(resolveKey));

  for (const af of (analysis?.fields ?? []).slice(0, 80)) {
    const occurrences: Occurrence[] = [];
    for (const raw of af.markerKeys) {
      const key = resolveKey(raw);
      const ms = byKey.get(key);
      if (!ms || used.has(key)) {
        rejected.push(`unknown or reused marker key ${key}`);
        continue;
      }
      used.add(key);
      occurrences.push(...ms.map(toOccurrence));
    }
    for (const imp of af.implicit) {
      const block = blockById.get(imp.blockId);
      const at = block ? block.text.indexOf(imp.quote) : -1;
      if (!block || at < 0 || block.text.indexOf(imp.quote, at + 1) >= 0) {
        rejected.push(`unverifiable quote in ${imp.blockId}: ${imp.quote}`);
        continue;
      }
      const pos = at + imp.quote.length;
      // Don't insert where a marker already sits — that marker is the field.
      if (markers.some((m) => m.blockId === block.id && m.start <= pos + 1 && m.end >= pos)) continue;
      occurrences.push({ blockId: block.id, start: pos, end: pos, expected: "", mode: "insert", marker: "implicit", lang: langOf.get(block.id) ?? "unknown" });
    }
    if (!occurrences.length) continue;
    const first = occurrences[0]!;
    const ctxBlock = blockById.get(first.blockId);
    fields.push({
      id: uniqueId(af.id),
      label: af.label,
      question: af.question,
      ...(af.questionFr ? { questionFr: af.questionFr } : {}),
      valueType: af.valueType,
      group: af.group,
      occurrences,
      context: ctxBlock ? ctxBlock.text.slice(Math.max(0, first.start - 90), first.end + 90) : "",
      required: af.required,
      confidence: occurrences.every((o) => o.marker !== "implicit") ? 0.95 : 0.7,
      source: occurrences.some((o) => o.marker === "implicit") ? "ai" : "marker",
      status: "missing",
      rawValue: null,
      displayValue: null,
      normalized: null,
      note: null,
      related: [],
    });
  }

  // Markers the model didn't account for still become fields (never silently lost).
  for (const [key, ms] of byKey) {
    if (used.has(key) || notFields.has(key)) continue;
    const m = ms[0]!;
    const guess = guessType(m.labelHint);
    fields.push({
      id: uniqueId(m.marker === "underscore" ? `blank_${m.labelHint}` : m.labelHint),
      label: m.labelHint,
      valueType: guess.valueType,
      group: guess.group,
      occurrences: ms.map(toOccurrence),
      context: m.context,
      required: true,
      confidence: m.marker === "underscore" ? 0.6 : 0.9,
      source: "marker",
      status: "missing",
      rawValue: null,
      displayValue: null,
      normalized: null,
      note: m.marker === "underscore" ? "Detected from a blank line; confirm what it should contain." : null,
      related: [],
    });
  }

  // Conditional clauses.
  const parsed = parseConditionMarkers(blocks);
  const rules: Rule[] = [...parsed.rules];
  const questions = new Map((analysis?.conditions ?? []).map((c) => [slug(c.name), c]));
  for (const cf of parsed.conditionFields) {
    const existing = fields.find((f) => f.id === cf.id);
    if (existing) {
      // A template field with the same name decides the clause; it must hold a comparable value.
      if (existing.valueType !== cf.valueType && cf.valueType === "boolean") existing.valueType = "boolean";
      continue;
    }
    const q = questions.get(cf.id);
    ids.add(cf.id);
    fields.push({ ...cf, ...(q ? { question: q.question, ...(q.questionFr ? { questionFr: q.questionFr } : {}) } : {}) });
  }
  const taken = new Set(rules.flatMap((r) => [...r.blockIds, ...r.markerBlockIds]));
  for (const p of (analysis?.proposedRules ?? []).slice(0, 10)) {
    const v = validateProposal({ ...p, questionFr: p.questionFr ?? null } as RuleProposal, blocks, taken);
    if (typeof v === "string") {
      rejected.push(v);
      continue;
    }
    if (rules.some((r) => r.id === v.rule.id)) continue;
    rules.push(v.rule);
    v.rule.blockIds.forEach((id) => taken.add(id));
    // Its yes/no answer exists from the start but is only asked once the user confirms the rule.
    if (!ids.has(v.field.id)) {
      ids.add(v.field.id);
      fields.push(v.field);
    }
  }
  return { fields, rules, ruleIssues: parsed.issues, rejected };
}

/**
 * Edits that turn the template into a draft. Confirmed values are written, rendered for each
 * occurrence's language. Occurrences still unanswered get an identity edit so that their marker
 * position is anchored and a later answer can be written into the draft. Omitted blocks (excluded
 * clauses, condition markers) are skipped: they are removed from the draft.
 */
export function draftEdits(fields: Field[], docLang: DocLanguage, omit: ReadonlySet<string> = new Set()): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const f of fields) {
    for (const o of f.occurrences) {
      if (omit.has(o.blockId)) continue;
      const v = renderAt(f, o.lang, docLang);
      const value = v === null ? o.expected : o.mode === "insert" ? ` ${v}` : v;
      edits.push({ blockId: o.blockId, start: o.start, end: o.end, expected: o.expected, value });
    }
  }
  return edits;
}

/** Anchors for every occurrence written by `draftEdits`, keyed by field, located by paragraph id. */
export function anchorsFrom(fields: Field[], applied: AppliedEdit[], paraIds: ReadonlyMap<string, string>): FieldState["draftAnchors"] {
  const anchors: FieldState["draftAnchors"] = {};
  for (const f of fields) {
    for (const o of f.occurrences) {
      const hit = applied.find((a) => a.edit.blockId === o.blockId && a.edit.start === o.start && a.edit.end === o.end);
      if (hit) (anchors[f.id] ??= []).push({ ...hit.result, paraId: paraIds.get(o.blockId) ?? null, lang: o.lang, mode: o.mode });
    }
  }
  return anchors;
}

export type AnchoredEdit = TextEdit & { fieldId: string; anchor: number };
export type AnchoredUpdate = { edits: AnchoredEdit[]; conflicts: string[] };

/**
 * After a draft exists, a changed answer is applied only where the previous value (or the still
 * unfilled marker) is exactly where we put it. Anything the user edited is reported as a conflict,
 * not overwritten. Anchors whose paragraph is absent (their clause is currently excluded) are
 * skipped; they are brought up to date if the clause is restored.
 */
export function anchoredUpdates(state: FieldState, changed: Field[], currentBlocks: Block[]): AnchoredUpdate {
  const byPara = new Map(currentBlocks.filter((b) => b.paraId).map((b) => [b.paraId!, b]));
  const byId = new Map(currentBlocks.map((b) => [b.id, b]));
  const edits: AnchoredEdit[] = [];
  const conflicts: string[] = [];
  for (const f of changed) {
    const anchors = state.draftAnchors[f.id] ?? [];
    const present = anchors.map((a, i) => ({ a, i, b: a.paraId ? byPara.get(a.paraId) : byId.get(a.blockId) })).filter((x) => x.b);
    if (!present.length) continue;
    if (!present.every((x) => x.b!.text.slice(x.a.start, x.a.end) === x.a.text)) {
      conflicts.push(f.id);
      continue;
    }
    for (const { a, i, b } of present) {
      const v = renderAt(f, a.lang, state.language.document);
      if (v === null) continue;
      const value = a.mode === "insert" ? ` ${v}` : v;
      if (value !== a.text) edits.push({ blockId: b!.id, start: a.start, end: a.end, expected: a.text, value, fieldId: f.id, anchor: i });
    }
  }
  return { edits, conflicts };
}

/**
 * Keeps every anchor correct after server-side text edits: edited anchors take their new range and
 * text, and anchors later in the same paragraph shift by the length change of the edits before them.
 */
export function rebaseAnchors(anchors: FieldState["draftAnchors"], applied: AppliedEdit[], blocks: Block[]): FieldState["draftAnchors"] {
  const paraOf = new Map(blocks.map((b) => [b.id, b.paraId]));
  const byPara = new Map<string, AppliedEdit[]>();
  for (const a of applied) {
    const key = paraOf.get(a.edit.blockId) ?? a.edit.blockId;
    byPara.set(key, [...(byPara.get(key) ?? []), a]);
  }
  const out: FieldState["draftAnchors"] = {};
  for (const [fieldId, list] of Object.entries(anchors)) {
    out[fieldId] = list.map((a): DraftAnchor => {
      const edits = byPara.get(a.paraId ?? a.blockId);
      if (!edits) return a;
      const own = edits.find((e) => e.edit.start === a.start && e.edit.end === a.end && e.edit.expected === a.text);
      if (own) return { ...a, blockId: own.result.blockId, start: own.result.start, end: own.result.end, text: own.result.text };
      const delta = edits.filter((e) => e.edit.end <= a.start).reduce((n, e) => n + e.result.text.length - (e.edit.end - e.edit.start), 0);
      return delta ? { ...a, start: a.start + delta, end: a.end + delta } : a;
    });
  }
  return out;
}
