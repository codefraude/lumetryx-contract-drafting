import { z } from "zod";
import { Field } from "./fields/types";

const RunSpan = z.object({ text: z.string(), bold: z.boolean(), italic: z.boolean(), underline: z.boolean() });

export const DraftBlock = z.object({
  id: z.string(),
  partKind: z.enum(["body", "header", "footer"]),
  kind: z.enum(["heading", "paragraph", "listItem", "tableCell"]),
  headingLevel: z.number().nullable(),
  numberLabel: z.string().nullable(),
  indentLevel: z.number(),
  table: z.object({ table: z.number(), row: z.number(), col: z.number() }).nullable(),
  runs: z.array(RunSpan),
  filled: z.boolean(),
});
export type DraftBlock = z.infer<typeof DraftBlock>;

const base = { requestId: z.string(), seq: z.number().int().nonnegative() };

export const ClauseChange = z.object({ ruleId: z.string(), label: z.string(), action: z.enum(["exclude", "include"]), reason: z.string() });

export const StreamEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("fields_updated"), fields: z.array(Field), fieldsVersion: z.number(), changed: z.array(z.string()) }),
  z.object({ ...base, type: z.literal("assistant_delta"), text: z.string() }),
  z.object({ ...base, type: z.literal("assistant_done"), text: z.string() }),
  z.object({
    ...base,
    type: z.literal("draft_patch"),
    workingRevision: z.number(),
    applied: z.array(z.string()),
    conflicts: z.array(z.string()),
    clauseChanges: z.array(ClauseChange).default([]),
    needsConfirmation: z.array(ClauseChange).default([]),
  }),
  z.object({ ...base, type: z.literal("draft_started"), fieldsVersion: z.number() }),
  z.object({ ...base, type: z.literal("draft_block_ready"), block: DraftBlock }),
  z.object({ ...base, type: z.literal("draft_complete"), workingRevision: z.number(), fieldsVersion: z.number() }),
  z.object({ ...base, type: z.literal("error"), code: z.string(), message: z.string(), retryable: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventPayload = DistributiveOmit<StreamEvent, "requestId" | "seq">;

/** Encodes one SSE frame. JSON never contains raw newlines, so one `data:` line suffices. */
export const encodeEvent = (e: StreamEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

/**
 * Incremental SSE decoder: tolerates frames and multi-byte UTF-8 characters split across
 * network chunks, and validates every event before handing it to the UI.
 */
export class SseDecoder {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";
  push(chunk: Uint8Array, final = false): StreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: !final });
    const out: StreamEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const parsed = StreamEvent.safeParse(JSON.parse(data));
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }
}
