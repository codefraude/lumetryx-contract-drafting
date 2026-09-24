"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirm: string;
  cancel?: string;
  tone?: "primary" | "danger";
}
type Request = ConfirmOptions & { resolve(ok: boolean): void; open: boolean };

/** A themed replacement for window.confirm. Render `dialog` once; `ask()` resolves true on confirm. */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...o, resolve, open: true })), []);
  const finish = useCallback((ok: boolean) => {
    setRequest((r) => {
      r?.resolve(ok);
      return r && { ...r, open: false };
    });
  }, []);
  return [<ConfirmDialog key="confirm" request={request} onFinish={finish} />, ask];
}

function ConfirmDialog({ request, onFinish }: { request: Request | null; onFinish(ok: boolean): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = Boolean(request?.open);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Destructive confirmations start on Cancel, others on the confirm action.
      d.querySelector<HTMLElement>("[data-default]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const danger = request?.tone === "danger";
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => onFinish(false)}
      className="lx-dialog m-auto w-[min(440px,calc(100vw-32px))] rounded-card border border-line bg-raised p-0 text-ink shadow-lg"
    >
      {request && (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="text-[17px] font-semibold leading-snug text-ink">
            {request.title}
          </h2>
          {request.body && <div className="mt-2 text-sm leading-relaxed text-ink-2">{request.body}</div>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" data-default={danger ? "" : undefined} onClick={() => onFinish(false)}>
              {request.cancel ?? "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} data-default={danger ? undefined : ""} onClick={() => onFinish(true)}>
              {request.confirm}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
