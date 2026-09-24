"use client";

import { CircleAlert, FileText, FolderOpen, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "@/lib/http";
import { Button, IconButton } from "@/shared/ui/Button";
import { useConfirm } from "@/shared/ui/ConfirmDialog";
import { Skeleton } from "@/shared/ui/Status";
import type { DraftListItem } from "../contracts";
import { useDeleteDraft, useDraftList, useRenameDraft } from "../queries";
import { DraftRow } from "./DraftRow";

interface Props {
  open: boolean;
  currentId: string | null;
  onClose(): void;
  /** Opening another draft; the caller saves pending edits first. */
  onOpen(id: string): Promise<void>;
  onDeleted(id: string): void;
}

/** Saved drafts of this browser: open, rename, delete. A native modal dialog traps focus, closes on Escape and restores focus. */
export function DraftsDrawer({ open, currentId, onClose, onOpen, onDeleted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useDraftList(open);
  const rename = useRenameDraft();
  const remove = useDeleteDraft();
  // One action at a time; its failure is shown above the list.
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setActionError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const run = async (id: string, action: () => Promise<unknown>): Promise<boolean> => {
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
    if (ok) await run(d.id, () => remove.mutateAsync(d.id).then(() => onDeleted(d.id)));
  };

  const drafts = list.data;
  const error = actionError ?? (list.error ? errorMessage(list.error) : null);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={titleId}
      className="lx-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-md border-l border-line bg-surface p-0 text-ink shadow-lg sm:w-[28rem]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <FolderOpen aria-hidden className="size-5 text-ink-2" />
          <h2 id={titleId} className="flex-1 text-[17px] font-semibold">
            Saved drafts
          </h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <p className="border-b border-line bg-subtle px-5 py-3 text-[13px] leading-relaxed text-ink-2">
          Drafts are saved on the server and linked to this browser, with no account. Each one is kept until the date shown, which moves forward whenever you
          save. Another browser, device or private window will not see them.
        </p>
        {error && (
          <div role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-danger-line bg-danger-surface px-3.5 py-3 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {!drafts && (
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void list.refetch()}>
                Retry
              </Button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {!drafts && !list.error && (
            <ul aria-busy className="space-y-1" aria-label="Loading drafts">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex gap-3 rounded-xl px-3 py-3">
                  <Skeleton className="size-9 rounded-lg" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {drafts?.length === 0 && (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-subtle text-ink-3">
                <FileText aria-hidden className="size-6" />
              </div>
              <p className="mt-4 text-[15px] font-semibold text-ink">No saved drafts in this browser yet</p>
              <p className="mt-1 text-sm text-ink-2">Upload a template to start one. It is saved as you work.</p>
            </div>
          )}
          {drafts && drafts.length > 0 && (
            <ul className="space-y-1">
              {drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  d={d}
                  current={d.id === currentId}
                  busy={busy !== null}
                  rowBusy={busy === d.id}
                  onOpen={() => void run(d.id, () => onOpen(d.id))}
                  onRename={(title) => run(d.id, () => rename.mutateAsync({ id: d.id, title }))}
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
