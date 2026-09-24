"use client";

import { RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import type { Ref } from "react";
import { ComparePanel } from "@/features/comparison/components/ComparePanel";
import { DraftPreview, PaperSkeleton } from "@/features/documents/components/DraftPreview";
import type { DraftBlock } from "@/features/documents/contracts/stream-events";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import type { EditorHandle } from "@/features/documents/editor/SuperDocEditor";
import { Button } from "@/shared/ui/Button";
import { TabBar } from "@/shared/ui/TabBar";
import { TabPanel } from "@/shared/ui/TabPanel";

// The editor is large; load it only when a document is on screen.
const SuperDocEditor = dynamic(() => import("@/features/documents/editor/SuperDocEditor").then((m) => m.SuperDocEditor), {
  ssr: false,
  loading: () => <PaperSkeleton />,
});

/** The template before a draft exists, the streamed preview while it is generated, then the editor. */
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
  /** Narrow screens show one region at a time; true while the assistant is in front. */
  hidden: boolean;
  editorRef: Ref<EditorHandle>;
  /** Changing it reloads the draft from the server (a new revision the server wrote). */
  editorKey: string;
  onEditorStatus(status: SaveStatus, message?: string): void;
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
  return (
    <main
      aria-label="Document"
      className={`flex min-h-0 min-w-0 flex-1 flex-col max-lg:absolute max-lg:inset-0 max-lg:transition-[opacity,visibility] max-lg:duration-200 ${hidden ? "max-lg:pointer-events-none max-lg:invisible max-lg:opacity-0" : ""}`}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2 sm:px-4">
        <TabBar<DocPane>
          idBase="doc"
          label="Document view"
          value={pane}
          onChange={onPane}
          className="min-w-0 flex-1 sm:max-w-[380px]"
          items={[
            { id: "document", label: hasDraft ? "Draft" : "Template" },
            {
              id: "compare",
              name: "Compare with template",
              disabled: generating,
              label: (
                <>
                  <span className="sm:hidden">Compare</span>
                  <span className="max-sm:hidden">Compare with template</span>
                </>
              ),
            },
          ]}
        />
        {hasDraft && !generating && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRegenerate} className="ml-auto">
            Regenerate
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
            <ComparePanel documentId={documentId} snapshot={snapshot} version={compareVersion} />
          </TabPanel>
        )}
      </div>
    </main>
  );
}
