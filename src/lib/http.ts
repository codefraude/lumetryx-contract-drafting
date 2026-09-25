import { z } from "zod";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /** The server said the failure is temporary (or it was a server error). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const errorMessage = (error: unknown, fallback = "Something went wrong."): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** Worth retrying: the network failed, or the server said so. Validation, authorization and revision conflicts never are. */
export const isTransient = (error: unknown): boolean => (error instanceof ApiError ? error.retryable : error instanceof TypeError);

const ErrorBody = z.object({ code: z.string().optional(), message: z.string().optional(), retryable: z.boolean().optional() });

/** Uses the server's error body when there is one; without it, any 5xx counts as retryable. */
export async function apiError(res: Response): Promise<ApiError> {
  const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
  const body = parsed.success ? parsed.data : {};
  return new ApiError(body.code ?? `http_${res.status}`, body.message ?? `Request failed (${res.status}).`, res.status, body.retryable ?? res.status >= 500);
}

export async function requestJson<S extends z.ZodType>(url: string, schema: S, init: RequestInit = {}): Promise<z.output<S>> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw await apiError(res);
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success)
    throw new ApiError("invalid_response", "The server sent a response this page cannot read. Reload the page and try again.", res.status, false);
  return parsed.data;
}

export async function requestBlob(url: string, init: RequestInit = {}): Promise<{ blob: Blob; headers: Headers }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw await apiError(res);
  return { blob: await res.blob(), headers: res.headers };
}

export const jsonBody = (method: "POST" | "PATCH" | "PUT", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface ActionFailure {
  message: string;
  retryable: boolean;
}

export const toFailure = (error: unknown): ActionFailure => ({ message: errorMessage(error), retryable: error instanceof ApiError ? error.retryable : true });
