"use client";

import { CircleAlert, Ellipsis, FileText, FolderOpen, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type DraftListItem } from "@/lib/client/api";
import { Button, IconButton, MenuItem, Popover, Skeleton, StatusBadge, useConfirm, type Tone } from "./ui";

const PHASE: Record<DraftListItem["phase"], { label: string; tone: Tone }> = {
  interview: { label: "Answering questions", tone: "neutral" },
  ready: { label: "Ready to generate", tone: "accent" },
  generating: { label: "Generating", tone: "accent" },
  interrupted: { label: "Generation interrupted", tone: "warn" },
  draft: { label: "Draft", tone: "ok" },
};

const LANGUAGE: Partial<Record<DraftListItem["language"], string>> = { en: "English", fr: "French", mixed: "English and French" };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

function remaining(d: DraftListItem) {
  const parts = [d.detailsLeft && `${d.detailsLeft} ${d.detailsLeft === 1 ? "detail" : "details"}`, d.decisionsLeft && `${d.decisionsLeft} ${d.decisionsLeft === 1 ? "decision" : "decisions"}`].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} still needed` : null;
}

interface Props {
  open: boolean;
  currentId: string | null;
  onClose(): void;
  /** Opening another draft; the caller saves pending edits first. */
  onOpen(id: string): Promise<void>;
  onDeleted(id: string): void;
  onRenamed(id: string, title: string): void;
}

/** Saved drafts of this browser: open, rename, delete. A native modal dialog traps focus, closes on Escape and restores focus. */
export function DraftsDrawer({ open, currentId, onClose, onOpen, onDeleted, onRenamed }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();
  const titleId = useId();

  const load = () => {
    setError(null);
    setDrafts(null);
    api.drafts().then(
      (r) => setDrafts(r.drafts),
      (e: Error) => setError(e.message),
    );
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      load();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: DraftListItem) => {
    const ok = await ask({ title: `Delete “${d.title}”?`, body: "The draft, its answers and its conversation are deleted permanently. This cannot be undone.", confirm: "Delete draft", tone: "danger" });
    if (!ok) return;
    await run(d.id, async () => {
      await api.remove(d.id);
      setDrafts((all) => all?.filter((x) => x.id !== d.id) ?? null);
      onDeleted(d.id);
    });
  };

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby={titleId} className="lx-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-md border-l border-line bg-surface p-0 text-ink shadow-lg sm:w-[28rem]">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <FolderOpen aria-hidden className="size-5 text-ink-2" />
          <h2 id={titleId} className="flex-1 text-[17px] font-semibold">Saved drafts</h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <p className="border-b border-line bg-subtle px-5 py-3 text-[13px] leading-relaxed text-ink-2">
          Drafts are saved on the server and linked to this browser, with no account. Each one is kept until the date shown, which moves forward whenever you save. Another browser, device or private window will not see them.
        </p>
        {error && (
          <div role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-danger-line bg-danger-surface px-3.5 py-3 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {drafts === null && (
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={load}>
                Retry
              </Button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {drafts === null && !error && (
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
              {drafts.map((d) => {
                const current = d.id === currentId;
                const phase = PHASE[d.phase];
                const left = remaining(d);
                return (
                  <li key={d.id} className={`group relative rounded-xl transition-colors duration-150 ${current ? "bg-accent-surface/60" : "hover:bg-hover"}`}>
                    {renaming === d.id ? (
                      <form
                        className="flex flex-wrap gap-2 px-3 py-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(d.id, async () => {
                            const v = await api.rename(d.id, name);
                            setDrafts((all) => all?.map((x) => (x.id === d.id ? { ...x, title: v.title, savedAt: v.savedAt, expiresAt: v.expiresAt } : x)) ?? null);
                            onRenamed(d.id, v.title);
                            setRenaming(null);
                          });
                        }}
                      >
                        <label htmlFor={`rename-${d.id}`} className="sr-only">Draft name</label>
                        <input id={`rename-${d.id}`} autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setRenaming(null))} className="h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-sm text-ink outline-none focus:border-primary dark:bg-raised" />
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" disabled={!name.trim()} busy={busy === d.id}>Save</Button>
                          <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-start gap-1 pr-1.5">
                        <button type="button" disabled={busy !== null} onClick={() => void run(d.id, () => onOpen(d.id))} aria-current={current ? "true" : undefined} className="flex min-w-0 flex-1 gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-60">
                          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${current ? "bg-primary text-on-primary" : "bg-subtle text-ink-2"}`}>
                            <FileText aria-hidden className="size-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14.5px] font-semibold text-ink">{d.title}</span>
                              {current && <span className="shrink-0 text-[12px] font-medium text-accent-ink">Open now</span>}
                            </span>
                            <span className="mt-0.5 block text-[12.5px] text-ink-2">Saved {when(d.savedAt)}</span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <StatusBadge tone={phase.tone}>{phase.label}</StatusBadge>
                              {LANGUAGE[d.language] && <StatusBadge tone="neutral">{LANGUAGE[d.language]}</StatusBadge>}
                            </span>
                            {left && <span className="mt-1.5 block text-[12.5px] text-ink-2">{left}</span>}
                            <span className="mt-0.5 block text-[12px] text-ink-3">Kept until {day(d.expiresAt)}</span>
                          </span>
                        </button>
                        <div className="pt-2.5">
                          <Popover label={`Actions for ${d.title}`} icon={Ellipsis} panelClassName="min-w-44">
                            {(close) => (
                              <>
                                <MenuItem
                                  icon={Pencil}
                                  onClick={() => {
                                    close();
                                    setRenaming(d.id);
                                    setName(d.title);
                                  }}
                                >
                                  Rename
                                </MenuItem>
                                <MenuItem
                                  icon={Trash2}
                                  tone="danger"
                                  onClick={() => {
                                    close();
                                    void remove(d);
                                  }}
                                >
                                  Delete
                                </MenuItem>
                              </>
                            )}
                          </Popover>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {confirmDialog}
    </dialog>
  );
}
