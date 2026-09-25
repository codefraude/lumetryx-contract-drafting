import { z } from "zod";
import {
  ChatLanguage,
  Condition,
  DocLanguage,
  Field,
  Lang,
  StructureIssue,
} from "@/features/documents/contracts/fields";

export const Rule = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(120),
  blockIds: z.array(z.string()).min(1),
  markerBlockIds: z.array(z.string()).default([]),
  condition: Condition,
  source: z.enum(["marker", "ai"]),
  confirmed: z.boolean(),
  dismissed: z.boolean().default(false),
  evidence: z.string().max(300).nullable().default(null),
  override: z.enum(["include", "exclude"]).nullable().default(null),
  applied: z.enum(["included", "excluded"]).nullable().default(null),
  paraIds: z.array(z.string()).default([]),
  slot: z
    .object({
      before: z.string().nullable(),
      after: z.string().nullable(),
    })
    .default({
      before: null,
      after: null,
    }),
  removedXml: z.string().nullable().default(null),
  contentHash: z.string().nullable().default(null),
});

export type Rule = z.infer<typeof Rule>;

export const DraftAnchor = z.object({
  blockId: z.string(),
  paraId: z.string().nullable().default(null),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  lang: Lang.default("unknown"),
  mode: z.enum(["replace", "insert"]).default("replace"),
});

export type DraftAnchor = z.infer<typeof DraftAnchor>;

export const FieldState = z.object({
  version: z.number().int().default(1),
  fields: z.array(Field),
  draftAnchors: z.record(z.string(), z.array(DraftAnchor)).default({}),
  rules: z.array(Rule).default([]),
  ruleIssues: z.array(z.string()).default([]),
  structureIssues: z.array(StructureIssue).default([]),
  pendingClauses: z.array(z.string()).default([]),
  references: z
    .array(
      z.object({
        paraId: z.string(),
        nth: z.number().int(),
        target: z.string(),
        written: z.string(),
      }),
    )
    .default([]),
  language: z
    .object({
      document: DocLanguage,
      en: z.number(),
      fr: z.number(),
    })
    .default({
      document: "unknown",
      en: 0,
      fr: 0,
    }),
  conversationLanguage: ChatLanguage.nullable().default(null),
});

export type FieldState = z.infer<typeof FieldState>;
