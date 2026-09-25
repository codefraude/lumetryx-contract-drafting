"use client";

import { ArrowUp, Info } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/shared/ui/Button";

interface Props {
  busy: boolean;
  disabledReason: string | null;
  /**
   * Resolves false when the message was not
   * sent at all, so the box keeps the text.
   */
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  onSubmitted(): void;
}

export function Composer({
  busy,
  disabledReason,
  onSend,
  onStop,
  onSubmitted,
}: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = area.current;

    if (!el) {
      return;
    }

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = async () => {
    const t = text.trim();

    if (!t || busy || disabledReason) {
      return;
    }

    setText("");
    onSubmitted();

    // A message that was never sent (for example, an
    // unsaved edit blocked it) goes back into the box.
    if (!(await onSend(t))) {
      setText((current) => current || t);
    }
  };

  const off = Boolean(disabledReason);

  return (
    <form
      className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {disabledReason && (
        <p className="mb-2 flex items-start gap-2 px-1 text-meta text-ink-2">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {disabledReason}
        </p>
      )}
      <div
        className={`flex items-end gap-2 rounded-card border bg-surface p-1.5 pl-3.5 transition-[border-color,box-shadow] duration-150 dark:bg-raised ${off ? "border-line opacity-70" : "border-control focus-within:border-accent-ink focus-within:ring-1 focus-within:ring-accent-ink"}`}
      >
        <label htmlFor="composer" className="sr-only">
          Message the assistant
        </label>
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
            // Enter sends and Shift+Enter adds a line,
            // but not while an IME is composing.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent py-2 text-body leading-6 text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
        />
        {busy ? (
          <Button
            variant="secondary"
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
            className="size-9 px-0! pointer-coarse:size-11"
          >
            <span aria-hidden className="size-3 rounded-[3px] bg-current" />
          </Button>
        ) : (
          <IconButton
            type="submit"
            label="Send message"
            icon={ArrowUp}
            variant="primary"
            disabled={!text.trim() || off}
          />
        )}
      </div>
      <p
        id="composer-hint"
        className="mt-1.5 hidden px-1 text-meta text-ink-3 sm:block [@media(max-height:680px)]:hidden"
      >
        <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line.
        Write in English or French.
      </p>
    </form>
  );
}
