"use client";

import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Eraser,
  Minus,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useErrorText } from "@/i18n/error-text";
import { Button, IconButton } from "@/shared/ui/Button";
import { Callout, Skeleton, StatusText, type Tone } from "@/shared/ui/Status";
import type { DiffItem } from "../contracts";
import { useComparison } from "../queries";
import { DiffText } from "./DiffText";

type Item = DiffItem;

const TYPE: Record<
  Item["type"],
  {
    icon: typeof PenLine;
    tone: Tone;
  }
> = {
  modified: {
    icon: PenLine,
    tone: "neutral",
  },
  added: {
    icon: Plus,
    tone: "ok",
  },
  deleted: {
    icon: Minus,
    tone: "danger",
  },
  clause_excluded: {
    icon: CircleSlash,
    tone: "neutral",
  },
  clause_included: {
    icon: CircleCheck,
    tone: "ok",
  },
  markers_removed: {
    icon: Eraser,
    tone: "neutral",
  },
};

interface Props {
  documentId: string;
  snapshot(): Promise<Blob | null>;
  version: string;
}

export function ComparePanel({ documentId, snapshot, version }: Props) {
  const t = useTranslations("compare");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const comparison = useComparison(documentId, version, snapshot);
  const [cursor, setCursor] = useState({
    result: 0,
    at: 0,
  });
  const at = cursor.result === comparison.dataUpdatedAt ? cursor.at : 0;

  const setAt = (n: number) => {
    setCursor({
      result: comparison.dataUpdatedAt,
      at: n,
    });
  };

  const [wide, setWide] = useState(false);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = body.current;

    if (!el) {
      return;
    }

    const ro = new ResizeObserver(([e]) =>
      setWide((e?.contentRect.width ?? 0) >= 760),
    );

    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  const loading = comparison.isFetching;
  const data = loading ? null : (comparison.data ?? null);
  const error =
    loading || !comparison.error ? null : errorText(comparison.error);

  const load = () => {
    return void comparison.refetch();
  };

  const items = data?.result.items ?? [];
  const changes = items.filter((i) => i.type !== "clause_included");
  const stops = items.flatMap((it, i) =>
    it.type === "clause_included" ? [] : [i],
  );
  const current = stops[at];

  const go = (next: number) => {
    const n = Math.max(0, Math.min(stops.length - 1, next));

    setAt(n);
    const stop = stops[n];
    const el = stop === undefined ? null : refs.current[stop];

    el?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });

    el?.focus({ preventScroll: true });
  };

  const c = data?.result.counts;
  const summary = c
    ? (
        [
          ["changed", c.modified],
          ["added", c.added],
          ["removed", c.deleted],
          ["filled", c.filled],
          ["clausesExcluded", c.clauses],
        ] as const
      )
        .filter(([, n]) => n > 0)
        .map(([key, count]) => t(key, { count }))
        .join(", ")
    : "";

  return (
    <section
      aria-label={t("label")}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div
            className="min-w-0 flex-1 basis-60"
            role="status"
            aria-live="polite"
          >
            <p className="text-ui font-semibold text-ink">
              {loading
                ? t("comparing")
                : error
                  ? t("failed")
                  : changes.length
                    ? t("changes", { count: changes.length })
                    : t("noDifferences")}
            </p>
            {summary && (
              <p
                role="note"
                aria-label={t("summaryLabel")}
                className="mt-0.5 text-meta text-ink-2"
              >
                {summary}.
              </p>
            )}
            {data && (
              <p className="mt-0.5 text-meta text-ink-3">
                {t("comparedWith", { source: data.source })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {stops.length > 0 && (
              <span className="mr-1 text-meta text-ink-3 tabular-nums">
                {t("position", {
                  current: at + 1,
                  total: stops.length,
                })}
              </span>
            )}
            <IconButton
              label={t("previous")}
              icon={ChevronUp}
              variant="secondary"
              size="sm"
              disabled={!stops.length || at === 0}
              onClick={() => go(at - 1)}
            />
            <IconButton
              label={t("next")}
              icon={ChevronDown}
              variant="secondary"
              size="sm"
              disabled={!stops.length || at >= stops.length - 1}
              onClick={() => go(at + 1)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              onClick={load}
              disabled={loading}
            >
              {t("refresh")}
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={body}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
      >
        <div className="mx-auto max-w-[1040px]">
          {error && (
            <Callout
              tone="danger"
              icon={CircleAlert}
              role="alert"
              className="text-ui"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RotateCcw}
                  onClick={load}
                >
                  {tCommon("retry")}
                </Button>
              }
            >
              {error}
            </Callout>
          )}
          {loading && (
            <ul aria-hidden className="divide-y divide-line">
              {[0, 1, 2].map((i) => (
                <li key={i} className="space-y-2.5 px-4 py-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-4/5" />
                </li>
              ))}
            </ul>
          )}
          {data && !items.length && (
            <div className="py-12 text-center">
              <CircleCheck aria-hidden className="mx-auto size-6 text-ok" />
              <p className="mt-3 text-ui font-semibold text-ink">
                {t("matchesTitle")}
              </p>
              <p className="mt-1 text-ui text-ink-2">{t("matchesBody")}</p>
            </div>
          )}
          {items.length > 0 && wide && (
            <div
              aria-hidden
              className="mb-2 grid grid-cols-2 gap-6 px-4 text-meta font-semibold text-ink-3"
            >
              <span>{t("template")}</span>
              <span>{t("draft")}</span>
            </div>
          )}
          <ol className="divide-y divide-line">
            {items.map((item, i) => {
              const type = TYPE[item.type];
              const split = wide && item.segments.length > 0;
              const on = i === current;
              const edge = on || (current !== undefined && i === current - 1);

              return (
                <li
                  key={item.id}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  tabIndex={-1}
                  aria-current={on ? "true" : undefined}
                  className={`scroll-mt-4 px-4 py-4 ${on ? "rounded-card bg-subtle ring-1 ring-control" : ""} ${edge ? "border-transparent" : ""}`}
                >
                  <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusText tone={type.tone} icon={type.icon}>
                      {t(`type.${item.type}`)}
                    </StatusText>
                    <span className="text-meta text-ink-3">
                      {item.location}
                    </span>
                  </p>
                  {split ? (
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <span className="sr-only">{t("templateSide")}</span>
                        <DiffText segments={item.segments} side="template" />
                      </div>
                      <div className="border-l border-line pl-6">
                        <span className="sr-only">{t("draftSide")}</span>
                        <DiffText segments={item.segments} side="draft" />
                      </div>
                    </div>
                  ) : (
                    item.segments.length > 0 && (
                      <DiffText segments={item.segments} />
                    )
                  )}
                  {item.notes.map((n, k) => (
                    <p key={k} className="mt-1.5 text-meta text-ink-2">
                      {n}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
          {data && (
            <p className="mt-6 max-w-[80ch] text-meta text-ink-3">
              {t("footnote")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
