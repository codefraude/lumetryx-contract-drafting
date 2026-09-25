"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/Button";
import { MenuItem, Popover } from "@/shared/ui/Popover";
import { StatusText, type Tone } from "@/shared/ui/Status";
import type { DraftListItem } from "../contracts";

const PHASE: Record<
  DraftListItem["phase"],
  {
    label: string;
    tone: Tone;
  }
> = {
  interview: {
    label: "Answering questions",
    tone: "neutral",
  },
  ready: {
    label: "Ready to generate",
    tone: "neutral",
  },
  generating: {
    label: "Generating",
    tone: "neutral",
  },
  interrupted: {
    label: "Generation interrupted",
    tone: "warn",
  },
  draft: {
    label: "Draft",
    tone: "ok",
  },
};

const LANGUAGE: Partial<Record<DraftListItem["language"], string>> = {
  en: "English",
  fr: "French",
  mixed: "English and French",
};

const when = (iso: string) => {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const day = (iso: string) => {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
};

function remaining(d: DraftListItem) {
  const parts = [
    d.detailsLeft &&
      `${d.detailsLeft} ${d.detailsLeft === 1 ? "detail" : "details"}`,
    d.decisionsLeft &&
      `${d.decisionsLeft} ${d.decisionsLeft === 1 ? "decision" : "decisions"}`,
  ].filter(Boolean);

  return parts.length ? `${parts.join(" and ")} still needed` : null;
}

interface Props {
  d: DraftListItem;
  current: boolean;
  busy: boolean;
  rowBusy: boolean;
  onOpen(): void;
  onRename(title: string): Promise<boolean>;
  onDelete(): void;
}

export function DraftRow({
  d,
  current,
  busy,
  rowBusy,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.title);
  const phase = PHASE[d.phase];
  const left = remaining(d);
  const language = LANGUAGE[d.language];

  return (
    <li
      className={`rounded-control transition-colors duration-150 ${current ? "bg-subtle" : "hover:bg-hover"}`}
    >
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
              if (e.key !== "Escape") {
                return;
              }

              e.preventDefault();
              setRenaming(false);
            }}
            className="h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-ui text-ink transition-[border-color,box-shadow] duration-150 outline-none focus:border-accent-ink focus:ring-1 focus:ring-accent-ink dark:bg-raised pointer-coarse:h-11"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim()}
              busy={rowBusy}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-1 pr-1">
          <button
            type="button"
            disabled={busy}
            onClick={onOpen}
            aria-current={current ? "true" : undefined}
            className="min-w-0 flex-1 rounded-control px-3 py-3 text-left text-meta disabled:opacity-60"
          >
            <span className="flex items-baseline gap-2">
              <span className="truncate text-ui font-semibold text-ink">
                {d.title}
              </span>
              {current && (
                <span className="shrink-0 font-medium text-ink-2">
                  Currently open
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-ink-2">
              Saved {when(d.savedAt)}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusText tone={phase.tone}>{phase.label}</StatusText>
              {left && <span className="text-ink-2">{left}</span>}
            </span>
            <span className="mt-0.5 block text-ink-3">
              {language && `${language}. `}Kept until {day(d.expiresAt)}.
            </span>
          </button>
          <div className="pt-1">
            <Popover
              label={`Actions for ${d.title}`}
              icon={Ellipsis}
              panelClassName="min-w-44"
            >
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
