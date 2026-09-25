"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import "superdoc/style.css";
import { ApiError } from "@/lib/http";
import { Button } from "@/shared/ui/Button";
import { loadDocx, saveDocx } from "../api";
import { PaperSkeleton } from "../components/DraftPreview";
import {
  createSaveCoordinator,
  type SaveCoordinator,
  type SaveStatus,
} from "./save-coordinator";

export type { SaveStatus };

export interface EditorHandle {
  flush(): Promise<void>;
  snapshot(): Promise<Blob | null>;
}

interface Props {
  documentId: string;
  filename: string;
  source: "working" | "original";
  loadKey: string;
  onStatus(status: SaveStatus, message?: string): void;
  onSaved?(revision: number, savedAt: string): void;
}

type SuperDocInstance = import("superdoc").SuperDoc;

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIT_WIDTH = "(max-width: 899px)";

export const SuperDocEditor = memo(
  forwardRef<EditorHandle, Props>(function SuperDocEditor(
    { documentId, filename, source, loadKey, onStatus, onSaved },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const toolbar = useRef<HTMLDivElement>(null);
    const sd = useRef<SuperDocInstance | null>(null);
    const saver = useRef<SaveCoordinator | null>(null);
    const ready = useRef(false);
    const statusRef = useRef(onStatus);

    statusRef.current = onStatus;
    const savedRef = useRef(onSaved);

    savedRef.current = onSaved;
    const editable = source === "working";
    const [attempt, setAttempt] = useState(0);
    const loadId = `${loadKey}:${attempt}`;
    const [readyId, setReadyId] = useState<string | null>(null);
    const [failure, setFailure] = useState<{
      id: string;
      message: string;
    } | null>(null);
    const [fit, setFit] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        async flush() {
          await saver.current?.flush();
        },
        async snapshot() {
          if (!sd.current || !ready.current || !editable) {
            return null;
          }

          return sd.current.export({
            exportType: ["docx"],
            triggerDownload: false,
          });
        },
      }),
      [editable],
    );

    useEffect(() => {
      let cancelled = false;

      ready.current = false;
      const coordinator = editable
        ? createSaveCoordinator({
            exportDocx: async () => {
              if (!sd.current) {
                throw new Error("The editor is not ready.");
              }

              return sd.current.export({
                exportType: ["docx"],
                triggerDownload: false,
              });
            },
            persist: (revision, docx) => saveDocx(documentId, revision, docx),
            onStatus: (status, message) => statusRef.current(status, message),
            onSaved: (revision, savedAt) =>
              savedRef.current?.(revision, savedAt),
            isConflict: (err) =>
              err instanceof ApiError && err.code === "stale",
          })
        : null;

      saver.current = coordinator;
      statusRef.current("loading");

      (async () => {
        try {
          const [{ SuperDoc }, loaded] = await Promise.all([
            import("superdoc"),
            loadDocx(documentId, source),
          ]);

          if (cancelled || !host.current || !toolbar.current) {
            return;
          }

          coordinator?.setRevision(loaded.revision);
          host.current.innerHTML = "";
          toolbar.current.innerHTML = "";
          const instance = new SuperDoc({
            selector: host.current,
            document: new File([loaded.blob], filename, { type: DOCX }),
            documentMode: editable ? "editing" : "viewing",
            zoom: {
              mode: window.matchMedia(FIT_WIDTH).matches
                ? "fit-width"
                : "manual",
              fitWidth: { max: 100 },
            },
            telemetry: { enabled: false },
            uiDisplayFallbackFont:
              'var(--font-ui), "Segoe UI", Arial, sans-serif',
            ui: {
              comments: false,
              toolbar: editable
                ? {
                    container: toolbar.current,
                    items: {
                      left: ["undo", "redo"],
                      center: [
                        "linked-style",
                        "bold",
                        "italic",
                        "underline",
                        "bullet-list",
                        "numbered-list",
                        "indent-decrease",
                        "indent-increase",
                        "table",
                        "table-actions",
                      ],
                      right: ["zoom"],
                    },
                  }
                : false,
            },
            onReady: () => {
              ready.current = true;
              setReadyId(loadId);
              statusRef.current(editable ? "saved" : "viewing");
            },
            onEditorUpdate: () => {
              if (ready.current) {
                coordinator?.markDirty();
              }
            },
            onException: ({ error }: { error: unknown }) =>
              statusRef.current(
                "error",
                error instanceof Error
                  ? error.message
                  : "The editor reported a problem.",
              ),
          });

          sd.current = instance;
        } catch (err) {
          if (cancelled) {
            return;
          }

          const message =
            err instanceof Error ? err.message : "Could not open the document.";

          setFailure({
            id: loadId,
            message,
          });

          statusRef.current("error", message);
        }
      })();

      return () => {
        cancelled = true;
        coordinator?.dispose();
        sd.current?.destroy();
        sd.current = null;
      };
    }, [documentId, filename, source, loadId, editable]);

    useEffect(() => {
      const narrow = window.matchMedia(FIT_WIDTH);

      const apply = () => {
        setFit(narrow.matches);

        if (narrow.matches) {
          sd.current?.setZoomMode("fit-width");
        } else {
          sd.current?.setZoom(100);
        }
      };

      apply();
      narrow.addEventListener("change", apply);

      return () => narrow.removeEventListener("change", apply);
    }, []);

    useEffect(() => {
      const warn = (e: BeforeUnloadEvent) => {
        if (saver.current?.hasPendingChanges()) {
          e.preventDefault();
        }
      };

      const hidden = () => {
        if (document.visibilityState === "hidden") {
          saver.current?.saveSoon();
        }
      };

      window.addEventListener("beforeunload", warn);
      document.addEventListener("visibilitychange", hidden);

      return () => {
        window.removeEventListener("beforeunload", warn);
        document.removeEventListener("visibilitychange", hidden);
      };
    }, []);

    const failed = failure?.id === loadId ? failure : null;

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={toolbar}
          className={
            editable
              ? "shrink-0 overflow-x-auto border-b border-line bg-surface"
              : "hidden"
          }
          aria-label="Formatting toolbar"
        />
        <div className="relative min-h-0 flex-1">
          <div className="lx-doc h-full overflow-auto overscroll-contain bg-canvas px-2 py-5 sm:px-6 sm:py-8">
            <div
              ref={host}
              className={`mx-auto ${fit ? "lx-fit w-full" : readyId === loadId ? "w-fit" : "w-full"}`}
            />
          </div>
          {readyId !== loadId && !failed && (
            <div className="absolute inset-0">
              <PaperSkeleton />
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 grid place-items-center bg-canvas p-6">
              <div
                role="alert"
                className="max-w-sm rounded-card border border-danger-line bg-surface p-5 text-center"
              >
                <CircleAlert
                  aria-hidden
                  className="mx-auto size-6 text-danger"
                />
                <p className="mt-2 text-body font-semibold text-ink">
                  The document could not be opened
                </p>
                <p className="mt-1 text-ui text-ink-2">{failed.message}</p>
                <Button
                  variant="secondary"
                  icon={RotateCcw}
                  className="mt-4"
                  onClick={() => setAttempt((a) => a + 1)}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }),
);
