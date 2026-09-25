import { useEffect, useState } from "react";
import { downloadDocx, requestWordLink } from "@/features/documents/api";
import { errorMessage } from "@/lib/http";
import type { ConfirmOptions } from "@/shared/ui/ConfirmDialog";

export type ExportAction = "download" | "word";
/** What the last export left to say: it failed, or Word was asked to open the draft. */
export type ExportNotice = { kind: "failed"; action: ExportAction; message: string } | { kind: "word" };

interface Options {
  /** Saves pending editor edits: both exports are the saved working draft. */
  flush(): Promise<void>;
  /** Asks before exporting a draft with open issues; resolves true to go ahead. */
  confirm(warnings: string[], action: ExportAction): Promise<boolean>;
  onNotSaved(message: string): void;
  announce(text: string): void;
  /** The app's own confirmation dialog. */
  ask(options: ConfirmOptions): Promise<boolean>;
}

// The browser's own "open this app?" message cannot be replaced by a page, only allowed for good: the first
// time, the app's dialog says so. The flag is a UI preference only; nothing about the draft is stored.
const WORD_INTRO = "lx-word-intro";
const introduced = () => {
  try {
    return localStorage.getItem(WORD_INTRO) === "1";
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    localStorage.setItem(WORD_INTRO, "1");
  } catch {
    // Storage is blocked (private window): the dialog shows again next time.
  }
};

/** Follows a link as a click would, without leaving an element in the page. */
function follow(href: string, filename?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Exports of the working draft, including an edit made just before clicking: a download, or the draft opened in Word. */
export function useExport(documentId: string, { flush, confirm, onNotSaved, announce, ask }: Options) {
  const [busy, setBusy] = useState<ExportAction | null>(null);
  const [notice, setNotice] = useState<ExportNotice | null>(null);

  // The Word notice only explains what just happened, so it goes away by itself.
  useEffect(() => {
    if (notice?.kind !== "word") return;
    const timer = setTimeout(() => setNotice(null), 15_000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(action: ExportAction, warnings: string[]) {
    setNotice(null);
    try {
      await flush();
    } catch {
      onNotSaved(`Your latest edit is not saved yet, so ${action === "word" ? "Word" : "the download"} would miss it. Retry saving first.`);
      return;
    }
    if (warnings.length && !(await confirm(warnings, action))) return;
    if (action === "word" && !introduced()) {
      const go = await ask({
        title: "Open the draft in Word?",
        body: "Your browser then asks once whether this site may open Word. Tick the box that always allows it, and the next drafts open in Word straight away.",
        confirm: "Open in Word",
      });
      if (!go) return;
      remember();
    }
    setBusy(action);
    try {
      if (action === "download") {
        const { blob, filename } = await downloadDocx(documentId);
        const url = URL.createObjectURL(blob);
        follow(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        announce(`Downloaded ${filename}.`);
      } else {
        // Word's own URL scheme ("ofv" opens it for viewing): Word on this device fetches the link and opens its copy.
        follow(`ms-word:ofv|u|${(await requestWordLink(documentId)).url}`);
        // The notice is a live status region, so it is announced without a separate message.
        setNotice({ kind: "word" });
      }
    } catch (e) {
      setNotice({ kind: "failed", action, message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return {
    download: (warnings: string[]) => run("download", warnings),
    openInWord: (warnings: string[]) => run("word", warnings),
    retry: (warnings: string[]) => (notice?.kind === "failed" ? run(notice.action, warnings) : Promise.resolve()),
    busy,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
