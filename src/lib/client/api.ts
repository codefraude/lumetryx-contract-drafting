import { SseDecoder, type StreamEvent } from "../events";
import type { ChatLanguage } from "../fields/types";
import type { CompareResponse, DocumentView, DraftListItem, RuleAction } from "../server/service";

export type { CompareResponse, DocumentView, DraftListItem, RuleAction };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { code?: string; message?: string; retryable?: boolean } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  throw new ApiError(body.code ?? "http_" + res.status, body.message ?? `Request failed (${res.status}).`, res.status, body.retryable ?? res.status >= 500);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  current: () => fetch("/api/documents/current", { cache: "no-store" }).then((r) => parse<{ document: DocumentView | null }>(r)),
  get: (id: string) => fetch(`/api/documents/${id}`, { cache: "no-store" }).then((r) => parse<DocumentView>(r)),
  drafts: () => fetch("/api/drafts", { cache: "no-store" }).then((r) => parse<{ drafts: DraftListItem[] }>(r)),
  upload: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return fetch("/api/documents", { method: "POST", body: form }).then((r) => parse<DocumentView>(r));
  },
  correctField: (id: string, body: { fieldsVersion: number; fieldId: string; value?: string | null; required?: boolean }) => fetch(`/api/documents/${id}/fields`, jsonInit("PATCH", body)).then((r) => parse<DocumentView>(r)),
  rename: (id: string, title: string) => fetch(`/api/documents/${id}`, jsonInit("PATCH", { title })).then((r) => parse<DocumentView>(r)),
  setLanguage: (id: string, fieldsVersion: number, language: ChatLanguage | null) => fetch(`/api/documents/${id}`, jsonInit("PATCH", { fieldsVersion, language })).then((r) => parse<DocumentView>(r)),
  remove: (id: string) => fetch(`/api/documents/${id}`, { method: "DELETE" }).then((r) => parse<{ deleted: string }>(r)),
  rule: (id: string, body: { fieldsVersion: number; ruleId: string; action: RuleAction }) => fetch(`/api/documents/${id}/rules`, jsonInit("POST", body)).then((r) => parse<DocumentView>(r)),
  /** Compares with the given editor snapshot (not saved), or with the saved draft / answer preview when omitted. */
  compare: (id: string, snapshot: Blob | null) => fetch(`/api/documents/${id}/compare`, { method: "POST", body: snapshot ?? new Blob([]) }).then((r) => parse<CompareResponse>(r)),
  copy: (id: string, snapshot: Blob | null) => fetch(`/api/documents/${id}/copy`, { method: "POST", body: snapshot ?? new Blob([]) }).then((r) => parse<DocumentView>(r)),
  loadDocx: async (id: string, which: "working" | "original") => {
    const res = await fetch(`/api/documents/${id}/docx?which=${which}`, { cache: "no-store" });
    if (!res.ok) await parse(res);
    return { blob: await res.blob(), revision: Number(res.headers.get("X-Working-Revision") ?? 0) };
  },
  saveDocx: (id: string, rev: number, blob: Blob) => fetch(`/api/documents/${id}/docx?rev=${rev}`, { method: "PUT", body: blob }).then((r) => parse<{ workingRevision: number; savedAt: string }>(r)),
  /** Fetched rather than navigated to, so a failed export is reported in the page instead of replacing it. */
  download: async (id: string) => {
    const res = await fetch(`/api/documents/${id}/download`, { cache: "no-store" });
    if (!res.ok) await parse(res);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
    return { blob: await res.blob(), filename: encoded ? decodeURIComponent(encoded) : (plain ?? "draft.docx") };
  },
};

export async function streamEvents(url: string, body: Record<string, unknown>, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<string> {
  const requestId = crypto.randomUUID();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestId }), signal });
  if (!res.ok || !res.body) await parse(res);
  const reader = res.body!.getReader();
  const decoder = new SseDecoder();
  let lastSeq = -1;
  for (;;) {
    const { done, value } = await reader.read();
    const events = decoder.push(value ?? new Uint8Array(), done);
    for (const e of events) {
      if (e.requestId !== requestId || e.seq <= lastSeq) continue;
      lastSeq = e.seq;
      onEvent(e);
    }
    if (done) break;
  }
  return requestId;
}
