import { DocumentView } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import { StreamEvent } from "@/features/documents/contracts/stream-events";
import { jsonBody, requestJson } from "@/lib/http";
import { postEventStream } from "@/lib/sse";

export const streamChatTurn = (
  documentId: string,
  message: string,
  fieldsVersion: number,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) => {
  return postEventStream(
    `/api/documents/${documentId}/chat`,
    {
      message,
      fieldsVersion,
    },
    StreamEvent,
    onEvent,
    signal,
  );
};

export const setConversationLanguage = (
  documentId: string,
  fieldsVersion: number,
  language: ChatLanguage | null,
) => {
  return requestJson(
    `/api/documents/${documentId}`,
    DocumentView,
    jsonBody("PATCH", {
      fieldsVersion,
      language,
    }),
  );
};
