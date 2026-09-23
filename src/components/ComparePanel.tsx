"use client";

import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleSlash, Eraser, Minus, PenLine, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CompareResponse } from "@/lib/client/api";
import { Button, IconButton, Skeleton, StatusBadge, type Tone } from "./ui";

type Item = CompareResponse["result"]["items"][number];
type Segment = Item["segments"][number];

const TYPE: Record<Item["type"], { label: string; icon: typeof PenLine; tone: Tone }> = {
  modified: { label: "Changed", icon: PenLine, tone: "accent" },
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
  /** Changes whenever the draft or answers change, so the comparison is recomputed. */
  version: string;
}

const Ins = ({ text }: { text: string }) => (
  <ins className="rounded-[3px] bg-ins-surface px-0.5 text-ins underline decoration-ins/60 decoration-[1.5px] underline-offset-[3px]">
    <span className="sr-only">[added: </span>
    {text}
    <span className="sr-only">]</span>
  </ins>
);
const Del = ({ text }: { text: string }) => (
  <del className="rounded-[3px] bg-del-surface px-0.5 text-del decoration-del/70 decoration-[1.5px]">
    <span className="sr-only">[removed: </span>
    {text}
    <span className="sr-only">]</span>
  </del>
);

/** One highlight per run of changed words ("Lumetryx Ltée", not "Lumetryx" and "Ltée"). */
function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  segments.forEach((s, i) => {
    const prev = out.at(-1);
    // Spaces between two changes of the same kind belong to the change.
    const joins = s.op === "eq" && !s.text.trim() && prev && prev.op !== "eq" && segments[i + 1]?.op === prev.op;
    if (prev && (joins || prev.op === s.op)) out[out.length - 1] = { ...prev, text: prev.text + s.text };
    else out.push(s);
  });
  return out;
}

