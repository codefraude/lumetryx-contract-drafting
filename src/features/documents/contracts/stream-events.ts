import { z } from "zod";
import { Field } from "@/features/documents/contracts/fields";

const RunSpan = z.object({
  text: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
});

export const DraftBlock = z.object({
  id: z.string(),
  partKind: z.enum(["body", "header", "footer"]),
  kind: z.enum(["heading", "paragraph", "listItem", "tableCell"]),
  headingLevel: z.number().nullable(),
  numberLabel: z.string().nullable(),
  indentLevel: z.number(),
  table: z
    .object({
      table: z.number(),
      row: z.number(),
      col: z.number(),
    })
    .nullable(),
  runs: z.array(RunSpan),
  filled: z.boolean(),
});

export type DraftBlock = z.infer<typeof DraftBlock>;

const base = {
  requestId: z.string(),
  seq: z.number().int().nonnegative(),
};

export const ClauseChange = z.object({
  ruleId: z.string(),
  label: z.string(),
  action: z.enum(["exclude", "include"]),
  reason: z.string(),
});

export type ClauseChange = z.infer<typeof ClauseChange>;

export const StreamEvent = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("fields_updated"),
    fields: z.array(Field),
    fieldsVersion: z.number(),
    changed: z.array(z.string()),
  }),
  z.object({
    ...base,
    type: z.literal("assistant_delta"),
    text: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("assistant_done"),
    text: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("draft_patch"),
    workingRevision: z.number(),
    applied: z.array(z.string()),
    conflicts: z.array(z.string()),
    clauseChanges: z.array(ClauseChange).default([]),
    needsConfirmation: z.array(ClauseChange).default([]),
  }),
  z.object({
    ...base,
    type: z.literal("draft_started"),
    fieldsVersion: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal("draft_block_ready"),
    block: DraftBlock,
  }),
  z.object({
    ...base,
    type: z.literal("draft_complete"),
    workingRevision: z.number(),
    fieldsVersion: z.number(),
  }),
  z.object({
    ...base,
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);

export type StreamEvent = z.infer<typeof StreamEvent>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type EventPayload = DistributiveOmit<StreamEvent, "requestId" | "seq">;
