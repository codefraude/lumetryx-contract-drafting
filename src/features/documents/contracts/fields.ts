import { z } from "zod";

/**
 * The field model shared by the server and the browser: what a blank in the template is, where it
 * sits, and what the lawyer answered. Server-only persisted state (clause rules, draft anchors)
 * lives in `@/server/fields/state`.
 */

export const ValueType = z.enum(["text", "party", "address", "date", "money", "number", "duration", "percentage", "jurisdiction", "boolean"]);
export type ValueType = z.infer<typeof ValueType>;

export const FieldGroup = z.enum(["parties", "subject", "dates", "money", "other"]);
export type FieldGroup = z.infer<typeof FieldGroup>;

/** Order in which the assistant asks, and in which the Details panel lists, the groups. */
export const GROUP_ORDER: FieldGroup[] = ["parties", "subject", "dates", "money", "other"];

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

/** A problem found while changing the draft's structure (e.g. a reference to a removed clause). */
export const StructureIssue = z.object({ ruleId: z.string().nullable(), message: z.string() });
export type StructureIssue = z.infer<typeof StructureIssue>;
