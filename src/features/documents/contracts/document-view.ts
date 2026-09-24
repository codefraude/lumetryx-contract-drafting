import { z } from "zod";
import { ChatLanguage, Condition, DocLanguage, Field, StructureIssue } from "./fields";

/**
 * What the server sends the browser about one draft (`GET /api/documents/:id` and every write
 * that returns it). The server builds it from the persisted state; the browser validates it.
 */

/** How a conditional clause stands. "unresolved" (an answer is missing) is never treated as "no". */
export const ClauseState = z.enum(["included", "excluded", "unresolved", "proposed", "dismissed"]);
export type ClauseState = z.infer<typeof ClauseState>;

export const RuleAction = z.enum(["confirm", "dismiss", "include", "exclude", "clear_override", "apply"]);
export type RuleAction = z.infer<typeof RuleAction>;

export const RuleView = z.object({
  id: z.string(),
  label: z.string(),
  source: z.enum(["marker", "ai"]),
  condition: Condition,
  confirmed: z.boolean(),
  dismissed: z.boolean(),
  override: z.enum(["include", "exclude"]).nullable(),
  evidence: z.string().nullable(),
  state: ClauseState,
  reason: z.string(),
  /** What the working draft contains (null before a draft exists). */
  applied: z.enum(["included", "excluded"]).nullable(),
  /** The draft differs from what the condition calls for and waits for confirmation (the clause was edited by hand). */
  pending: z.boolean(),
  /** Excluded text the user edited, kept so re-including the clause restores it. */
  hasEditedVariant: z.boolean(),
});
export type RuleView = z.infer<typeof RuleView>;

export const Phase = z.enum(["interview", "ready", "generating", "interrupted", "draft"]);
export type Phase = z.infer<typeof Phase>;

export const DocumentMessage = z.object({ id: z.string(), role: z.enum(["user", "assistant"]), content: z.string() });
export type DocumentMessage = z.infer<typeof DocumentMessage>;

export const DocumentView = z.object({
  id: z.string(),
  filename: z.string(),
  title: z.string(),
  fields: z.array(Field),
  fieldsVersion: z.number().int(),
  workingRevision: z.number().int(),
  draftStatus: z.enum(["none", "generating", "ready"]),
  /** The answers changed after the draft was made. */
  draftStale: z.boolean(),
  phase: Phase,
  analysis: z.enum(["ai", "markers_only"]),
  savedAt: z.string(),
  expiresAt: z.string(),
  language: z.object({ document: DocLanguage, conversation: ChatLanguage.nullable(), effective: ChatLanguage }),
  rules: z.array(RuleView),
  ruleIssues: z.array(z.string()),
  structureIssues: z.array(StructureIssue),
  inactiveFieldIds: z.array(z.string()),
  messages: z.array(DocumentMessage),
});
export type DocumentView = z.infer<typeof DocumentView>;

export const CurrentDocumentResponse = z.object({ document: DocumentView.nullable() });

export const SavedRevision = z.object({ workingRevision: z.number().int(), savedAt: z.string() });
export type SavedRevision = z.infer<typeof SavedRevision>;
