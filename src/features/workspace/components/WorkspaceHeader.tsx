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
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/Button";
import { LanguageControl } from "@/shared/ui/LanguageControl";
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
  note?: string | null;
  hasDraft: boolean;
  canSaveNow: boolean;
  saving: boolean;
  onSaveNow(): void;
  onDrafts(): void;
  onNewTemplate(): void;
  onDownload(): void;
  downloading: boolean;
  onOpenInWord(): void;
  openingInWord: boolean;
  onGenerate(): void;
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
  const t = useTranslations("header");
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
            {t("saveNow")}
          </Button>
        )}
        <Button
          variant="ghost"
          icon={FolderOpen}
          onClick={onDrafts}
          className="max-lg:hidden"
        >
          {t("savedDrafts")}
        </Button>
        <Button
          variant="ghost"
          icon={FilePlus2}
          onClick={onNewTemplate}
          className="max-lg:hidden"
        >
          {t("newTemplate")}
        </Button>
        <LanguageControl className="ml-1.5 max-lg:hidden" />
        <ThemeControl className="mr-1.5 ml-1 max-lg:hidden" />
        {hasDraft ? (
          <>
            {generating && (
              <span
                id="download-hint"
                className="mr-1 text-meta text-ink-3 max-2xl:sr-only"
              >
                {t("availableWhenReady")}
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
              {t("openInWord")}
            </Button>
            <Button
              variant="primary"
              icon={Download}
              onClick={onDownload}
              disabled={generating}
              busy={downloading}
              aria-label={t("downloadWordFile")}
              aria-describedby={describedBy}
            >
              <span className="sm:hidden">{t("download")}</span>
              <span className="max-sm:hidden">{t("downloadWordFile")}</span>
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={onGenerate}
            disabled={!canGenerate}
            busy={generating}
            aria-label={t("generateDraft")}
            aria-describedby={describedBy}
          >
            <span className="sm:hidden">{t("generate")}</span>
            <span className="max-sm:hidden">{t("generateDraft")}</span>
          </Button>
        )}
        <div className="lg:hidden">
          <Popover label={t("moreActions")} icon={Ellipsis}>
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
                    {t("saveNow")}
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
                    {t("openInWord")}
                  </MenuItem>
                )}
                <MenuItem
                  icon={FolderOpen}
                  onClick={() => {
                    close();
                    onDrafts();
                  }}
                >
                  {t("savedDrafts")}
                </MenuItem>
                <MenuItem
                  icon={FilePlus2}
                  onClick={() => {
                    close();
                    onNewTemplate();
                  }}
                >
                  {t("newTemplate")}
                </MenuItem>
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-line px-2.5 pt-2.5 pb-1">
                  <span className="text-ui font-medium text-ink-2">
                    {t("language")}
                  </span>
                  <LanguageControl />
                </div>
                <div className="flex items-center justify-between gap-4 px-2.5 pt-1.5 pb-1">
                  <span className="text-ui font-medium text-ink-2">
                    {t("theme")}
                  </span>
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
