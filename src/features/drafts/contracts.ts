import { z } from "zod";
import { Phase } from "@/features/documents/contracts/document-view";
import { DocLanguage } from "@/features/documents/contracts/fields";

/** One row of the saved-drafts list (`GET /api/drafts`): metadata only, never document content. */
export const DraftListItem = z.object({
  id: z.string(),
  title: z.string(),
  filename: z.string(),
  savedAt: z.string(),
  expiresAt: z.string(),
  phase: Phase,
  outstanding: z.number().int(),
  /** Separate counts, so a clause decision is not also counted as the yes/no detail that settles it. */
  detailsLeft: z.number().int(),
  decisionsLeft: z.number().int(),
  language: DocLanguage,
});
export type DraftListItem = z.infer<typeof DraftListItem>;

export const DraftListResponse = z.object({ drafts: z.array(DraftListItem) });

export const DeletedResponse = z.object({ deleted: z.string() });
