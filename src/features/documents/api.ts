import { jsonBody, requestBlob, requestJson } from "@/lib/http";
import { postEventStream } from "@/lib/sse";
import { CurrentDocumentResponse, DocumentView, SavedRevision } from "./contracts/document-view";
import type { FieldCorrection, RuleActionRequest } from "./contracts/requests";
import { StreamEvent } from "./contracts/stream-events";

/** Browser functions for a draft's endpoints. Every response is validated against its contract. */

export const fetchCurrentDocument = (signal?: AbortSignal) => requestJson("/api/documents/current", CurrentDocumentResponse, { signal }).then((r) => r.document);

export const fetchDocument = (id: string, signal?: AbortSignal) => requestJson(`/api/documents/${id}`, DocumentView, { signal });

export function uploadTemplate(file: File) {
  const form = new FormData();
  form.set("file", file);
  return requestJson("/api/documents", DocumentView, { method: "POST", body: form });
}

export const correctField = (id: string, body: FieldCorrection) => requestJson(`/api/documents/${id}/fields`, DocumentView, jsonBody("PATCH", body));

export const applyRuleAction = (id: string, body: RuleActionRequest) => requestJson(`/api/documents/${id}/rules`, DocumentView, jsonBody("POST", body));

/** Saves a separate copy, with the editor's current content when given (keeps local edits after a conflict). */
export const copyDocument = (id: string, snapshot: Blob | null) => requestJson(`/api/documents/${id}/copy`, DocumentView, { method: "POST", body: snapshot ?? new Blob([]) });

export async function loadDocx(id: string, which: "working" | "original") {
  const { blob, headers } = await requestBlob(`/api/documents/${id}/docx?which=${which}`);
  return { blob, revision: Number(headers.get("X-Working-Revision") ?? 0) };
}

export const saveDocx = (id: string, revision: number, blob: Blob) => requestJson(`/api/documents/${id}/docx?rev=${revision}`, SavedRevision, { method: "PUT", body: blob });

/** Fetched rather than navigated to, so a failed export is reported in the page instead of replacing it. */
export async function downloadDocx(id: string) {
  const { blob, headers } = await requestBlob(`/api/documents/${id}/download`);
  const disposition = headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return { blob, filename: encoded ? decodeURIComponent(encoded) : (plain ?? "draft.docx") };
}

/** Streams the draft as the server fills the template. */
export const streamDraftGeneration = (id: string, fieldsVersion: number, onEvent: (e: StreamEvent) => void, signal: AbortSignal) => postEventStream(`/api/documents/${id}/draft`, { fieldsVersion }, StreamEvent, onEvent, signal);
