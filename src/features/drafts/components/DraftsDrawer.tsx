"use client";

import { CircleAlert, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "@/lib/http";
import { Button, IconButton } from "@/shared/ui/Button";
import { useConfirm } from "@/shared/ui/ConfirmDialog";
import { Callout, Skeleton } from "@/shared/ui/Status";
import type { DraftListItem } from "../contracts";
import { useDeleteDraft, useDraftList, useRenameDraft } from "../queries";
import { DraftRow } from "./DraftRow";

interface Props {
  open: boolean;
  currentId: string | null;
  onClose(): void;
  onOpen(id: string): Promise<void>;
  onDeleted(id: string): void;
}

export function DraftsDrawer({
  open,
  currentId,
  onClose,
  onOpen,
  onDeleted,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useDraftList(open);
  const rename = useRenameDraft();
  const remove = useDeleteDraft();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;

    if (!d) {
      return;
    }

    if (open && !d.open) {
      setActionError(null);
      d.showModal();
    }

    if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const run = async (
    id: string,
    action: () => Promise<unknown>,
  ): Promise<boolean> => {
    setBusy(id);
    setActionError(null);

    try {
      await action();

      return true;
    } catch (e) {
      setActionError(errorMessage(e));

      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async (d: DraftListItem) => {
    const ok = await ask({
      title: `Delete “${d.title}”?`,
      body: "The draft, its answers and its conversation are deleted permanently. This cannot be undone.",
      confirm: "Delete draft",
      tone: "danger",
    });

    if (ok) {
      await run(d.id, () =>
        remove.mutateAsync(d.id).then(() => onDeleted(d.id)),
      );
    }
  };

  const drafts = list.data;
  const error = actionError ?? (list.error ? errorMessage(list.error) : null);

  return (
    <dialog
      ref={dialog}
      onClose={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby={titleId}
      className="lx-drawer fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-md rounded-none border-l border-line bg-surface p-0 text-ink shadow-overlay sm:w-[28rem]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="flex-1 text-title font-semibold">
            Saved drafts
          </h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <p className="border-b border-line px-5 py-3 text-meta text-ink-2">
          Drafts are saved on the server for this browser only, with no account.
          Other browsers, devices and private windows cannot see them. Each
          draft is kept until the date shown; saving moves that date forward.
        </p>
        {error && (
          <Callout
            tone="danger"
            icon={CircleAlert}
            role="alert"
            className="mx-5 mt-4 text-ui"
            actions={
              !drafts && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={() => void list.refetch()}
                >
                  Retry
                </Button>
              )
            }
          >
            {error}
          </Callout>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          {!drafts && !list.error && (
            <ul aria-busy className="px-2" aria-label="Loading drafts">
              {[0, 1, 2].map((i) => (
                <li key={i} className="space-y-2 px-3 py-3">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </li>
              ))}
            </ul>
          )}
          {drafts?.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-ui font-semibold text-ink">
                No saved drafts in this browser yet
              </p>
              <p className="mt-1 text-ui text-ink-2">
                Upload a template to start one. It is saved as you work.
              </p>
            </div>
          )}
          {drafts && drafts.length > 0 && (
            <ul className="divide-y divide-line px-2">
              {drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  d={d}
                  current={d.id === currentId}
                  busy={busy !== null}
                  rowBusy={busy === d.id}
                  onOpen={() => void run(d.id, () => onOpen(d.id))}
                  onRename={(title) =>
                    run(d.id, () =>
                      rename.mutateAsync({
                        id: d.id,
                        title,
                      }),
                    )
                  }
                  onDelete={() => void confirmDelete(d)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {confirmDialog}
    </dialog>
  );
}
