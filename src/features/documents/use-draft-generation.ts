import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toFailure, type ActionFailure } from "@/lib/http";
import { streamDraftGeneration } from "./api";
import type { DraftBlock, StreamEvent } from "./contracts/stream-events";
import { documentKeys, fieldsVersionOf, patchDocument } from "./queries";

interface Options {
  /** The draft exists: the editor must open this revision. */
  onCompleted(revision: number): void;
  /** Generation failed; the reason is in `failure`. */
  onFailed(): void;
  announce(text: string): void;
}

/**
 * Draft generation for one open draft: the server fills the template and streams each block, so the
 * preview grows as it works. A stopped or failed generation never replaces the previous draft. When
 * the draft is closed mid-way, the server still finishes it; the events update only this draft's entry.
 */
export function useDraftGeneration(documentId: string, { onCompleted, onFailed, announce }: Options) {
  const queryClient = useQueryClient();
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function generate() {
    setBlocks([]);
    setFailure(null);
    setGenerating(true);
    announce("Generating the draft.");
    const ctrl = new AbortController();
    abort.current = ctrl;
    const fail = (f: ActionFailure) => {
      setFailure(f);
      onFailed();
    };
    const onEvent = (e: StreamEvent) => {
      if (e.type === "draft_block_ready") setBlocks((b) => [...b, e.block]);
      if (e.type === "draft_complete") {
        patchDocument(queryClient, documentId, (d) => ({
          ...d,
          draftStatus: "ready",
          phase: "draft",
          draftStale: false,
          workingRevision: e.workingRevision,
          fieldsVersion: e.fieldsVersion,
        }));
        onCompleted(e.workingRevision);
        announce("The draft is ready to edit.");
      }
      if (e.type === "error") fail({ message: e.message, retryable: e.retryable });
    };
    try {
      await streamDraftGeneration(documentId, fieldsVersionOf(queryClient, documentId), onEvent, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) fail(toFailure(e));
    } finally {
      abort.current = null;
      setGenerating(false);
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
    }
  }

  return { blocks, generating, failure, generate, stop: () => abort.current?.abort(), clearFailure: () => setFailure(null) };
}
