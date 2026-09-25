import { requestJson } from "@/lib/http";
import { CompareResponse } from "./contracts";

export const compareWithTemplate = (
  documentId: string,
  snapshot: Blob | null,
  signal?: AbortSignal,
) => {
  return requestJson(`/api/documents/${documentId}/compare`, CompareResponse, {
    method: "POST",
    body: snapshot ?? new Blob([]),
    signal,
  });
};
