import { FieldGroup, ValueType, type Field, type Occurrence } from "@/features/documents/contracts/fields";
import { parseConditionMarkers } from "@/server/clauses/condition-markers";
import { validateProposal } from "@/server/clauses/proposals";
import type { Block } from "@/server/docx/blocks";
import { humanize, normalizeKey, type MarkerOccurrence } from "@/server/docx/detect";
import { detectLanguage, stripAccents } from "./lang";
import type { Rule } from "./state";
import type { TemplateAnalysis } from "./template-analysis";

const slug = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 60) || "field";

/**
 * Deterministic fallback typing for markers the model did not describe (English and French
 * wording). Whole words only: “employer” must not match the French “loyer” (rent).
 */
/** The model sometimes copies the marker as the label (“{{tenant_name}}”, “LANDLORD NAME”); the lawyer sees a readable name. */
const readableLabel = (label: string) => (/^\s*(\{\{.*\}\}|\[.*\])\s*$|_|^[^a-z]*$/.test(label) ? humanize(label.replace(/[{}[\]]/g, "")) : label);

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
  /** Places given to implicit values so far; two answers never share or overlap one. */
  const taken: Occurrence[] = [];

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
      // Placeholder wording (e.g. a line reading “Nom du destinataire”) is replaced by the value;
      // otherwise the value goes right after the quote. A placeholder is short and on one line.
      if (imp.replace && (imp.quote.length > 80 || /[\t\n]/.test(imp.quote))) {
        rejected.push(`not a placeholder in ${imp.blockId}: ${imp.quote}`);
        continue;
      }
      const [start, end] = imp.replace ? [at, at + imp.quote.length] : [at + imp.quote.length, at + imp.quote.length];
      // Don't write where a marker already sits (or right before one) — that marker is the field.
      if (markers.some((m) => m.blockId === block.id && m.start <= end + 1 && m.end >= start)) continue;
      if (taken.some((t) => t.blockId === block.id && start < t.end && t.start < end)) {
        rejected.push(`overlapping place in ${imp.blockId}: ${imp.quote}`);
        continue;
      }
      const o: Occurrence = { blockId: block.id, start, end, expected: imp.replace ? imp.quote : "", mode: imp.replace ? "replace" : "insert", marker: "implicit", lang: langOf.get(block.id) ?? "unknown" };
      taken.push(o);
      occurrences.push(o);
    }
    const [first] = occurrences;
    if (!first) continue;
    const ctxBlock = blockById.get(first.blockId);
    fields.push({
      id: uniqueId(af.id),
      label: readableLabel(af.label),
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
    const [m] = ms;
    if (!m || used.has(key) || notFields.has(key)) continue;
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
  const inRules = new Set(rules.flatMap((r) => [...r.blockIds, ...r.markerBlockIds]));
  for (const p of (analysis?.proposedRules ?? []).slice(0, 10)) {
    const v = validateProposal({ ...p, questionFr: p.questionFr ?? null }, blocks, inRules);
    if (typeof v === "string") {
      rejected.push(v);
      continue;
    }
    if (rules.some((r) => r.id === v.rule.id)) continue;
    rules.push(v.rule);
    v.rule.blockIds.forEach((id) => inRules.add(id));
    // Its yes/no answer exists from the start but is only asked once the user confirms the rule.
    if (!ids.has(v.field.id)) {
      ids.add(v.field.id);
      fields.push(v.field);
    }
  }
  // Two answers never share a name (a template may say “Adresse postale” for two parties), or
  // neither the assistant nor the lawyer could tell which one is meant.
  const seen = new Map<string, number>();
  for (const f of fields) {
    const k = f.label.trim().toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) f.label = `${f.label.slice(0, 114)} (${n})`;
  }
  return { fields, rules, ruleIssues: parsed.issues, rejected };
}
