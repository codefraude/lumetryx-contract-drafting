import "server-only";
import { AiError, classifyAiError } from "@/server/ai/model";
import { BusyError, ProtectionUnavailableError, RateLimitedError } from "@/server/cache/redis";
import { StaleRevisionError } from "@/server/db/repo";
import { DocxValidationError } from "@/server/docx/package";
import { ConfigMissingError } from "@/server/env";
import { ForbiddenOriginError, UnauthorizedError } from "@/server/session";

/** Responses of the API: private, never cached, with errors as `{ code, message, retryable }`. */

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;

export class NotFound extends Error {
  override name = "NotFound";
}

export interface ErrorBody {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

export function errorBody(err: unknown): ErrorBody {
  if (err instanceof DocxValidationError) return { status: 422, code: err.code, message: err.message, retryable: false };
  if (err instanceof UnauthorizedError) return { status: 401, code: "unauthorized", message: err.message, retryable: false };
  if (err instanceof ForbiddenOriginError) return { status: 403, code: "forbidden", message: err.message, retryable: false };
  if (err instanceof StaleRevisionError) return { status: 409, code: "stale", message: err.message, retryable: false };
  if (err instanceof BusyError) return { status: 409, code: "busy", message: err.message, retryable: true };
  if (err instanceof RateLimitedError) return { status: 429, code: "rate_limited", message: err.message, retryable: true };
  if (err instanceof ConfigMissingError) return { status: 503, code: "not_configured", message: err.message, retryable: false };
  if (err instanceof AiError) return { status: err.code === "budget" ? 429 : 502, code: err.code, message: err.message, retryable: err.retryable };
  if (err instanceof ProtectionUnavailableError) return { status: 503, code: "protection_unavailable", message: err.message, retryable: true };
  if (err instanceof NotFound) return { status: 404, code: "not_found", message: "Document not found.", retryable: false };
  // Database drivers report connection problems with their own error types; their messages are the common ground.
  if (err instanceof Error && /DATABASE|ECONNREFUSED|connect|terminat/i.test(err.message)) {
    console.error("[db]", err.message);
    return {
      status: 503,
      code: "storage_unavailable",
      message: "Storage is temporarily unavailable. Your latest unsaved changes are still in this browser tab; retry shortly.",
      retryable: true,
    };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The document id of an `/api/documents/[id]/…` route. Anything that is not a UUID is simply not found. */
export async function documentIdParam(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!UUID.test(id)) throw new NotFound();
  return id;
}
