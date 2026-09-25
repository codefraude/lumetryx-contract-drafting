import { z } from "zod";

export const ValueType = z.enum([
  "text",
  "party",
  "address",
  "date",
  "money",
  "number",
  "duration",
  "percentage",
  "jurisdiction",
  "boolean",
]);

export type ValueType = z.infer<typeof ValueType>;

export const FieldGroup = z.enum([
  "parties",
  "subject",
  "dates",
  "money",
  "other",
]);

export type FieldGroup = z.infer<typeof FieldGroup>;

export const GROUP_ORDER: FieldGroup[] = [
  "parties",
  "subject",
  "dates",
  "money",
  "other",
];

export const FieldStatus = z.enum([
  "missing",
  "needs_clarification",
  "confirmed",
]);

export type FieldStatus = z.infer<typeof FieldStatus>;

export const Lang = z.enum(["en", "fr", "unknown"]);
export type Lang = z.infer<typeof Lang>;

export const DocLanguage = z.enum(["en", "fr", "mixed", "unknown"]);
export type DocLanguage = z.infer<typeof DocLanguage>;

export const ChatLanguage = z.enum(["en", "fr"]);
export type ChatLanguage = z.infer<typeof ChatLanguage>;

export const Occurrence = z.object({
  blockId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  expected: z.string(),
  mode: z.enum(["replace", "insert"]),
  marker: z.enum([
    "brace",
    "bracket",
    "underscore",
    "line",
    "cell",
    "control",
    "implicit",
  ]),
  lang: Lang.default("unknown"),
});

export type Occurrence = z.infer<typeof Occurrence>;

export const NormalizedValue = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("date"),
    iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    figures: z.string().max(40).optional(),
  }),
  z.object({
    kind: z.literal("money"),
    amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
    currency: z.string().min(3).max(3),
    symbol: z.string().max(8).optional(),
  }),
  z.object({
    kind: z.literal("number"),
    value: z.string(),
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string(),
  }),
  z.object({
    kind: z.literal("boolean"),
    value: z.boolean(),
  }),
]);

export type NormalizedValue = z.infer<typeof NormalizedValue>;

export const Field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(120),
  question: z.string().max(240).optional(),
  questionFr: z.string().max(240).optional(),
  valueType: ValueType,
  group: FieldGroup,
  occurrences: z.array(Occurrence),
  context: z.string().max(400),
  required: z.boolean(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["marker", "ai", "condition"]),
  status: FieldStatus,
  rawValue: z.string().max(500).nullable(),
  displayValue: z.string().max(500).nullable(),
  normalized: NormalizedValue.nullable(),
  note: z.string().max(300).nullable(),
  related: z.array(z.string()).default([]),
});

export type Field = z.infer<typeof Field>;

export const Condition = z.object({
  fieldId: z.string(),
  op: z.enum(["is_true", "is_false", "equals", "in"]),
  values: z.array(z.string()).default([]),
});

export type Condition = z.infer<typeof Condition>;

export const StructureIssue = z.object({
  ruleId: z.string().nullable(),
  message: z.string(),
});

export type StructureIssue = z.infer<typeof StructureIssue>;
