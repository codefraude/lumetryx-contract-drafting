"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { uploadTemplate } from "@/features/documents/api";
import { UploadPanel } from "@/features/documents/components/UploadPanel";
import type { DocumentView } from "@/features/documents/contracts/document-view";
import { currentDocumentQuery, documentKeys, documentQuery, storeDocument } from "@/features/documents/queries";
import { DraftsDrawer } from "@/features/drafts/components/DraftsDrawer";
import { draftKeys } from "@/features/drafts/queries";
import { errorMessage } from "@/lib/http";
import { BrandMark } from "@/shared/ui/BrandMark";
import { useSessionLoss } from "../use-session-loss";
import { DocumentWorkspace, type DocumentWorkspaceHandle } from "./DocumentWorkspace";

/** The draft on screen. A new `generation` shows it afresh (reopened or reloaded), resetting its workspace. */
interface OpenDraft {
  id: string;
  generation: number;
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <p role="status" className="lx-fade flex items-center gap-3 text-sm text-ink-2">
        <BrandMark />
        Opening your workspace…
      </p>
    </div>
  );
}

/** The page: the upload screen or one open draft, and the saved-drafts drawer over either. */
export function Workspace({ maxUploadMb }: { maxUploadMb: number }) {
  const queryClient = useQueryClient();
  const latest = useQuery(currentDocumentQuery(queryClient));
  // Until the person picks something (undefined), the browser's latest draft is shown; null is the upload screen.
  const [open, setOpen] = useState<OpenDraft | null>();
  const active = open === undefined ? (latest.data ? { id: latest.data, generation: 0 } : null) : open;
  const view = useQuery({ ...documentQuery(active?.id ?? ""), enabled: active !== null });
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const workspace = useRef<DocumentWorkspaceHandle>(null);

  const show = (doc: DocumentView) => {
    storeDocument(queryClient, doc);
    setOpen((o) => ({ id: doc.id, generation: (o?.generation ?? 0) + 1 }));
  };

  const upload = useMutation({
    mutationFn: uploadTemplate,
    onMutate: () => setUploadError(null),
    onSuccess: (doc) => {
      // An upload may start a new browser session, whose drafts list is not the one cached.
      queryClient.removeQueries({ queryKey: draftKeys.list });
      show(doc);
    },
    onError: (e) => setUploadError(errorMessage(e)),
  });

  // The server no longer knows this browser: nothing cached for the old session may be shown again.
  useSessionLoss((message) => {
    setOpen(null);
    setUploadError(message);
    queryClient.removeQueries({ queryKey: documentKeys.all });
    queryClient.removeQueries({ queryKey: draftKeys.list });
  });

  const openDraft = async (id: string) => {
    if (id === active?.id) return setDraftsOpen(false);
    if (!(await (workspace.current?.leave() ?? true))) return;
    show(await queryClient.fetchQuery({ ...documentQuery(id), staleTime: 0 }));
    setDraftsOpen(false);
  };

  if (open === undefined && latest.isPending) return <Splash />;

  return (
    <>
      {!active ? (
        <UploadPanel
          onFile={(file) => upload.mutate(file)}
          busy={upload.isPending ? upload.variables.name : null}
          error={uploadError}
          onShowDrafts={() => setDraftsOpen(true)}
          maxMb={maxUploadMb}
        />
      ) : view.data ? (
        <DocumentWorkspace
          key={`${active.id}:${active.generation}`}
          ref={workspace}
          doc={view.data}
          onShowDrafts={() => setDraftsOpen(true)}
          onClose={() => setOpen(null)}
          onOpenDocument={show}
          announce={setAnnouncement}
        />
      ) : (
        <Splash />
      )}
      <DraftsDrawer
        open={draftsOpen}
        currentId={active?.id ?? null}
        onClose={() => setDraftsOpen(false)}
        onOpen={openDraft}
        onDeleted={(id) => id === active?.id && setOpen(null)}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
