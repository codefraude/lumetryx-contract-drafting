"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/shared/ui/Button";
import { MenuItem, Popover } from "@/shared/ui/Popover";
import { StatusText, type Tone } from "@/shared/ui/Status";
import type { DraftListItem } from "../contracts";

const PHASE_TONE: Record<DraftListItem["phase"], Tone> = {
  interview: "neutral",
  ready: "neutral",
  generating: "neutral",
  interrupted: "warn",
  draft: "ok",
};

const when = (iso: string, locale: string) => {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const day = (iso: string, locale: string) => {
  return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
};

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
  const t = useTranslations("drafts");
  const tStatus = useTranslations("status");
  const tLanguages = useTranslations("languages");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.title);
  const left =
    d.detailsLeft && d.decisionsLeft
      ? tStatus("bothNeeded", {
          details: d.detailsLeft,
          decisions: d.decisionsLeft,
        })
      : d.detailsLeft
        ? tStatus("detailsNeeded", { details: d.detailsLeft })
        : d.decisionsLeft
          ? tStatus("decisionsNeeded", { decisions: d.decisionsLeft })
          : null;
  const language = d.language === "unknown" ? null : tLanguages(d.language);

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
            {t("draftName")}
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
              {tCommon("save")}
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {tCommon("cancel")}
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
                  {t("currentlyOpen")}
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-ink-2">
              {t("savedOn", { when: when(d.savedAt, locale) })}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusText tone={PHASE_TONE[d.phase]}>
                {t(`phase.${d.phase}`)}
              </StatusText>
              {left && <span className="text-ink-2">{left}</span>}
            </span>
            <span className="mt-0.5 block text-ink-3">
              {language && `${language}. `}
              {t("keptUntil", { date: day(d.expiresAt, locale) })}
            </span>
          </button>
          <div className="pt-1">
            <Popover
              label={t("actionsFor", { title: d.title })}
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
                    {t("rename")}
                  </MenuItem>
                  <MenuItem
                    icon={Trash2}
                    tone="danger"
                    onClick={() => {
                      close();
                      onDelete();
                    }}
                  >
                    {t("delete")}
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
