import { DocumentView } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import { StreamEvent } from "@/features/documents/contracts/stream-events";
import { jsonBody, requestJson } from "@/lib/http";
import { postEventStream } from "@/lib/sse";

/** One chat turn: validated field updates, the streamed reply, and any change to an existing draft. */
export const streamChatTurn = (documentId: string, message: string, fieldsVersion: number, onEvent: (e: StreamEvent) => void, signal: AbortSignal) =>
  postEventStream(`/api/documents/${documentId}/chat`, { message, fieldsVersion }, StreamEvent, onEvent, signal);

/** The conversation language (null follows the language the user writes in). */
export const setConversationLanguage = (documentId: string, fieldsVersion: number, language: ChatLanguage | null) => requestJson(`/api/documents/${documentId}`, DocumentView, jsonBody("PATCH", { fieldsVersion, language }));