/** One paragraph of document text; `side` keeps only what that version contains. */
function Text({ segments, side }: { segments: Segment[]; side?: "template" | "draft" }) {
  const shown = merge(segments.filter((s) => !side || s.op === "eq" || (side === "template" ? s.op === "del" : s.op === "ins")));
  if (!shown.length) return <p className="text-[13px] italic text-ink-3">{side === "template" ? "Not in the template" : "Not in the draft"}</p>;
  return (
    <p className="whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-ink">
      {shown.map((s, i) => (s.op === "ins" ? <Ins key={i} text={s.text} /> : s.op === "del" ? <Del key={i} text={s.text} /> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

/**
 * Read-only comparison of the uploaded template with the current draft. It is a content and
 * structure comparison, not a layout comparison, and nothing it shows enters the document.
 */
export function ComparePanel({ documentId, snapshot, version }: Props) {
  const [nonce, setNonce] = useState(0);
  const key = `${documentId}:${version}:${nonce}`;
  const [result, setResult] = useState<{ key: string; data: CompareResponse | null; error: string | null } | null>(null);
  const [at, setAt] = useState(0);
  const [wide, setWide] = useState(false);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A fresh snapshot of the editor every time: an edit made just before opening Compare is included.
        const data = await api.compare(documentId, await snapshot());
        if (!cancelled) setResult({ key, data, error: null });
      } catch (e) {
        if (!cancelled) setResult({ key, data: null, error: e instanceof Error ? e.message : "The comparison could not be computed." });
      }
      if (!cancelled) setAt(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, snapshot, key]);

  // Template and draft side by side only where the panel is wide enough; inline otherwise.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? 0) >= 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loading = result?.key !== key;
  const data = loading ? null : (result?.data ?? null);
  const error = loading ? null : (result?.error ?? null);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  const items = data?.result.items ?? [];
  const changes = items.filter((i) => i.type !== "clause_included");
  // Previous/Next step through changes; a clause kept as in the template is shown but is not a change.
  const stops = items.flatMap((it, i) => (it.type === "clause_included" ? [] : [i]));
  const current = stops[at];
  const go = (next: number) => {
    const n = Math.max(0, Math.min(stops.length - 1, next));
    setAt(n);
    const el = refs.current[stops[n]!];
    el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el?.focus({ preventScroll: true });
  };
  const c = data?.result.counts;
  const breakdown = c
    ? [
        [c.modified, "changed"],
        [c.added, "added"],
        [c.deleted, "removed"],
        [c.filled, c.filled === 1 ? "placeholder filled" : "placeholders filled"],
        [c.clauses, c.clauses === 1 ? "clause excluded" : "clauses excluded"],
      ].filter(([n]) => Number(n) > 0)
    : [];

  return (
    <section aria-label="Comparison with the template" className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-60" role="status" aria-live="polite">
            <p className="text-[14.5px] font-semibold text-ink">{loading ? "Comparing with the template…" : error ? "The comparison failed" : changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} from the template` : "No differences from the template"}</p>
            {data && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">Template compared with {SOURCE[data.source]}.</p>}
          </div>
          <div className="flex items-center gap-1">
            {stops.length > 0 && (
              <span className="mr-1 text-[12.5px] tabular-nums text-ink-3">
                {at + 1} of {stops.length}
              </span>
            )}
            <IconButton label="Previous change" icon={ChevronUp} variant="secondary" size="sm" disabled={!stops.length || at === 0} onClick={() => go(at - 1)} />
            <IconButton label="Next change" icon={ChevronDown} variant="secondary" size="sm" disabled={!stops.length || at >= stops.length - 1} onClick={() => go(at + 1)} />
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
        {breakdown.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Summary">
            {breakdown.map(([n, label]) => (
              <li key={String(label)} className="rounded-md bg-subtle px-2 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line">
                {n} {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6">
        <div className="mx-auto max-w-[1040px]">
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={load}>
                Retry
              </Button>
            </div>
          )}
          {loading && (
            <ul aria-hidden className="space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="space-y-2.5 rounded-xl border border-line bg-surface p-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-4/5" />
                </li>
              ))}
            </ul>
          )}
          {data && !items.length && (
            <div className="rounded-card border border-line bg-surface px-6 py-12 text-center">
              <CircleCheck aria-hidden className="mx-auto size-8 text-ok" />
              <p className="mt-3 text-[15px] font-semibold text-ink">The draft matches the template</p>
              <p className="mt-1 text-sm text-ink-2">Nothing has been filled in, added or removed yet.</p>
            </div>
          )}
          {items.length > 0 && wide && (
            <div aria-hidden className="mb-2 grid grid-cols-2 gap-6 px-4 text-[12px] font-semibold text-ink-3">
              <span>Template</span>
              <span>Draft</span>
            </div>
          )}
          <ol className="space-y-3">
            {items.map((item, i) => {
              const t = TYPE[item.type];
              const split = wide && item.segments.length > 0;
              return (
                <li
                  key={item.id}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  tabIndex={-1}
                  aria-current={i === current ? "true" : undefined}
                  className={`scroll-mt-4 rounded-xl border bg-surface px-4 py-3.5 shadow-sm outline-none transition-[border-color,box-shadow] duration-200 dark:bg-raised ${i === current ? "border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--lx-primary)_18%,transparent)]" : "border-line"}`}
                >
                  <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge tone={t.tone} icon={t.icon}>
                      {t.label}
                    </StatusBadge>
                    <span className="text-[12.5px] text-ink-3">{item.location}</span>
                  </p>
                  {split ? (
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <span className="sr-only">Template: </span>
                        <Text segments={item.segments} side="template" />
                      </div>
                      <div className="border-l border-line pl-6">
                        <span className="sr-only">Draft: </span>
                        <Text segments={item.segments} side="draft" />
                      </div>
                    </div>
                  ) : (
                    item.segments.length > 0 && <Text segments={item.segments} />
                  )}
                  {item.notes.map((n, k) => (
                    <p key={k} className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
                      {n}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
          {data && (
            <p className="mt-6 text-[12.5px] leading-relaxed text-ink-3">
              This compares content and structure: text word by word, bold, italic and underline, paragraph styles, heading and list levels, and table cells. It does not compare fonts, sizes, colours, spacing or page layout, and it adds nothing to the document you edit or download.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
