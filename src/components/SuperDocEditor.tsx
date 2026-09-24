"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import "superdoc/style.css";
import { api, ApiError } from "@/lib/client/api";
import { PaperSkeleton } from "./DraftPreview";
import { Button } from "./ui";

export type SaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error" | "conflict" | "viewing";

export interface EditorHandle {
  /** Resolves once every edit made so far is persisted. Rejects if saving fails. */
  flush(): Promise<void>;
  /** The editor's current content as DOCX, without saving it (for Compare and "save as a new draft"). */
  snapshot(): Promise<Blob | null>;
}

interface Props {
  documentId: string;
  filename: string;
  source: "working" | "original";
  /** Changing this reloads the document from the server. */
  loadKey: string;
  onStatus(status: SaveStatus, message?: string): void;
  /** Called only after the server confirmed the exact revision that was sent. */
  onSaved?(revision: number, savedAt: string): void;
}

type SuperDocInstance = import("superdoc").SuperDoc;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SAVE_DEBOUNCE_MS = 1500;
/** While someone types continuously the debounce keeps resetting; save at least this often. */
const SAVE_MAX_WAIT_MS = 10_000;

/** Memoised with stable callbacks from the parent, so streamed chat updates never re-render the editor. */
export const SuperDocEditor = memo(forwardRef<EditorHandle, Props>(function SuperDocEditor({ documentId, filename, source, loadKey, onStatus, onSaved }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const sd = useRef<SuperDocInstance | null>(null);
  const rev = useRef(0);
  const dirty = useRef(false);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  const firstDirtyAt = useRef<number | null>(null);
  const editable = source === "working";
  const [attempt, setAttempt] = useState(0);
  const loadId = `${loadKey}:${attempt}`;
  const [readyId, setReadyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const save = useCallback(async () => {
    if (!sd.current || !editable) return;
    if (inflight.current) await inflight.current;
    if (!dirty.current) return;
    dirty.current = false;
    firstDirtyAt.current = null;
    statusRef.current("saving");
    const run = (async () => {
      try {
        const blob = await sd.current!.export({ exportType: ["docx"], triggerDownload: false });
        const res = await api.saveDocx(documentId, rev.current, blob);
        rev.current = res.workingRevision;
        savedRef.current?.(res.workingRevision, res.savedAt);
        // Edits typed while this save was in flight are not covered by it.
        statusRef.current(dirty.current ? "unsaved" : "saved");
      } catch (err) {
        dirty.current = true; // keep the edit marked unsaved; it is still in the editor
        if (err instanceof ApiError && err.code === "stale") statusRef.current("conflict", "This draft was changed elsewhere (another tab or an answer update). Reload the draft to continue.");
        else statusRef.current("error", err instanceof Error ? err.message : "Saving failed.");
        throw err;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    await run;
  }, [documentId, editable]);

  useImperativeHandle(ref, () => ({
    async flush() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (inflight.current) await inflight.current;
      if (dirty.current) await save();
    },
    async snapshot() {
      if (!sd.current || !ready.current || !editable) return null;
      return sd.current.export({ exportType: ["docx"], triggerDownload: false });
    },
  }), [save, editable]);

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    dirty.current = false;
    statusRef.current("loading");
    (async () => {
      try {
        const [{ SuperDoc }, loaded] = await Promise.all([import("superdoc"), api.loadDocx(documentId, source)]);
        if (cancelled || !host.current || !toolbar.current) return;
        rev.current = loaded.revision;
        host.current.innerHTML = "";
        toolbar.current.innerHTML = "";
        const instance = new SuperDoc({
          selector: host.current,
          document: new File([loaded.blob], filename, { type: DOCX }),
          documentMode: editable ? "editing" : "viewing",
          // SuperDoc sends a document-open event to its own endpoint by default; client documents stay private.
          telemetry: { enabled: false },
          // Editor chrome (toolbar, menus, loader) in the app font; document text keeps its own fonts.
          uiDisplayFallbackFont: 'var(--font-ui), "Segoe UI", Arial, sans-serif',
          ui: {
            comments: false,
            // Only controls we rely on and have exercised; every exposed action is a real editor command.
            toolbar: editable
              ? { container: toolbar.current, items: { left: ["undo", "redo"], center: ["linked-style", "bold", "italic", "underline", "bullet-list", "numbered-list", "indent-decrease", "indent-increase", "table", "table-actions"], right: ["zoom"] } }
              : false,
          },
          onReady: () => {
            ready.current = true;
            setReadyId(loadId);
            statusRef.current(editable ? "saved" : "viewing");
          },
          onEditorUpdate: () => {
            if (!ready.current || !editable) return;
            dirty.current = true;
            firstDirtyAt.current ??= Date.now();
            statusRef.current("unsaved");
            if (timer.current) clearTimeout(timer.current);
            const overdue = Date.now() - firstDirtyAt.current >= SAVE_MAX_WAIT_MS;
            timer.current = setTimeout(() => void save().catch(() => undefined), overdue ? 0 : SAVE_DEBOUNCE_MS);
          },
          onException: ({ error }: { error: unknown }) => statusRef.current("error", error instanceof Error ? error.message : "The editor reported a problem."),
        });
        sd.current = instance;
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not open the document.";
        setFailure({ id: loadId, message });
        statusRef.current("error", message);
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      sd.current?.destroy();
      sd.current = null;
    };
  }, [documentId, filename, source, loadId, editable, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || inflight.current) e.preventDefault();
    };
    // Best effort only: a save started when the tab is hidden usually completes, but nothing
    // guarantees it if the browser is closed abruptly. Earlier acknowledged saves are durable.
    const hidden = () => {
      if (document.visibilityState === "hidden" && dirty.current) void save().catch(() => undefined);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [save]);

  const failed = failure?.id === loadId ? failure : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={toolbar} className={editable ? "shrink-0 overflow-x-auto border-b border-line bg-surface" : "hidden"} aria-label="Formatting toolbar" />
      <div className="relative min-h-0 flex-1">
        {/* The desk around the page: it scrolls on its own, so a narrow screen keeps the true page size. */}
        <div className="lx-doc h-full overflow-auto overscroll-contain bg-canvas px-2 py-5 sm:px-6 sm:py-8">
          {/* Shrink-to-fit once pages exist, so the page is centred on the desk (a wider page scrolls in the canvas).
              Full width while opening: the host is still empty, and SuperDoc's loading card takes its width from it. */}
          <div ref={host} className={`mx-auto ${readyId === loadId ? "w-fit" : "w-full"}`} />
        </div>
        {readyId !== loadId && !failed && (
          <div className="absolute inset-0">
            <PaperSkeleton />
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 grid place-items-center bg-canvas p-6">
            <div role="alert" className="max-w-sm rounded-card border border-danger-line bg-surface p-5 text-center shadow-md">
              <CircleAlert aria-hidden className="mx-auto size-6 text-danger" />
              <p className="mt-2 text-[15px] font-semibold text-ink">The document could not be opened</p>
              <p className="mt-1 text-sm text-ink-2">{failed.message}</p>
              <Button variant="secondary" icon={RotateCcw} className="mt-4" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}));
