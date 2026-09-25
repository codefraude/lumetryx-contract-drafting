import { z } from "zod";

export const DIFF_SCHEMA_VERSION = 1;

export const Segment = z.object({
  op: z.enum(["eq", "ins", "del"]),
  text: z.string(),
});

export type Segment = z.infer<typeof Segment>;

export const DiffItem = z.object({
  id: z.string(),
  type: z.enum([
    "modified",
    "added",
    "deleted",
    "clause_excluded",
    "clause_included",
    "markers_removed",
  ]),
  location: z.string(),
  segments: z.array(Segment),
  notes: z.array(z.string()),
});

export type DiffItem = z.infer<typeof DiffItem>;

export const DiffResult = z.object({
  version: z.number().int(),
  items: z.array(DiffItem),
  counts: z.object({
    modified: z.number(),
    added: z.number(),
    deleted: z.number(),
    filled: z.number(),
    clauses: z.number(),
  }),
});

export type DiffResult = z.infer<typeof DiffResult>;

export const CompareResponse = z.object({
  source: z.enum(["editor", "working", "preview"]),
  result: DiffResult,
});

export type CompareResponse = z.infer<typeof CompareResponse>;
