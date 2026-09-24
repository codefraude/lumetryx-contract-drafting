"use client";

import { Check, CircleAlert, CircleCheck, Download, Ellipsis, FilePlus2, FileText, FolderOpen, LoaderCircle, Save, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/Button";
import { MenuItem, Popover } from "@/shared/ui/Popover";
import { ThemeControl } from "@/shared/ui/ThemeControl";
import type { StatusLine, StatusTone } from "../workspace-status";

const STATUS_ICON: Record<StatusTone, ReactNode> = {
  busy: <LoaderCircle aria-hidden className="size-3.5 animate-spin text-ink-3" />,
  ok: <CircleCheck aria-hidden className="size-3.5 text-ok" />,
  neutral: <span aria-hidden className="mx-[3px] size-2 rounded-full bg-control/70" />,
  warn: <TriangleAlert aria-hidden className="size-3.5 text-warn" />,
  danger: <CircleAlert aria-hidden className="size-3.5 text-danger" />,
};

const STEPS = ["Details", "Draft", "Review"];

interface Props {
  title: string;
  filename: string;
  status: StatusLine;
  /** Secondary note after the status, such as when the answers were last saved. */
  note?: string | null;
  /** 0 details, 1 draft, 2 review. */
  step: number;
  hasDraft: boolean;
  canSaveNow: boolean;
  saving: boolean;
  onSaveNow(): void;
  onDrafts(): void;
  onNewTemplate(): void;
  onDownload(): void;
  downloadDisabled: boolean;
  /** Why Download is unavailable; shown next to it and linked to it for assistive technology. */
  downloadHint: string | null;
  downloading: boolean;
}

export function WorkspaceHeader({
  title,
  filename,
  status,
  note,
  step,
  hasDraft,
  canSaveNow,
  saving,
  onSaveNow,
  onDrafts,
  onNewTemplate,
  onDownload,
  downloadDisabled,
  downloadHint,
  downloading,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface pl-3 pr-2 sm:pl-4 sm:pr-3 lg:h-16">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-surface text-accent-ink max-sm:hidden">
        <FileText className="size-[18px]" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14.5px] font-semibold leading-tight text-ink" title={`${title} (${filename})`}>
          {title}
        </h1>
        <p role="status" className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-tight text-ink-2">
          <span key={status.key} className="lx-pop grid shrink-0 place-items-center">
            {STATUS_ICON[status.tone]}
          </span>
          <span className={`truncate ${status.tone === "danger" ? "text-danger" : status.tone === "warn" ? "text-warn" : ""}`}>{status.text}</span>
          {note && (
            <>
              <span aria-hidden className="h-3 w-px shrink-0 bg-line max-sm:hidden" />
              <span className="truncate text-ink-3 max-sm:hidden">{note}</span>
            </>
          )}
        </p>
      </div>

      <ol aria-label="Progress" className="hidden shrink-0 items-center xl:flex">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          return (
            <li key={s} aria-current={state === "current" ? "step" : undefined} className="flex items-center">
              {i > 0 && <span aria-hidden className={`mx-0.5 h-px w-4 transition-colors duration-300 ${i <= step ? "bg-primary/60" : "bg-line"}`} />}
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors duration-300 ${state === "current" ? "bg-accent-surface text-accent-ink" : state === "done" ? "text-ink-2" : "text-ink-3"}`}
              >
                {state === "done" ? (
                  <Check aria-hidden className="size-3.5 text-ok" strokeWidth={2.5} />
                ) : (
                  <span aria-hidden className={`size-1.5 rounded-full ${state === "current" ? "bg-primary" : "bg-control/60"}`} />
                )}
                {s}
                <span className="sr-only">{state === "done" ? ", done" : state === "current" ? ", current step" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex shrink-0 items-center gap-1 xl:ml-2">
        {hasDraft && (
          <Button variant="ghost" icon={Save} disabled={!canSaveNow} busy={saving} onClick={onSaveNow} className="max-lg:hidden">
            Save now
          </Button>
        )}
        <Button variant="ghost" icon={FolderOpen} onClick={onDrafts} className="max-lg:hidden">
          Saved drafts
        </Button>
        <Button variant="ghost" icon={FilePlus2} onClick={onNewTemplate} className="max-lg:hidden">
          New template
        </Button>
        <div className="mx-1.5 max-lg:hidden">
          <ThemeControl />
        </div>
        {downloadHint && (
          <span id="download-hint" className="mr-1 text-[12.5px] text-ink-3 max-2xl:sr-only">
            {downloadHint}
          </span>
        )}
        <Button
          variant="primary"
          icon={Download}
          onClick={onDownload}
          disabled={downloadDisabled}
          busy={downloading}
          aria-describedby={downloadHint ? "download-hint" : undefined}
        >
          <span className="sm:hidden">Download</span>
          <span className="max-sm:hidden">Download .docx</span>
        </Button>
        <div className="lg:hidden">
          <Popover label="More actions" icon={Ellipsis}>
            {(close) => (
              <>
                {hasDraft && (
                  <MenuItem
                    icon={Save}
                    disabled={!canSaveNow}
                    onClick={() => {
                      close();
                      onSaveNow();
                    }}
                  >
                    Save now
                  </MenuItem>
                )}
                <MenuItem
                  icon={FolderOpen}
                  onClick={() => {
                    close();
                    onDrafts();
                  }}
                >
                  Saved drafts
                </MenuItem>
                <MenuItem
                  icon={FilePlus2}
                  onClick={() => {
                    close();
                    onNewTemplate();
                  }}
                >
                  New template
                </MenuItem>
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-line px-2.5 pb-1 pt-2.5">
                  <span className="text-[13px] font-medium text-ink-2">Theme</span>
                  <ThemeControl />
                </div>
              </>
            )}
          </Popover>
        </div>
      </div>
    </header>
  );
}
