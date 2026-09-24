"use client";

import { Ellipsis, FileText, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/Button";
import { MenuItem, Popover } from "@/shared/ui/Popover";
import { StatusBadge, type Tone } from "@/shared/ui/Status";
import type { DraftListItem } from "../contracts";

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
  const parts = [
    d.detailsLeft && `${d.detailsLeft} ${d.detailsLeft === 1 ? "detail" : "details"}`,
    d.decisionsLeft && `${d.decisionsLeft} ${d.decisionsLeft === 1 ? "decision" : "decisions"}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} still needed` : null;
}

interface Props {
  d: DraftListItem;
  current: boolean;
  /** Some action on the list is running; rows can't be opened meanwhile. */
  busy: boolean;
  /** This row's action is running. */
  rowBusy: boolean;
  onOpen(): void;
  /** Resolves once the new name is saved. */
  onRename(title: string): Promise<boolean>;
  onDelete(): void;
}

/** One saved draft: open it, rename it in place, or delete it. */
export function DraftRow({ d, current, busy, rowBusy, onOpen, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.title);
  const phase = PHASE[d.phase];
  const left = remaining(d);
  return (
    <li className={`group relative rounded-xl transition-colors duration-150 ${current ? "bg-accent-surface/60" : "hover:bg-hover"}`}>
      {renaming ? (
        <form
          className="flex flex-wrap gap-2 px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onRename(name).then((saved) => saved && setRenaming(false));
          }}
        >
          <label htmlFor={`rename-${d.id}`} className="sr-only">
            Draft name
          </label>
          <input
            id={`rename-${d.id}`}
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setRenaming(false);
            }}
            className="h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-sm text-ink outline-none focus:border-primary dark:bg-raised"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!name.trim()} busy={rowBusy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-1 pr-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onOpen}
            aria-current={current ? "true" : undefined}
            className="flex min-w-0 flex-1 gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-60"
          >
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
                      setName(d.title);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem
                    icon={Trash2}
                    tone="danger"
                    onClick={() => {
                      close();
                      onDelete();
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
}
