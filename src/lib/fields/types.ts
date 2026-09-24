import { z } from "zod";

export const ValueType = z.enum(["text", "party", "address", "date", "money", "number", "duration", "percentage", "jurisdiction", "boolean"]);
export type ValueType = z.infer<typeof ValueType>;

export const FieldGroup = z.enum(["parties", "subject", "dates", "money", "other"]);
export type FieldGroup = z.infer<typeof FieldGroup>;

export const FieldStatus = z.enum(["missing", "needs_clarification", "confirmed"]);
export type FieldStatus = z.infer<typeof FieldStatus>;

/** Language of a block or occurrence. "unknown" is stored explicitly when detection is not confident. */
export const Lang = z.enum(["en", "fr", "unknown"]);
export type Lang = z.infer<typeof Lang>;

export const DocLanguage = z.enum(["en", "fr", "mixed", "unknown"]);
export type DocLanguage = z.infer<typeof DocLanguage>;

export const ChatLanguage = z.enum(["en", "fr"]);
export type ChatLanguage = z.infer<typeof ChatLanguage>;

/** A concrete place in the template the field's value goes. */
export const Occurrence = z.object({
  blockId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** Exact template text at [start,end) — the marker or placeholder, or "" for an insertion point. */
  expected: z.string(),
  mode: z.enum(["replace", "insert"]),
  marker: z.enum(["brace", "bracket", "underscore", "control", "implicit"]),
  /** Language of the surrounding paragraph; decides how dates and amounts are rendered here. */
  lang: Lang.default("unknown"),
});
export type Occurrence = z.infer<typeof Occurrence>;

export const NormalizedValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal("money"), amount: z.string().regex(/^\d+(\.\d{1,4})?$/), currency: z.string().min(3).max(3), /** Symbol the user wrote when it differs from the code (e.g. "Rs"). */ symbol: z.string().max(8).optional() }),
  z.object({ kind: z.literal("number"), value: z.string() }),
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
]);
export type NormalizedValue = z.infer<typeof NormalizedValue>;

export const Field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(120),
  question: z.string().max(240).optional(),
  /** French wording of the question, when the analysis provided one. */
  questionFr: z.string().max(240).optional(),
  valueType: ValueType,
  group: FieldGroup,
  /** Empty only for condition fields, which decide clauses but are never written into the document. */
  occurrences: z.array(Occurrence),
  context: z.string().max(400),
  required: z.boolean(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["marker", "ai", "condition"]),
  status: FieldStatus,
  /** What the user said, verbatim-ish. */
  rawValue: z.string().max(500).nullable(),
  /** Canonical presentation (English conventions); occurrences may render it per language. */
  displayValue: z.string().max(500).nullable(),
  normalized: NormalizedValue.nullable(),
  /** Why clarification is needed, shown to the user. */
  note: z.string().max(300).nullable(),
  /** Other fields describing the same party/thing (e.g. landlord name + landlord type). */
  related: z.array(z.string()).default([]),
});
export type Field = z.infer<typeof Field>;

/** The only predicates a conditional clause supports. There is no expression language. */
export const Condition = z.object({
  fieldId: z.string(),
  op: z.enum(["is_true", "is_false", "equals", "in"]),
  values: z.array(z.string()).default([]),
});
export type Condition = z.infer<typeof Condition>;

export const Rule = z.object({
  /** Stable, language-independent clause id. */
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(120),
  /** Original template body blocks that make up the clause, in document order. */
  blockIds: z.array(z.string()).min(1),
  /** `[[IF …]]` / `[[END IF]]` paragraphs; always removed from drafts. */
  markerBlockIds: z.array(z.string()).default([]),
  condition: Condition,
  source: z.enum(["marker", "ai"]),
  /** Marker rules come from the template itself; model-proposed rules apply only once the user confirms them. */
  confirmed: z.boolean(),
  dismissed: z.boolean().default(false),
  /** Verbatim template wording a proposed rule is based on. */
  evidence: z.string().max(300).nullable().default(null),
  /** Explicit, persisted user decision that wins over the condition. */
  override: z.enum(["include", "exclude"]).nullable().default(null),
  // ---- state of the working draft (null until a draft exists) ----
  /** What the working draft currently contains. */
  applied: z.enum(["included", "excluded"]).nullable().default(null),
  /** w14:paraIds of the clause's paragraphs in the working draft. */
  paraIds: z.array(z.string()).default([]),
  /** Neighbouring paragraph ids, used to put a removed clause back in the same place. */
  slot: z.object({ before: z.string().nullable(), after: z.string().nullable() }).default({ before: null, after: null }),
  /** The clause exactly as it was when removed from the working draft (keeps manual edits for a later restore). */
  removedXml: z.string().nullable().default(null),
  /** Hash of the clause's text and formatting when the server last wrote it; a mismatch means it was edited by hand. */
  contentHash: z.string().nullable().default(null),
});
export type Rule = z.infer<typeof Rule>;

export const DraftAnchor = z.object({
  blockId: z.string(),
  /** Stable paragraph id in the working draft; preferred over blockId, which shifts when paragraphs move. */
  paraId: z.string().nullable().default(null),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  lang: Lang.default("unknown"),
  mode: z.enum(["replace", "insert"]).default("replace"),
});
export type DraftAnchor = z.infer<typeof DraftAnchor>;

export const StructureIssue = z.object({ ruleId: z.string().nullable(), message: z.string() });
export type StructureIssue = z.infer<typeof StructureIssue>;

/** Field state is persisted as JSONB; defaults backfill records written before these keys existed. */
export const FieldState = z.object({
  version: z.number().int().default(1),
  fields: z.array(Field),
  /** Where each value (or its still-unfilled marker) currently sits in the working draft, for safe later updates. */
  draftAnchors: z.record(z.string(), z.array(DraftAnchor)).default({}),
  rules: z.array(Rule).default([]),
  /** Template condition markers that were rejected (unpaired, nested, unsupported syntax). */
  ruleIssues: z.array(z.string()).default([]),
  /** Problems found while changing the draft's structure (e.g. a reference to a removed clause). */
  structureIssues: z.array(StructureIssue).default([]),
  /** Clause changes the conditions call for but that wait for the user's confirmation (the clause was edited by hand). */
  pendingClauses: z.array(z.string()).default([]),
  /** Plain-text clause references (“see clause 6”) kept in line with numbering when clauses are removed or restored. */
  references: z.array(z.object({ paraId: z.string(), nth: z.number().int(), target: z.string(), written: z.string() })).default([]),
  language: z.object({ document: DocLanguage, en: z.number(), fr: z.number() }).default({ document: "unknown", en: 0, fr: 0 }),
  /** Explicit conversation language chosen by the user; null = follow the user's messages, then the template. */
  conversationLanguage: ChatLanguage.nullable().default(null),
});
export type FieldState = z.infer<typeof FieldState>;

export const GROUP_ORDER: FieldGroup[] = ["parties", "subject", "dates", "money", "other"];

/**
 * Required, unconfirmed fields in questioning order. Fields that only appear inside excluded
 * (or still-undecided) clauses are skipped: they are not needed unless their clause is included.
 */
export const outstandingFields = (fields: Field[], inactive: ReadonlySet<string> = new Set()): Field[] =>
  fields
    .filter((f) => f.required && f.status !== "confirmed" && !inactive.has(f.id))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
