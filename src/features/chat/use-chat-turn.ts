import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { DocumentMessage } from "@/features/documents/contracts/document-view";
import type { ChatLanguage } from "@/features/documents/contracts/fields";
import type { StreamEvent } from "@/features/documents/contracts/stream-events";
import { documentKeys, fieldsVersionOf, patchDocument, storeDocument } from "@/features/documents/queries";
import { toFailure, type ActionFailure } from "@/lib/http";
import { setConversationLanguage, streamChatTurn } from "./api";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  streaming?: boolean;
  /** How many details this turn validated and saved; shown under the reply. */
  updated?: number;
}

/** A failed turn, with the message to send again when retrying can help. */
export type TurnFailure = ActionFailure & { resend?: string };

interface Options {
  /** Saves pending editor edits before the server may change the draft; rejects when that fails. */
  beforeSend(): Promise<void>;
  /** The server changed the saved draft: the editor must load that revision. */
  onDraftReplaced(revision: number): void;
  announce(text: string): void;
}

const fromServer = (messages: DocumentMessage[]): ChatMessage[] => messages.map((m) => ({ id: m.id, role: m.role, content: m.content }));

/** What an answer changed in a draft that already exists, in the lawyer's words. */
function patchNotices(e: Extract<StreamEvent, { type: "draft_patch" }>): string[] {
  const notes: string[] = [];
  if (e.conflicts.length) notes.push(`You edited the text where ${e.conflicts.length === 1 ? "this answer" : "these answers"} appeared (${e.conflicts.join(", ")}), so your edit was kept and the draft was not changed there. Update it in the editor, or regenerate the draft from the template (this discards manual edits).`);
  for (const c of e.clauseChanges) notes.push(`Clause ${c.action === "exclude" ? "removed" : "restored"}: “${c.label}” (${c.reason}).`);
  for (const c of e.needsConfirmation) notes.push(`“${c.label}” should now be ${c.action === "exclude" ? "removed" : "included"}, but you edited it. Confirm it under Clauses.`);
  return notes;
}

/**
 * The conversation of one open draft. The list starts from the persisted conversation and is owned
 * here afterwards (the streamed reply, notices). Validated changes go into the draft's cached view
 * as they arrive, and the view is re-read once the turn ends. A reply still streaming when the draft
 * is closed finishes on the server as usual; its events reach only this draft's cache entry and this
 * (discarded) state, never the draft opened meanwhile.
 */
export function useChatTurn(documentId: string, initial: DocumentMessage[], { beforeSend, onDraftReplaced, announce }: Options) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState(() => fromServer(initial));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TurnFailure | null>(null);
  const abort = useRef<AbortController | null>(null);

  const update = (id: string, change: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));

  /** `retry` sends a failed message again without adding it to the conversation twice. Resolves false when nothing was sent. */
  async function send(text: string, retry = false): Promise<boolean> {
    setFailure(null);
    try {
      await beforeSend();
    } catch {
      setFailure({ message: "Your latest edit could not be saved, so the message was not sent. It is back in the box below; send it again once saving works.", retryable: false });
      return false;
    }
    const replyId = `a-${Date.now()}`;
    setMessages((all) => [...all, ...(retry ? [] : [{ id: `u-${Date.now()}`, role: "user" as const, content: text }]), { id: replyId, role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let finished = false;
    const onEvent = (e: StreamEvent) => {
      switch (e.type) {
        case "fields_updated":
          patchDocument(queryClient, documentId, (d) => ({ ...d, fields: e.fields, fieldsVersion: e.fieldsVersion, draftStale: d.draftStatus === "ready" }));
          if (e.changed.length) update(replyId, (m) => ({ ...m, updated: e.changed.length }));
          break;
        case "assistant_delta":
          update(replyId, (m) => ({ ...m, content: m.content + e.text }));
          break;
        case "assistant_done":
          finished = true;
          update(replyId, (m) => ({ ...m, content: e.text, streaming: false }));
          announce(`Assistant replied: ${e.text.slice(0, 400)}`);
          break;
        case "draft_patch": {
          patchDocument(queryClient, documentId, (d) => ({ ...d, workingRevision: e.workingRevision }));
          if (e.applied.length || e.clauseChanges.length) onDraftReplaced(e.workingRevision);
          const notes = patchNotices(e);
          if (notes.length) setMessages((all) => [...all, ...notes.map((content, i) => ({ id: `n-${Date.now()}-${i}`, role: "notice" as const, content }))]);
          break;
        }
        case "error":
          setFailure({ message: e.message, retryable: e.retryable, resend: text });
          break;
      }
    };
    try {
      await streamChatTurn(documentId, text, fieldsVersionOf(queryClient, documentId), onEvent, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) setFailure({ ...toFailure(e), resend: text });
    } finally {
      abort.current = null;
      setBusy(false);
      setMessages((all) => all.map((m) => (m.id === replyId ? { ...m, streaming: false, content: m.content || (finished ? m.content : ctrl.signal.aborted ? "(stopped)" : "") } : m)).filter((m) => m.role !== "assistant" || m.content));
      // Server-derived parts of the view (rules, inactive fields, issues) follow the turn.
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    }
    return true;
  }

  const language = useMutation({
    mutationFn: (value: ChatLanguage | null) => setConversationLanguage(documentId, fieldsVersionOf(queryClient, documentId), value),
    onSuccess: (view) => {
      storeDocument(queryClient, view);
      // The server posted a confirmation in the new language; the conversation is the persisted one again.
      setMessages(fromServer(view.messages));
    },
    onError: (e) => setFailure(toFailure(e)),
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
