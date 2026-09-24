"use client";

import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleSlash, Eraser, Minus, PenLine, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/http";
import { Button, IconButton } from "@/shared/ui/Button";
import { Callout, Skeleton, StatusText, type Tone } from "@/shared/ui/Status";
import type { CompareResponse, DiffItem } from "../contracts";
import { useComparison } from "../queries";
import { DiffText } from "./DiffText";

type Item = DiffItem;

const TYPE: Record<Item["type"], { label: string; icon: typeof PenLine; tone: Tone }> = {
  modified: { label: "Changed", icon: PenLine, tone: "neutral" },
  added: { label: "Added", icon: Plus, tone: "ok" },
  deleted: { label: "Removed", icon: Minus, tone: "danger" },
  clause_excluded: { label: "Clause excluded", icon: CircleSlash, tone: "neutral" },
  clause_included: { label: "Clause included", icon: CircleCheck, tone: "ok" },
  markers_removed: { label: "Condition markers removed", icon: Eraser, tone: "neutral" },
};

const SOURCE: Record<CompareResponse["source"], string> = {
  editor: "the draft as it is in the editor now (including changes not saved yet)",
  working: "the saved draft",
  preview: "a preview of the draft your current answers would produce (no draft has been generated yet)",
};

interface Props {
  documentId: string;
  /** Current editor content, or null when there is no open draft; never saved by comparing. */
  snapshot(): Promise<Blob | null>;
  /** Changes whenever the server changes the draft or its answers, so the comparison is recomputed. */
  version: string;
}

/**
 * Read-only comparison of the uploaded template with the current draft. It is a content and
 * structure comparison, not a layout comparison, and nothing it shows enters the document.
 */
export function ComparePanel({ documentId, snapshot, version }: Props) {
  const comparison = useComparison(documentId, version, snapshot);
  // Previous/Next position within one result; a new result starts again at the first change.
  const [cursor, setCursor] = useState({ result: 0, at: 0 });
  const at = cursor.result === comparison.dataUpdatedAt ? cursor.at : 0;
  const setAt = (n: number) => setCursor({ result: comparison.dataUpdatedAt, at: n });
  const [wide, setWide] = useState(false);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const body = useRef<HTMLDivElement>(null);

  // Template and draft side by side only where the panel is wide enough; inline otherwise.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? 0) >= 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loading = comparison.isFetching;
  const data = loading ? null : (comparison.data ?? null);
  const error = loading || !comparison.error ? null : errorMessage(comparison.error, "The comparison could not be computed.");
  const load = () => void comparison.refetch();

  const items = data?.result.items ?? [];
  const changes = items.filter((i) => i.type !== "clause_included");
  // Previous/Next step through changes; a clause kept as in the template is shown but is not a change.
  const stops = items.flatMap((it, i) => (it.type === "clause_included" ? [] : [i]));
  const current = stops[at];
  const go = (next: number) => {
    const n = Math.max(0, Math.min(stops.length - 1, next));
    setAt(n);
    const stop = stops[n];
    const el = stop === undefined ? null : refs.current[stop];
    el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el?.focus({ preventScroll: true });
  };
  const c = data?.result.counts;
  const summary = c
    ? [
        [c.modified, "changed"],
        [c.added, "added"],
        [c.deleted, "removed"],
        [c.filled, c.filled === 1 ? "placeholder filled" : "placeholders filled"],
        [c.clauses, c.clauses === 1 ? "clause excluded" : "clauses excluded"],
      ]
        .filter(([n]) => Number(n) > 0)
        .map(([n, label]) => `${n} ${label}`)
        .join(", ")
    : "";

  return (
    <section aria-label="Comparison with the template" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-60" role="status" aria-live="polite">
            <p className="text-ui font-semibold text-ink">
              {loading
                ? "Comparing with the template…"
                : error
                  ? "The comparison failed"
                  : changes.length
                    ? `${changes.length} change${changes.length === 1 ? "" : "s"} from the template`
                    : "No differences from the template"}
            </p>
            {summary && (
              <p role="note" aria-label="Summary" className="mt-0.5 text-meta text-ink-2">
                {summary}.
              </p>
            )}
            {data && <p className="mt-0.5 text-meta text-ink-3">Template compared with {SOURCE[data.source]}.</p>}
          </div>
          <div className="flex items-center gap-1">
            {stops.length > 0 && (
              <span className="mr-1 text-meta tabular-nums text-ink-3">
                {at + 1} of {stops.length}
              </span>
            )}
            <IconButton
              label="Previous change"
              icon={ChevronUp}
              variant="secondary"
              size="sm"
              disabled={!stops.length || at === 0}
              onClick={() => go(at - 1)}
            />
            <IconButton
              label="Next change"
              icon={ChevronDown}
              variant="secondary"
              size="sm"
              disabled={!stops.length || at >= stops.length - 1}
              onClick={() => go(at + 1)}
            />
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Positioned, so the screen-reader markers inside (absolute) are clipped here instead of growing the page. */}
      <div ref={body} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6">
        <div className="mx-auto max-w-[1040px]">
          {error && (
            <Callout
              tone="danger"
              icon={CircleAlert}
              role="alert"
              className="text-ui"
              actions={
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={load}>
                  Retry
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
              <p className="mt-3 text-ui font-semibold text-ink">The draft matches the template</p>
              <p className="mt-1 text-ui text-ink-2">Nothing has been filled in, added or removed yet.</p>
            </div>
          )}
          {items.length > 0 && wide && (
            <div aria-hidden className="mb-2 grid grid-cols-2 gap-6 px-4 text-meta font-semibold text-ink-3">
              <span>Template</span>
              <span>Draft</span>
            </div>
          )}
          <ol className="divide-y divide-line">
            {items.map((item, i) => {
              const t = TYPE[item.type];
              const split = wide && item.segments.length > 0;
              const on = i === current;
              // The current item is a filled, outlined row, so the dividers on both sides of it give way.
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
                    <StatusText tone={t.tone} icon={t.icon}>
                      {t.label}
                    </StatusText>
                    <span className="text-meta text-ink-3">{item.location}</span>
                  </p>
                  {split ? (
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <span className="sr-only">Template: </span>
                        <DiffText segments={item.segments} side="template" />
                      </div>
                      <div className="border-l border-line pl-6">
                        <span className="sr-only">Draft: </span>
                        <DiffText segments={item.segments} side="draft" />
                      </div>
                    </div>
                  ) : (
                    item.segments.length > 0 && <DiffText segments={item.segments} />
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
              This compares content and structure: text word by word, bold, italic and underline, paragraph styles, heading and list levels, and table cells. It
              does not compare fonts, sizes, colours, spacing or page layout, and it adds nothing to the document you edit or download.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
