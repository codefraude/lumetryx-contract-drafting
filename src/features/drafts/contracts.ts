import { z } from "zod";
import { Phase } from "@/features/documents/contracts/document-view";
import { DocLanguage } from "@/features/documents/contracts/fields";

export const DraftListItem = z.object({
  id: z.string(),
  title: z.string(),
  filename: z.string(),
  savedAt: z.string(),
  expiresAt: z.string(),
  phase: Phase,
  outstanding: z.number().int(),
  detailsLeft: z.number().int(),
  decisionsLeft: z.number().int(),
  language: DocLanguage,
});

export type DraftListItem = z.infer<typeof DraftListItem>;

export const DraftListResponse = z.object({ drafts: z.array(DraftListItem) });

export const DeletedResponse = z.object({ deleted: z.string() });
