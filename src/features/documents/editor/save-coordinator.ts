import type { SavedRevision } from "../contracts/document-view";

export type SaveStatus =
  "loading" | "saved" | "unsaved" | "saving" | "error" | "conflict" | "viewing";

export interface SaveCoordinatorOptions {
  exportDocx(): Promise<Blob>;
  persist(revision: number, docx: Blob): Promise<SavedRevision>;
  onStatus(status: SaveStatus, message?: string): void;
  onSaved(revision: number, savedAt: string): void;
  isConflict(error: unknown): boolean;
  debounceMs?: number;
  maxWaitMs?: number;
}

export function createSaveCoordinator(options: SaveCoordinatorOptions) {
  const {
    exportDocx,
    persist,
    onStatus,
    onSaved,
    isConflict,
    debounceMs = 1500,
    maxWaitMs = 10_000,
  } = options;
  let revision = 0;
  let dirty = false;
  let firstDirtyAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | null = null;

  async function save(): Promise<void> {
    if (inflight) {
      await inflight;
    }

    if (!dirty) {
      return;
    }

    dirty = false;
    firstDirtyAt = null;
    onStatus("saving");
    const run = (async () => {
      try {
        const saved = await persist(revision, await exportDocx());

        revision = saved.workingRevision;
        onSaved(saved.workingRevision, saved.savedAt);
        onStatus(dirty ? "unsaved" : "saved");
      } catch (err) {
        dirty = true;

        if (isConflict(err)) {
          onStatus(
            "conflict",
            "This draft was changed elsewhere (another tab or an answer update). Reload the draft to continue.",
          );
        } else {
          onStatus(
            "error",
            err instanceof Error ? err.message : "Saving failed.",
          );
        }

        throw err;
      } finally {
        inflight = null;
      }
    })();

    inflight = run;
    await run;
  }

  return {
    setRevision(value: number) {
      revision = value;
    },
    markDirty() {
      dirty = true;
      firstDirtyAt ??= Date.now();
      onStatus("unsaved");
      clearTimeout(timer);
      const overdue = Date.now() - firstDirtyAt >= maxWaitMs;

      timer = setTimeout(
        () => void save().catch(() => undefined),
        overdue ? 0 : debounceMs,
      );
    },
    async flush() {
      clearTimeout(timer);
      timer = undefined;

      if (inflight) {
        await inflight;
      }

      if (dirty) {
        await save();
      }
    },
    saveSoon() {
      if (dirty) {
        void save().catch(() => undefined);
      }
    },
    hasPendingChanges: () => dirty || inflight !== null,
    dispose() {
      clearTimeout(timer);
    },
  };
}

export type SaveCoordinator = ReturnType<typeof createSaveCoordinator>;
