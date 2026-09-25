import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSaveCoordinator,
  type SaveStatus,
} from "@/features/documents/editor/save-coordinator";

function setup(opts: { conflict?: boolean } = {}) {
  const statuses: SaveStatus[] = [];
  const sent: {
    revision: number;
    content: string;
  }[] = [];
  const pending: {
    resolve(): void;
    reject(e: Error): void;
  }[] = [];
  let content = "v0";
  let serverRevision = 1;
  const saver = createSaveCoordinator({
    exportDocx: async () => new Blob([content]),
    persist: async (revision, docx) => {
      sent.push({
        revision,
        content: await docx.text(),
      });

      await new Promise<void>((resolve, reject) =>
        pending.push({
          resolve,
          reject,
        }),
      );

      if (opts.conflict) {
        throw Object.assign(new Error("stale"), { code: "stale" });
      }

      serverRevision = revision + 1;

      return {
        workingRevision: serverRevision,
        savedAt: "2026-09-24T10:00:00.000Z",
      };
    },
    onStatus: (s) => statuses.push(s),
    onSaved: () => undefined,
    isConflict: (e) => e instanceof Error && e.message === "stale",
    debounceMs: 100,
    maxWaitMs: 1000,
  });

  saver.setRevision(1);

  const edit = (next: string) => {
    content = next;
    saver.markDirty();
  };

  const answer = async () => {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()!.resolve();
  };

  return {
    saver,
    statuses,
    sent,
    pending,
    edit,
    answer,
  };
}

beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }),
);

afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("coalesces quick edits into one save after the pause", async () => {
    const { saver, sent, edit, answer } = setup();

    edit("a");
    edit("ab");
    edit("abc");
    await vi.advanceTimersByTimeAsync(150);
    await answer();
    await saver.flush();

    expect(sent).toEqual([
      {
        revision: 1,
        content: "abc",
      },
    ]);

    expect(saver.hasPendingChanges()).toBe(false);
  });

  it("never lets an older save mark a newer edit as saved, and saves it next on the new revision", async () => {
    const { saver, statuses, sent, edit, answer } = setup();

    edit("first");
    await vi.advanceTimersByTimeAsync(150);
    edit("second");
    await answer();
    await vi.waitFor(() => expect(statuses).toContain("unsaved"));
    expect(statuses.at(-1)).toBe("unsaved");
    const flushed = saver.flush();

    await answer();
    await flushed;

    expect(sent).toEqual([
      {
        revision: 1,
        content: "first",
      },
      {
        revision: 2,
        content: "second",
      },
    ]);

    expect(statuses.at(-1)).toBe("saved");
  });

  it("keeps edits unsaved when saving fails, and reports a conflict for a draft changed elsewhere", async () => {
    const { saver, statuses, edit, pending } = setup({ conflict: true });

    edit("mine");
    const flushed = saver.flush();

    await vi.waitFor(() => expect(pending.length).toBe(1));
    pending.shift()!.resolve();
    await expect(flushed).rejects.toThrow("stale");
    expect(statuses.at(-1)).toBe("conflict");
    expect(saver.hasPendingChanges()).toBe(true);
  });

  it("saves at least every maxWait while edits keep coming", async () => {
    const { sent, edit } = setup();

    for (let t = 0; t < 1100; t += 50) {
      edit(`typing ${t}`);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(sent.length).toBe(1);
  });
});
