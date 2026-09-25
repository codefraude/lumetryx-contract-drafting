import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  downloadDocx,
  fetchExportCheck,
  requestWordLink,
} from "@/features/documents/api";
import type { ExportCheck } from "@/features/documents/contracts/export-check";
import { useErrorText } from "@/i18n/error-text";
import type { ConfirmOptions } from "@/shared/ui/ConfirmDialog";

export type ExportAction = "download" | "word";

export type ExportNotice =
  | {
      kind: "failed";
      action: ExportAction;
      message: string;
    }
  | { kind: "word" };

interface Options {
  flush(): Promise<void>;
  confirm(warnings: string[], action: ExportAction): Promise<boolean>;
  onNotSaved(message: string): void;
  announce(text: string): void;
  ask(options: ConfirmOptions): Promise<boolean>;
}

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
  } catch {}
};

function follow(href: string, filename?: string) {
  const a = document.createElement("a");

  a.href = href;

  if (filename) {
    a.download = filename;
  }

  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function useExport(
  documentId: string,
  { flush, confirm, onNotSaved, announce, ask }: Options,
) {
  const t = useTranslations("export");
  const errorText = useErrorText();
  const [busy, setBusy] = useState<ExportAction | null>(null);
  const [notice, setNotice] = useState<ExportNotice | null>(null);

  useEffect(() => {
    if (notice?.kind !== "word") {
      return;
    }

    const timer = setTimeout(() => setNotice(null), 15_000);

    return () => clearTimeout(timer);
  }, [notice]);

  const checkLines = (check: ExportCheck | null): string[] => {
    if (!check) {
      return [t("check.failed")];
    }

    const list = (items: string[]) => {
      return items.join(", ");
    };

    return [
      check.outstanding.length
        ? t("check.outstanding", {
            count: check.outstanding.length,
            labels: list(check.outstanding),
          })
        : "",
      check.unclear.length
        ? t("check.unclear", { labels: list(check.unclear) })
        : "",
      check.placeholders.length
        ? t("check.placeholders", { items: list(check.placeholders) })
        : "",
      check.leftBlank.length
        ? t("check.leftBlank", { labels: list(check.leftBlank) })
        : "",
    ].filter(Boolean);
  };

  async function run(action: ExportAction, warnings: string[]) {
    setNotice(null);

    try {
      await flush();
    } catch {
      onNotSaved(t("notSaved", { action }));

      return;
    }

    const check = await fetchExportCheck(documentId).catch(() => null);
    const all = [...checkLines(check), ...warnings];

    if (all.length && !(await confirm(all, action))) {
      return;
    }

    if (action === "word" && !introduced()) {
      const go = await ask({
        title: t("wordIntroTitle"),
        body: t("wordIntroBody"),
        confirm: t("openInWord"),
      });

      if (!go) {
        return;
      }

      remember();
    }

    setBusy(action);

    try {
      if (action === "download") {
        const { blob, filename } = await downloadDocx(documentId);
        const url = URL.createObjectURL(blob);

        follow(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        announce(t("downloaded", { filename }));
      } else {
        follow(`ms-word:ofv|u|${(await requestWordLink(documentId)).url}`);
        setNotice({ kind: "word" });
      }
    } catch (e) {
      setNotice({
        kind: "failed",
        action,
        message: errorText(e),
      });
    } finally {
      setBusy(null);
    }
  }

  return {
    download: (warnings: string[]) => run("download", warnings),
    openInWord: (warnings: string[]) => run("word", warnings),
    retry: (warnings: string[]) =>
      notice?.kind === "failed"
        ? run(notice.action, warnings)
        : Promise.resolve(),
    busy,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
