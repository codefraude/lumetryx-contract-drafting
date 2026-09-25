import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { DocumentMessage } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import type { StreamEvent } from "@/features/documents/contracts/stream-events";
import {
  documentKeys,
  fieldsVersionOf,
  patchDocument,
  storeDocument,
} from "@/features/documents/queries";
import { useErrorText } from "@/i18n/error-text";
import { ApiError, toFailure, type ActionFailure } from "@/lib/http";
import { setConversationLanguage, streamChatTurn } from "./api";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  streaming?: boolean;
  updated?: number;
}

export type TurnFailure = ActionFailure & { resend?: string };

export type ChatTranslator = ReturnType<typeof useTranslations<"chat">>;

interface Options {
  beforeSend(): Promise<void>;
  onDraftReplaced(revision: number): void;
  announce(text: string): void;
}

const fromServer = (messages: DocumentMessage[]): ChatMessage[] => {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));
};

function patchNotices(
  t: ChatTranslator,
  e: Extract<StreamEvent, { type: "draft_patch" }>,
): string[] {
  const notes: string[] = [];

  if (e.conflicts.length) {
    notes.push(
      t("conflictNotice", {
        count: e.conflicts.length,
        answers: e.conflicts.join(", "),
      }),
    );
  }

  for (const c of e.clauseChanges) {
    notes.push(
      t("clauseChanged", {
        action: c.action,
        label: c.label,
        reason: c.reason,
      }),
    );
  }

  for (const c of e.needsConfirmation) {
    notes.push(
      t("clauseNeedsConfirmation", {
        action: c.action,
        label: c.label,
      }),
    );
  }

  return notes;
}

export function useChatTurn(
  documentId: string,
  initial: DocumentMessage[],
  { beforeSend, onDraftReplaced, announce }: Options,
) {
  const t = useTranslations("chat");
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState(() => fromServer(initial));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TurnFailure | null>(null);
  const abort = useRef<AbortController | null>(null);

  const update = (id: string, change: (m: ChatMessage) => ChatMessage) => {
    setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));
  };

  async function send(text: string, retry = false): Promise<boolean> {
    setFailure(null);

    try {
      await beforeSend();
    } catch {
      setFailure({
        message: t("sendNotSaved"),
        retryable: false,
      });

      return false;
    }

    const replyId = `a-${Date.now()}`;

    setMessages((all) => [
      ...all,
      ...(retry
        ? []
        : [
            {
              id: `u-${Date.now()}`,
              role: "user" as const,
              content: text,
            },
          ]),
      {
        id: replyId,
        role: "assistant",
        content: "",
        streaming: true,
      },
    ]);

    setBusy(true);
    const ctrl = new AbortController();

    abort.current = ctrl;
    let finished = false;

    const onEvent = (e: StreamEvent) => {
      switch (e.type) {
        case "fields_updated":
          patchDocument(queryClient, documentId, (d) =>
            e.fieldsVersion < d.fieldsVersion
              ? d
              : {
                  ...d,
                  fields: e.fields,
                  fieldsVersion: e.fieldsVersion,
                  draftStale: d.draftStatus === "ready",
                },
          );

          if (e.changed.length) {
            update(replyId, (m) => ({
              ...m,
              updated: e.changed.length,
            }));
          }

          break;
        case "assistant_delta":
          update(replyId, (m) => ({
            ...m,
            content: m.content + e.text,
          }));

          break;
        case "assistant_done":
          finished = true;

          update(replyId, (m) => ({
            ...m,
            content: e.text,
            streaming: false,
          }));

          announce(t("replied", { text: e.text.slice(0, 400) }));
          break;
        case "draft_patch": {
          patchDocument(queryClient, documentId, (d) => ({
            ...d,
            workingRevision: e.workingRevision,
          }));

          if (e.applied.length || e.clauseChanges.length) {
            onDraftReplaced(e.workingRevision);
          }

          const notes = patchNotices(t, e);

          if (notes.length) {
            setMessages((all) => [
              ...all,
              ...notes.map((content, i) => ({
                id: `n-${Date.now()}-${i}`,
                role: "notice" as const,
                content,
              })),
            ]);
          }

          break;
        }
        case "error":
          setFailure({
            message: errorText(
              new ApiError(e.code, e.message, 200, e.retryable),
            ),
            retryable: e.retryable,
            resend: text,
          });

          break;
      }
    };

    try {
      await streamChatTurn(
        documentId,
        text,
        fieldsVersionOf(queryClient, documentId),
        onEvent,
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setFailure({
          ...toFailure(e, errorText(e)),
          resend: text,
        });
      }
    } finally {
      abort.current = null;
      setBusy(false);

      setMessages((all) =>
        all
          .map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content ||
                    (finished
                      ? m.content
                      : ctrl.signal.aborted
                        ? t("stopped")
                        : ""),
                }
              : m,
          )
          .filter((m) => m.role !== "assistant" || m.content),
      );

      void queryClient.invalidateQueries({
        queryKey: documentKeys.detail(documentId),
      });
    }

    return true;
  }

  const language = useMutation({
    mutationFn: (value: ChatLanguage | null) =>
      setConversationLanguage(
        documentId,
        fieldsVersionOf(queryClient, documentId),
        value,
      ),
    onSuccess: (view) => {
      storeDocument(queryClient, view);
      setMessages(fromServer(view.messages));
    },
    onError: (e) => setFailure(toFailure(e, errorText(e))),
  });

  return {
    messages,
    busy,
    failure,
    send,
    stop: () => abort.current?.abort(),
    clearFailure: () => setFailure(null),
    retry: () => void (failure?.resend && send(failure.resend, true)),
    setLanguage: (value: ChatLanguage | null) => language.mutate(value),
  };
}
