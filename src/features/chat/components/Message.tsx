"use client";

import { CircleCheck, Info } from "lucide-react";
import { Fragment, memo } from "react";
import { Callout, StatusText } from "@/shared/ui/Status";
import { boldSpans, messageBlocks } from "../format";
import type { ChatMessage } from "../use-chat-turn";

function Inline({ text }: { text: string }) {
  return (
    <>
      {boldSpans(text).map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold">
            {s.text}
          </strong>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Paragraphs and lists. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {messageBlocks(text).map((b, i) => {
        if (b.kind === "p")
          return (
            <p key={i}>
              {b.lines.map((l, k) => (
                <Fragment key={k}>
                  {k > 0 && <br />}
                  <Inline text={l} />
                </Fragment>
              ))}
            </p>
          );
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-3`}>
            {b.items.map((it, k) => (
              <li key={k} className="pl-0.5">
                <Inline text={it} />
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
      <Callout tone="warn" icon={Info} role="note" className="text-ui">
        {m.content}
      </Callout>
    );
  if (m.role === "user")
    return (
      <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-card border border-line bg-subtle px-3.5 py-2 text-body text-ink">
        <span className="sr-only">You said: </span>
        {m.content}
      </div>
    );
  return (
    <div className="break-words text-body leading-relaxed text-ink">
      <span className="sr-only">Assistant: </span>
      {m.content ? (
        <div className="space-y-2.5">
          <Rich text={m.content} />
        </div>
      ) : m.streaming ? (
        <Thinking />
      ) : null}
      {m.updated ? (
        <StatusText tone="ok" icon={CircleCheck} className="mt-2">
          {m.updated} {m.updated === 1 ? "detail" : "details"} updated
        </StatusText>
      ) : null}
    </div>
  );
});
