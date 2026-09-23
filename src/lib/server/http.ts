import "server-only";
import { BusyError, RateLimitedError } from "../cache/redis";
import { StaleRevisionError } from "../db/repo";
import { DocxValidationError } from "../docx/package";
import { encodeEvent, type EventPayload, type StreamEvent } from "../events";
import { AiError, classifyAiError } from "../ai/model";
import { ConfigMissingError } from "./env";
import { ForbiddenOriginError, UnauthorizedError } from "./session";

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;

export function errorBody(err: unknown): { status: number; code: string; message: string; retryable: boolean } {
  if (err instanceof DocxValidationError) return { status: 422, code: err.code, message: err.message, retryable: false };
  if (err instanceof UnauthorizedError) return { status: 401, code: "unauthorized", message: err.message, retryable: false };
  if (err instanceof ForbiddenOriginError) return { status: 403, code: "forbidden", message: err.message, retryable: false };
  if (err instanceof StaleRevisionError) return { status: 409, code: "stale", message: err.message, retryable: false };
  if (err instanceof BusyError) return { status: 409, code: "busy", message: err.message, retryable: true };
  if (err instanceof RateLimitedError) return { status: 429, code: "rate_limited", message: err.message, retryable: true };
  if (err instanceof ConfigMissingError) return { status: 503, code: "not_configured", message: err.message, retryable: false };
  if (err instanceof AiError) return { status: err.code === "budget" ? 429 : 502, code: err.code, message: err.message, retryable: err.retryable };
  if (err instanceof Error && /Abuse protection|deduplication/.test(err.message)) return { status: 503, code: "protection_unavailable", message: err.message, retryable: true };
  if (err instanceof Error && err.name === "NotFound") return { status: 404, code: "not_found", message: "Document not found.", retryable: false };
  if (err instanceof Error && /DATABASE|ECONNREFUSED|connect|terminat/i.test(err.message)) {
    console.error("[db]", err.message);
    return { status: 503, code: "storage_unavailable", message: "Storage is temporarily unavailable. Your latest unsaved changes are still in this browser tab; retry shortly.", retryable: true };
  }
  const ai = classifyAiError(err);
  if (ai.code !== "provider") return errorBody(ai);
  console.error("[unhandled]", err);
  return { status: 500, code: "internal", message: "Something went wrong. Please retry.", retryable: true };
}

export function jsonError(err: unknown): Response {
  const { status, ...body } = errorBody(err);
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: PRIVATE_HEADERS });

export class NotFound extends Error {
  override name = "NotFound";
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Streams typed events as SSE. The request's abort signal (client disconnect or Stop)
 * is passed to the producer so upstream AI calls and document work are cancelled.
 */
export function sseResponse(req: Request, requestId: string, produce: (emit: (e: EventPayload) => void, signal: AbortSignal) => Promise<void>): Response {
  let seq = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: EventPayload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeEvent({ ...e, requestId, seq: seq++ } as StreamEvent)));
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
