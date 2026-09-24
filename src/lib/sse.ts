import type { z } from "zod";
import { apiError } from "./http";

/**
 * Incremental SSE decoder: tolerates frames and multi-byte UTF-8 characters split across network
 * chunks, and hands on only events that match the protocol schema (a malformed frame is dropped).
 */
export class SseDecoder<T> {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";
  constructor(private readonly schema: z.ZodType<T>) {}

  push(chunk: Uint8Array, final = false): T[] {
    this.buffer += this.decoder.decode(chunk, { stream: !final });
    const out: T[] = [];
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
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const parsed = this.schema.safeParse(json);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }
}

/**
 * POSTs `body` (with a fresh request id) and hands each event of the SSE response to `onEvent` as it
 * arrives, in order. Events of another request and repeated sequence numbers are dropped, so a
 * replayed or duplicated frame is never applied twice. Resolves when the stream ends.
 */
export async function postEventStream<T extends { requestId: string; seq: number }>(url: string, body: object, schema: z.ZodType<T>, onEvent: (event: T) => void, signal: AbortSignal): Promise<void> {
  const requestId = crypto.randomUUID();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestId }), signal });
  if (!res.ok || !res.body) throw await apiError(res);
  const reader = res.body.getReader();
  const decoder = new SseDecoder(schema);
  let lastSeq = -1;
  for (;;) {
    const { done, value } = await reader.read();
    for (const event of decoder.push(value ?? new Uint8Array(), done)) {
      if (event.requestId !== requestId || event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      onEvent(event);
    }
    if (done) return;
  }
}
