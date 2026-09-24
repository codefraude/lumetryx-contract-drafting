import type { SavedRevision } from "../contracts/document-view";

export type SaveStatus = "loading" | "saved" | "unsaved" | "saving" | "error" | "conflict" | "viewing";

export interface SaveCoordinatorOptions {
  exportDocx(): Promise<Blob>;
  persist(revision: number, docx: Blob): Promise<SavedRevision>;
  onStatus(status: SaveStatus, message?: string): void;
  /** Called only after the server confirmed the exact revision that was sent. */
  onSaved(revision: number, savedAt: string): void;
  /** The save was refused because the draft changed elsewhere (another tab, or an answer update). */
  isConflict(error: unknown): boolean;
  debounceMs?: number;
  /** While someone types continuously the debounce keeps resetting; save at least this often. */
  maxWaitMs?: number;
}

/**
 * Autosave for one open document. Edits are coalesced; saves run one at a time, each based on the
 * revision the previous save returned, so an older response can never overwrite a newer revision
 * or mark later edits as saved. A failed save keeps the edits marked unsaved.
 */
export function createSaveCoordinator(options: SaveCoordinatorOptions) {
  const { exportDocx, persist, onStatus, onSaved, isConflict, debounceMs = 1500, maxWaitMs = 10_000 } = options;
  let revision = 0;
  let dirty = false;
  let firstDirtyAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | null = null;

  async function save(): Promise<void> {
    if (inflight) await inflight;
    if (!dirty) return;
    dirty = false;
    firstDirtyAt = null;
    onStatus("saving");
    const run = (async () => {
      try {
        const saved = await persist(revision, await exportDocx());
        revision = saved.workingRevision;
        onSaved(saved.workingRevision, saved.savedAt);
        // Edits typed while this save was in flight are not covered by it.
        onStatus(dirty ? "unsaved" : "saved");
      } catch (err) {
        dirty = true; // the edit is still in the editor
        if (isConflict(err)) onStatus("conflict", "This draft was changed elsewhere (another tab or an answer update). Reload the draft to continue.");
        else onStatus("error", err instanceof Error ? err.message : "Saving failed.");
        throw err;
      } finally {
        inflight = null;
      }
    })();
    inflight = run;
    await run;
  }

  return {
    /** The revision the editor was loaded from. */
    setRevision(value: number) {
      revision = value;
    },
    /** An edit was made: save after a pause in typing, or at once when edits have waited too long. */
    markDirty() {
      dirty = true;
      firstDirtyAt ??= Date.now();
      onStatus("unsaved");
      clearTimeout(timer);
      const overdue = Date.now() - firstDirtyAt >= maxWaitMs;
      timer = setTimeout(() => void save().catch(() => undefined), overdue ? 0 : debounceMs);
    },
    /** Resolves once every edit made so far is persisted; rejects if saving fails. */
    async flush() {
      clearTimeout(timer);
      timer = undefined;
      if (inflight) await inflight;
      if (dirty) await save();
    },
    /** Best effort (the tab is being hidden): a save started now usually completes. */
    saveSoon() {
      if (dirty) void save().catch(() => undefined);
    },
    hasPendingChanges: () => dirty || inflight !== null,
    dispose() {
      clearTimeout(timer);
    },
  };
}

export type SaveCoordinator = ReturnType<typeof createSaveCoordinator>;
