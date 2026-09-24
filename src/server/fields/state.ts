import { z } from "zod";
import { ChatLanguage, Condition, DocLanguage, Field, Lang, StructureIssue } from "@/features/documents/contracts/fields";

/**
 * The persisted field state of a draft (the `documents.field_state` JSONB). Defaults backfill
 * records written before newer keys existed, so old drafts keep loading.
 */

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
