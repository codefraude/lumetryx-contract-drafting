import "server-only";
import type { EventPayload, StreamEvent } from "@/features/documents/contracts/stream-events";
import { errorBody, PRIVATE_HEADERS } from "./responses";

/** Encodes one SSE frame. JSON never contains raw newlines, so one `data:` line suffices. */
export const encodeEvent = (e: EventPayload & Pick<StreamEvent, "requestId" | "seq">) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

/**
 * Streams typed events as SSE, numbered in order and tagged with the request id. The request's
 * abort signal (client disconnect or Stop) is passed to the producer so upstream AI calls and
 * document work are cancelled; a failure becomes a final `error` event.
 */
export function sseResponse(req: Request, requestId: string, produce: (emit: (e: EventPayload) => void, signal: AbortSignal) => Promise<void>): Response {
  let seq = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: EventPayload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent({ ...e, requestId, seq: seq++ })));
      };
      try {
        await produce(emit, req.signal);
      } catch (err) {
        if (!req.signal.aborted) {
          const { code, message, retryable } = errorBody(err);
          emit({ type: "error", code, message, retryable });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by disconnect */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
