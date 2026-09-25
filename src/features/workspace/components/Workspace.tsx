"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { uploadTemplate } from "@/features/documents/api";
import { UploadPanel } from "@/features/documents/components/UploadPanel";
import type { DocumentView } from "@/features/documents/contracts/document-view";
import {
  currentDocumentQuery,
  documentKeys,
  documentQuery,
  storeDocument,
} from "@/features/documents/queries";
import { DraftsDrawer } from "@/features/drafts/components/DraftsDrawer";
import { draftKeys } from "@/features/drafts/queries";
import { useErrorText } from "@/i18n/error-text";
import { BrandMark } from "@/shared/ui/BrandMark";
import { useSessionLoss } from "../use-session-loss";
import {
  DocumentWorkspace,
  type DocumentWorkspaceHandle,
} from "./DocumentWorkspace";

interface OpenDraft {
  id: string;
  generation: number;
}

function Splash() {
  const t = useTranslations("workspace");

  return (
    <div className="grid min-h-dvh place-items-center">
      <p role="status" className="flex items-center gap-3 text-ui text-ink-2">
        <BrandMark />
        {t("opening")}
      </p>
    </div>
  );
}

export function Workspace({ maxUploadMb }: { maxUploadMb: number }) {
  const queryClient = useQueryClient();
  const latest = useQuery(currentDocumentQuery(queryClient));
  const [open, setOpen] = useState<OpenDraft | null>();
  const active =
    open === undefined
      ? latest.data
        ? {
            id: latest.data,
            generation: 0,
          }
        : null
      : open;
  const view = useQuery({
    ...documentQuery(active?.id ?? ""),
    enabled: active !== null,
  });
  const [draftsOpen, setDraftsOpen] = useState(false);
  const errorText = useErrorText();
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const workspace = useRef<DocumentWorkspaceHandle>(null);

  const show = (doc: DocumentView) => {
    storeDocument(queryClient, doc);

    setOpen((o) => ({
      id: doc.id,
      generation: (o?.generation ?? 0) + 1,
    }));
  };

  const upload = useMutation({
    mutationFn: uploadTemplate,
    onMutate: () => setUploadError(null),
    onSuccess: (doc) => {
      queryClient.removeQueries({ queryKey: draftKeys.list });
      show(doc);
    },
    onError: (e) => setUploadError(e),
  });

  useSessionLoss((error) => {
    setOpen(null);
    setUploadError(error);
    queryClient.removeQueries({ queryKey: documentKeys.all });
    queryClient.removeQueries({ queryKey: draftKeys.list });
  });

  const openDraft = async (id: string) => {
    if (id === active?.id) {
      return setDraftsOpen(false);
    }

    if (!(await (workspace.current?.leave() ?? true))) {
      return;
    }

    show(
      await queryClient.fetchQuery({
        ...documentQuery(id),
        staleTime: 0,
      }),
    );

    setDraftsOpen(false);
  };

  if (open === undefined && latest.isPending) {
    return <Splash />;
  }

  return (
    <>
      {!active ? (
        <UploadPanel
          onFile={(file) => upload.mutate(file)}
          busy={upload.isPending ? upload.variables.name : null}
          error={uploadError === null ? null : errorText(uploadError)}
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
