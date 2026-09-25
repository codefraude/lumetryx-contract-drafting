"use client";

import { ArrowDown, CircleAlert, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ActionFailure } from "@/lib/http";
import { Button } from "@/shared/ui/Button";
import { Callout } from "@/shared/ui/Status";
import type { ChatMessage } from "../use-chat-turn";
import { Composer } from "./Composer";
import { Message } from "./Message";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  error: ActionFailure | null;
  disabledReason: string | null;
  /**
   * Resolves false when the message was not sent
   * at all, so the composer keeps the text.
   */
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  onRetry(): void;
  header?: ReactNode;
  footer?: ReactNode;
}

const reducedMotion = () => {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

export function ChatPanel({
  messages,
  busy,
  error,
  disabledReason,
  onSend,
  onStop,
  onRetry,
  header,
  footer,
}: Props) {
  const list = useRef<HTMLDivElement>(null);
  /** Follow new content only while the reader is at the bottom. */
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const [seen, setSeen] = useState("");
  const last = messages.at(-1);
  const signature = `${messages.length}:${last?.content.length ?? 0}:${error ? 1 : 0}`;

  useLayoutEffect(() => {
    const el = list.current;

    // Instant, not smooth: a smooth scroll per
    // streamed token would fight the reader.
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [signature]);

  const onScroll = () => {
    const el = list.current;

    if (!el) {
      return;
    }

    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 64;

    stick.current = near;
    setAway(!near);

    if (near) {
      setSeen(signature);
    }
  };

  const jump = () => {
    stick.current = true;
    const el = list.current;

    el?.scrollTo({
      top: el.scrollHeight,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };

  const fresh = away && seen !== signature;

  return (
    <section aria-label="Assistant" className="flex h-full min-h-0 flex-col">
      {header}
      <div className="relative min-h-0 flex-1">
        <div
          ref={list}
          onScroll={onScroll}
          aria-label="Conversation"
          role="region"
          className="relative h-full space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
        >
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {error && (
            <Callout
              tone="danger"
              role="alert"
              icon={CircleAlert}
              actions={
                error.retryable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={RotateCcw}
                    onClick={onRetry}
                  >
                    Retry
                  </Button>
                )
              }
            >
              {error.message}
            </Callout>
          )}
        </div>
        {away && (
          <button
            type="button"
            onClick={jump}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-control border border-line bg-raised px-3 py-1.5 text-meta font-medium text-ink shadow-overlay transition-colors duration-150 hover:bg-hover pointer-coarse:min-h-11"
          >
            <ArrowDown aria-hidden className="size-3.5" />
            Jump to latest
            {fresh && (
              <>
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-accent-ink"
                />
                <span className="sr-only">(new messages)</span>
              </>
            )}
          </button>
        )}
      </div>
      {footer}
      <Composer
        busy={busy}
        disabledReason={disabledReason}
        onSend={onSend}
        onStop={onStop}
        onSubmitted={() => (stick.current = true)}
      />
    </section>
  );
}
