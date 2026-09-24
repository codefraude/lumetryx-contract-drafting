import { DocumentView } from "@/features/documents/contracts/document-view";
import { jsonBody, requestJson } from "@/lib/http";
import { DeletedResponse, DraftListResponse } from "./contracts";

export const fetchDrafts = (signal?: AbortSignal) => requestJson("/api/drafts", DraftListResponse, { signal }).then((r) => r.drafts);

export const renameDraft = (id: string, title: string) => requestJson(`/api/documents/${id}`, DocumentView, jsonBody("PATCH", { title }));

export const deleteDraft = (id: string) => requestJson(`/api/documents/${id}`, DeletedResponse, { method: "DELETE" });
