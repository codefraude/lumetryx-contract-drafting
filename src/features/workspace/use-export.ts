import { useState } from "react";
import { downloadDocx } from "@/features/documents/api";
import { errorMessage } from "@/lib/http";

interface Options {
  /** Saves pending editor edits: the download is the saved working draft. */
  flush(): Promise<void>;
  /** Asks before exporting a draft with open issues; resolves true to go ahead. */
  confirm(warnings: string[]): Promise<boolean>;
  onNotSaved(message: string): void;
  announce(text: string): void;
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Download of the working draft, including an edit made just before clicking. */
export function useDownload(documentId: string, { flush, confirm, onNotSaved, announce }: Options) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(warnings: string[]) {
    setError(null);
    try {
      await flush();
    } catch {
      onNotSaved("Your latest edit is not saved yet, so the download would miss it. Retry saving first.");
      return;
    }
    if (warnings.length && !(await confirm(warnings))) return;
    setDownloading(true);
    try {
      const { blob, filename } = await downloadDocx(documentId);
      saveFile(blob, filename);
      announce(`Downloaded ${filename}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  return { download, downloading, error, dismissError: () => setError(null) };
}
