import { z } from "zod";
import { ChatLanguage } from "./fields";
import { RuleAction } from "./document-view";

/**
 * Request bodies of the document API, validated by the route handlers and built by the browser.
 * Every write carries the `fieldsVersion` it was based on, so a stale write is refused, never merged.
 */

/** A correction from the Details panel: a value, the required flag or the label. */
export const FieldCorrection = z.object({
  fieldsVersion: z.number().int(),
  fieldId: z.string().max(64),
  value: z.string().max(500).nullable().optional(),
  required: z.boolean().optional(),
  label: z.string().min(1).max(120).optional(),
});
export type FieldCorrection = z.infer<typeof FieldCorrection>;

export const RuleActionRequest = z.object({ fieldsVersion: z.number().int(), ruleId: z.string().max(64), action: RuleAction });
export type RuleActionRequest = z.infer<typeof RuleActionRequest>;

export const RenameRequest = z.object({ title: z.string().trim().min(1).max(120) });

export const LanguageRequest = z.object({ language: ChatLanguage.nullable(), fieldsVersion: z.number().int() });

export const ChatRequest = z.object({ message: z.string().trim().min(1).max(2000), fieldsVersion: z.number().int(), requestId: z.string().uuid() });
export type ChatRequest = z.infer<typeof ChatRequest>;

export const DraftRequest = z.object({ fieldsVersion: z.number().int(), requestId: z.string().uuid() });
export type DraftRequest = z.infer<typeof DraftRequest>;
