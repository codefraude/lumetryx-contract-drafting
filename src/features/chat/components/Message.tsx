"use client";

import { CircleCheck, Info } from "lucide-react";
import { Fragment, memo } from "react";
import { BrandMark } from "@/shared/ui/BrandMark";
import { boldSpans, messageBlocks } from "../format";
import type { ChatMessage } from "../use-chat-turn";

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
export const Message = memo(function Message({ m }: { m: ChatMessage }) {
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
