"use client";

import {
  CircleAlert,
  CircleCheck,
  Download,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Save,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/Button";
import { MenuItem, Popover } from "@/shared/ui/Popover";
import { ThemeControl } from "@/shared/ui/ThemeControl";
import type { StatusLine, StatusTone } from "../workspace-status";

const STATUS_ICON: Record<StatusTone, ReactNode> = {
  busy: (
    <LoaderCircle aria-hidden className="size-3.5 animate-spin text-ink-3" />
  ),
  ok: <CircleCheck aria-hidden className="size-3.5 text-ok" />,
  neutral: (
    <span aria-hidden className="mx-[3px] size-2 rounded-full bg-control/70" />
  ),
  warn: <TriangleAlert aria-hidden className="size-3.5 text-warn" />,
  danger: <CircleAlert aria-hidden className="size-3.5 text-danger" />,
};

interface Props {
  title: string;
  filename: string;
  status: StatusLine;
  /**
   * Secondary note after the status, such as when the answers were last saved.
   */
  note?: string | null;
  hasDraft: boolean;
  canSaveNow: boolean;
  saving: boolean;
  onSaveNow(): void;
  onDrafts(): void;
  onNewTemplate(): void;
  onDownload(): void;
  downloading: boolean;
  /** Hands the saved draft to Word on this device. */
  onOpenInWord(): void;
  openingInWord: boolean;
  onGenerate(): void;
  /** Nothing required is missing and no generation is running. */
  canGenerate: boolean;
  generating: boolean;
}

export function WorkspaceHeader({
  title,
  filename,
  status,
  note,
  hasDraft,
  canSaveNow,
  saving,
  onSaveNow,
  onDrafts,
  onNewTemplate,
  onDownload,
  downloading,
  onOpenInWord,
  openingInWord,
  onGenerate,
  canGenerate,
  generating,
}: Props) {
  // A disabled Generate is described by the status line
  // itself: a copy of its text would be matched twice.
  const describedBy = hasDraft
    ? generating
      ? "download-hint"
      : undefined
    : canGenerate
      ? undefined
      : "workspace-status-text";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-ui leading-tight font-semibold text-ink"
          title={`${title} (${filename})`}
        >
          {title}
        </h1>
        <p
          role="status"
          className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-ink-2 max-sm:leading-tight"
        >
          <span className="grid shrink-0 place-items-center">
            {STATUS_ICON[status.tone]}
          </span>
          <span
            id="workspace-status-text"
            className={`max-sm:line-clamp-2 sm:truncate ${status.tone === "danger" ? "text-danger" : status.tone === "warn" ? "text-warn" : ""}`}
          >
            {status.text}
          </span>
          {note && (
            <>
              <span
                aria-hidden
                className="h-3 w-px shrink-0 bg-line max-sm:hidden"
              />
              <span className="truncate text-ink-3 max-sm:hidden">{note}</span>
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {hasDraft && (
          <Button
            variant="ghost"
            icon={Save}
            disabled={!canSaveNow}
            busy={saving}
            onClick={onSaveNow}
            className="max-lg:hidden"
          >
            Save now
          </Button>
        )}
        <Button
          variant="ghost"
          icon={FolderOpen}
          onClick={onDrafts}
          className="max-lg:hidden"
        >
          Saved drafts
        </Button>
        <Button
          variant="ghost"
          icon={FilePlus2}
          onClick={onNewTemplate}
          className="max-lg:hidden"
        >
          New template
        </Button>
        <ThemeControl className="mx-1.5 max-lg:hidden" />
        {hasDraft ? (
          <>
            {generating && (
              <span
                id="download-hint"
                className="mr-1 text-meta text-ink-3 max-2xl:sr-only"
              >
                Available when the draft is ready
              </span>
            )}
            <Button
              variant="secondary"
              icon={ExternalLink}
              onClick={onOpenInWord}
              disabled={generating}
              busy={openingInWord}
              className="max-lg:hidden"
            >
              Open in Word
            </Button>
            <Button
              variant="primary"
              icon={Download}
              onClick={onDownload}
              disabled={generating}
              busy={downloading}
              aria-label="Download Word file"
              aria-describedby={describedBy}
            >
              <span className="sm:hidden">Download</span>
              <span className="max-sm:hidden">Download Word file</span>
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={onGenerate}
            disabled={!canGenerate}
            busy={generating}
            aria-label="Generate draft"
            aria-describedby={describedBy}
          >
            <span className="sm:hidden">Generate</span>
            <span className="max-sm:hidden">Generate draft</span>
          </Button>
        )}
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
                {hasDraft && (
                  <MenuItem
                    icon={ExternalLink}
                    disabled={generating || openingInWord}
                    onClick={() => {
                      close();
                      onOpenInWord();
                    }}
                  >
                    Open in Word
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
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-line px-2.5 pt-2.5 pb-1">
                  <span className="text-ui font-medium text-ink-2">Theme</span>
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
