"use client";

import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Info, RotateCcw } from "lucide-react";
import { Fragment, memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { boldSpans, messageBlocks } from "@/lib/client/format";
import type { ChatLanguage, DocLanguage } from "@/lib/fields/types";
import { BrandMark, Button, IconButton } from "./ui";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  streaming?: boolean;
  /** How many details this turn validated and saved; shown under the reply. */
  updated?: number;
}

export interface ChatError {
  message: string;
  retryable: boolean;
}

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  error: ChatError | null;
  disabledReason: string | null;
  /** Resolves false when the message was not sent at all, so the composer keeps the text. */
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  onRetry(): void;
  header?: ReactNode;
  footer?: ReactNode;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Inline({ text }: { text: string }) {
  return (
    <>
      {boldSpans(text).map((s, i) => (s.bold ? <strong key={i} className="font-semibold">{s.text}</strong> : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}

const Caret = () => <span aria-hidden className="lx-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-full bg-primary" />;

/** Paragraphs and lists; the streaming caret sits at the end of the last line. */
function Rich({ text, caret }: { text: string; caret: boolean }) {
  const blocks = messageBlocks(text);
  return (
    <>
      {blocks.map((b, i) => {
        const tail = caret && i === blocks.length - 1;
        if (b.kind === "p")
          return (
            <p key={i}>
              {b.lines.map((l, k) => (
                <Fragment key={k}>
                  {k > 0 && <br />}
                  <Inline text={l} />
                </Fragment>
              ))}
              {tail && <Caret />}
            </p>
          );
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-3`}>
            {b.items.map((it, k) => (
              <li key={k} className="pl-0.5">
                <Inline text={it} />
                {tail && k === b.items.length - 1 && <Caret />}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

function Thinking() {
  return (
    <div role="status" className="flex h-7 items-center gap-1 text-ink-3">
      <span className="sr-only">The assistant is working on a reply</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="lx-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

/** Memoised: while a reply streams, only the last message re-renders. */
const Message = memo(function Message({ m }: { m: ChatMessage }) {
  if (m.role === "notice")
    return (
      <div role="note" className="lx-rise flex gap-2.5 rounded-xl border border-warn-line bg-warn-surface px-3.5 py-3 text-[13.5px] leading-relaxed text-warn">
        <Info aria-hidden className="mt-[3px] size-4 shrink-0" />
        <p className="min-w-0">{m.content}</p>
      </div>
    );
  if (m.role === "user")
    return (
      <div className="lx-rise flex justify-end pl-8 sm:pl-12">
        <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-surface px-4 py-2.5 text-[15px] leading-[1.6] text-ink">
          <span className="sr-only">You said: </span>
          {m.content}
        </div>
      </div>
    );
  return (
    <div className="lx-rise flex gap-3">
      <BrandMark className="mt-0.5 size-6 text-[15px]" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">Assistant: </span>
        {m.content ? (
          <div className="space-y-2.5 break-words text-[15px] leading-[1.65] text-ink">
            <Rich text={m.content} caret={Boolean(m.streaming)} />
          </div>
        ) : m.streaming ? (
          <Thinking />
        ) : null}
        {m.updated ? (
          <p className="lx-rise mt-2 inline-flex items-center gap-1.5 rounded-md bg-ok-surface px-2 py-1 text-[12.5px] font-medium text-ok">
            <CircleCheck aria-hidden className="size-3.5" />
            {m.updated} {m.updated === 1 ? "detail" : "details"} updated
          </p>
        ) : null}
      </div>
    </div>
  );
});

function Composer({ busy, disabledReason, onSend, onStop, onSubmitted }: Pick<Props, "busy" | "disabledReason" | "onSend" | "onStop"> & { onSubmitted(): void }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy || disabledReason) return;
    setText("");
    onSubmitted();
    // A message that was never sent (for example, an unsaved edit blocked it) goes back into the box.
    if (!(await onSend(t))) setText((current) => current || t);
  };

  const off = Boolean(disabledReason);
  return (
    <form
      className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {disabledReason && (
        <p className="mb-2 flex items-start gap-2 px-1 text-[13px] leading-snug text-ink-2">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {disabledReason}
        </p>
      )}
      <div className={`flex items-end gap-2 rounded-2xl border bg-surface p-1.5 pl-3.5 shadow-sm transition-[border-color,box-shadow] duration-150 dark:bg-raised ${off ? "border-line opacity-70" : "border-control/60 focus-within:border-primary focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lx-primary)_20%,transparent)]"}`}>
        <label htmlFor="composer" className="sr-only">Message the assistant</label>
        <textarea
          id="composer"
          ref={area}
          rows={1}
          value={text}
          disabled={off}
          placeholder="Answer a question or ask about a clause…"
          aria-describedby="composer-hint"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter adds a line; never while an input method is composing text.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
        />
        {busy ? (
          <Button variant="secondary" aria-label="Stop" title="Stop" onClick={onStop} className="size-9 rounded-xl px-0! pointer-coarse:size-11">
            <span aria-hidden className="size-3 rounded-[3px] bg-current" />
          </Button>
        ) : (
          <IconButton type="submit" label="Send message" icon={ArrowUp} variant="primary" disabled={!text.trim() || off} className="rounded-xl" />
        )}
      </div>
      <p id="composer-hint" className="mt-1.5 hidden px-1 text-[12px] text-ink-3 sm:block [@media(max-height:680px)]:hidden">
        Enter sends, Shift+Enter adds a line. Write in English or French.
      </p>
    </form>
  );
}

export function ChatPanel({ messages, busy, error, disabledReason, onSend, onStop, onRetry, header, footer }: Props) {
  const list = useRef<HTMLDivElement>(null);
  /** Follow new content only while the reader is at the bottom. */
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const [seen, setSeen] = useState("");
  const last = messages.at(-1);
  const signature = `${messages.length}:${last?.content.length ?? 0}:${error ? 1 : 0}`;

  useLayoutEffect(() => {
    const el = list.current;
    // Instant, not smooth: a smooth scroll per streamed token would fight the reader.
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [signature]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    stick.current = near;
    setAway(!near);
    if (near) setSeen(signature);
  };
  const jump = () => {
    stick.current = true;
    const el = list.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const fresh = away && seen !== signature;

  return (
    <section aria-label="Assistant" className="flex h-full min-h-0 flex-col">
      {header}
      <div className="relative min-h-0 flex-1">
        <div ref={list} onScroll={onScroll} aria-label="Conversation" role="region" className="h-full space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {error && (
            <div role="alert" className="lx-rise ml-9 rounded-xl border border-danger-line bg-danger-surface px-3.5 py-3 text-sm leading-relaxed text-danger">
              <p className="flex gap-2">
                <CircleAlert aria-hidden className="mt-[3px] size-4 shrink-0" />
                <span className="min-w-0">{error.message}</span>
              </p>
              {error.retryable && (
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry} className="ml-6 mt-2.5">
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
        {away && (
          <button type="button" onClick={jump} className="lx-rise absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-raised px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-md transition-colors hover:bg-hover">
            <ArrowDown aria-hidden className="size-3.5" />
            Jump to latest
            {fresh && (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                <span className="sr-only">(new messages)</span>
              </>
            )}
          </button>
        )}
      </div>
      {footer}
      <Composer busy={busy} disabledReason={disabledReason} onSend={onSend} onStop={onStop} onSubmitted={() => (stick.current = true)} />
    </section>
  );
}

const LANGS: { value: ChatLanguage | null; label: string }[] = [
  { value: null, label: "Auto" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

const TEMPLATE_LANG: Partial<Record<DocLanguage, string>> = { mixed: "Bilingual template.", fr: "French template." };

export interface Progress {
  confirmed: number;
  total: number;
  decisions: number;
}

/** Assistant identity, conversation language and a short, truthful progress summary. */
export function ChatHeader({ language, onLanguage, progress, onReviewDetails, onReviewClauses }: { language: { document: DocLanguage; conversation: ChatLanguage | null; effective: ChatLanguage } | null; onLanguage(l: ChatLanguage | null): void; progress: Progress; onReviewDetails(): void; onReviewClauses(): void }) {
  const { confirmed, total, decisions } = progress;
  const left = total - confirmed;
  return (
    <div className="shrink-0 border-b border-line px-4 pb-3.5 pt-3 sm:px-5 [@media(max-height:560px)]:py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <BrandMark className="size-7 text-[17px]" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight text-ink">Assistant</p>
            <p className="text-[12.5px] leading-snug text-ink-3">
              {language ? `Replies in ${language.effective === "fr" ? "French" : "English"}. ${TEMPLATE_LANG[language.document] ?? ""}` : "Unavailable for this template"}
            </p>
          </div>
        </div>
        {language && (
          <div role="group" aria-label="Conversation language" title="Auto answers in the language you write in" className="flex shrink-0 rounded-control border border-line bg-subtle p-0.5">
            {LANGS.map((l) => {
              const on = language.conversation === l.value;
              return (
                <button key={l.label} type="button" aria-pressed={on} onClick={() => onLanguage(l.value)} className={`h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors duration-150 pointer-coarse:h-9 ${on ? "bg-surface text-ink shadow-sm ring-1 ring-line dark:bg-raised" : "text-ink-2 hover:text-ink"}`}>
                  {l.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* On short screens (phones held sideways) the header status and the Details tab carry the progress. */}
      {total > 0 && (
        <div className="mt-3 [@media(max-height:560px)]:hidden">
          <div className="flex items-center gap-3">
            <div role="progressbar" aria-label="Required details confirmed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={confirmed} className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-(--ease-out)" style={{ width: `${(confirmed / total) * 100}%` }} />
            </div>
            <span className="text-[12.5px] font-medium tabular-nums text-ink-2">
              {confirmed} of {total}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
            <span>{left ? `${left} ${left === 1 ? "detail" : "details"} still to confirm.` : "All required details are confirmed."}</span>
            {left > 0 && (
              <button type="button" onClick={onReviewDetails} className="font-medium text-accent-ink underline-offset-2 hover:underline">
                Review details
              </button>
            )}
            {decisions > 0 && (
              <button type="button" onClick={onReviewClauses} className="font-medium text-warn underline-offset-2 hover:underline">
                {decisions} clause {decisions === 1 ? "decision" : "decisions"} pending
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
