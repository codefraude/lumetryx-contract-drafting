import { requestJson } from "@/lib/http";
import { CompareResponse } from "./contracts";

/** Compares the template with the given editor snapshot (never saved), or with the saved draft or an answer preview when there is none. */
export const compareWithTemplate = (documentId: string, snapshot: Blob | null, signal?: AbortSignal) =>
  requestJson(`/api/documents/${documentId}/compare`, CompareResponse, { method: "POST", body: snapshot ?? new Blob([]), signal });
