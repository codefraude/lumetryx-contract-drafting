"use client";

import { RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { ComparePanel } from "@/features/comparison/components/ComparePanel";
import {
  DraftPreview,
  PaperSkeleton,
} from "@/features/documents/components/DraftPreview";
import type { DraftBlock } from "@/features/documents/contracts/stream-events";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import type { EditorHandle } from "@/features/documents/editor/SuperDocEditor";
import { Button } from "@/shared/ui/Button";
import { TabBar } from "@/shared/ui/TabBar";
import { TabPanel } from "@/shared/ui/TabPanel";

const SuperDocEditor = dynamic(
  () =>
    import("@/features/documents/editor/SuperDocEditor").then(
      (m) => m.SuperDocEditor,
    ),
  {
    ssr: false,
    loading: () => <PaperSkeleton />,
  },
);

export type DocMode = "template" | "preview" | "editor";
export type DocPane = "document" | "compare";

interface Props {
  documentId: string;
  filename: string;
  mode: DocMode;
  hasDraft: boolean;
  generating: boolean;
  blocks: DraftBlock[];
  pane: DocPane;
  onPane(pane: DocPane): void;
  hidden: boolean;
  editorRef: Ref<EditorHandle>;
  editorKey: string;
  onEditorStatus(status: SaveStatus, error?: unknown): void;
  onEditorSaved(revision: number, savedAt: string): void;
  snapshot(): Promise<Blob | null>;
  compareVersion: string;
  onRegenerate(): void;
}

export function DocumentPane({
  documentId,
  filename,
  mode,
  hasDraft,
  generating,
  blocks,
  pane,
  onPane,
  hidden,
  editorRef,
  editorKey,
  onEditorStatus,
  onEditorSaved,
  snapshot,
  compareVersion,
  onRegenerate,
}: Props) {
  const t = useTranslations("documentPane");
  const tCommon = useTranslations("common");

  return (
    <main
      aria-label={t("label")}
      className={`flex min-h-0 min-w-0 flex-1 flex-col max-lg:absolute max-lg:inset-0 max-lg:transition-[opacity,visibility] max-lg:duration-200 ${hidden ? "max-lg:pointer-events-none max-lg:invisible max-lg:opacity-0" : ""}`}
    >
      <div className="flex shrink-0 items-end gap-3 border-b border-line bg-surface px-2 sm:px-3">
        <TabBar<DocPane>
          idBase="doc"
          label={t("views")}
          value={pane}
          onChange={onPane}
          items={[
            {
              id: "document",
              label: hasDraft ? t("draft") : t("template"),
            },
            {
              id: "compare",
              name: t("compareWithTemplate"),
              disabled: generating,
              label: (
                <>
                  <span className="sm:hidden">{t("compare")}</span>
                  <span className="max-sm:hidden">
                    {t("compareWithTemplate")}
                  </span>
                </>
              ),
            },
          ]}
        />
        {hasDraft && !generating && (
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={onRegenerate}
            className="ml-auto self-center"
          >
            {tCommon("regenerate")}
          </Button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <TabPanel base="doc" id="document" active={pane === "document"}>
          {mode === "preview" ? (
            <DraftPreview blocks={blocks} generating={generating} />
          ) : (
            <SuperDocEditor
              ref={editorRef}
              documentId={documentId}
              filename={filename}
              source={mode === "editor" ? "working" : "original"}
              loadKey={mode === "editor" ? editorKey : `${documentId}:original`}
              onStatus={onEditorStatus}
              onSaved={onEditorSaved}
            />
          )}
        </TabPanel>
        {pane === "compare" && (
          <TabPanel base="doc" id="compare" active>
            <ComparePanel
              documentId={documentId}
              snapshot={snapshot}
              version={compareVersion}
            />
          </TabPanel>
        )}
      </div>
    </main>
  );
}
