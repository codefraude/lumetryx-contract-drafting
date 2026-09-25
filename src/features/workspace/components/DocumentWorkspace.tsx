"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useChatTurn } from "@/features/chat/use-chat-turn";
import { copyDocument } from "@/features/documents/api";
import type { DocumentView, RuleAction } from "@/features/documents/contracts/document-view";
import type { EditorHandle, SaveStatus } from "@/features/documents/editor/SuperDocEditor";
import { documentQuery, patchDocument, useRuleAction } from "@/features/documents/queries";
import { useDraftGeneration } from "@/features/documents/use-draft-generation";
import { errorMessage } from "@/lib/http";
import { useConfirm } from "@/shared/ui/ConfirmDialog";
import { Count } from "@/shared/ui/Status";
import type { TabItem } from "@/shared/ui/TabBar";
import { useExport } from "../use-export";
import { clockTime, documentProgress, exportWarnings, statusLine } from "../workspace-status";
import { AssistantPane, type AssistantView } from "./AssistantPane";
import { DocumentPane, type DocMode, type DocPane } from "./DocumentPane";
import { ViewSwitcher } from "./ViewSwitcher";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { NextStep, SaveBanner } from "./WorkspaceNotices";

export interface DocumentWorkspaceHandle {
  /** Saves pending editor edits before leaving this draft; asks before discarding them if saving fails. */
  leave(): Promise<boolean>;
}

interface Props {
  doc: DocumentView;
  onShowDrafts(): void;
  /** Back to the choice of a template (this draft stays saved). */
  onClose(): void;
  /** Show another draft (a copy of this one, or a newer version of it). */
  onOpenDocument(view: DocumentView): void;
  announce(text: string): void;
}

/**
 * One open draft. It is mounted per draft (and per reload of it), so the conversation, the editor and
 * the views start from that draft's saved state, and a stream still running for it stops when it is left.
 */
export const DocumentWorkspace = forwardRef<DocumentWorkspaceHandle, Props>(function DocumentWorkspace(
  { doc, onShowDrafts, onClose, onOpenDocument, announce },
  ref,
) {
  const queryClient = useQueryClient();
  const editor = useRef<EditorHandle>(null);
  const [save, setSave] = useState<{ status: SaveStatus; message?: string }>({ status: "loading" });
  // Changes only when the server wrote a new revision of the draft; the editor then reloads it.
  const [editorKey, setEditorKey] = useState(`${doc.id}:${doc.workingRevision}`);
  const [view, setView] = useState<AssistantView>("chat");
  const [docInFront, setDocInFront] = useState(false);
  const [pane, setPane] = useState<DocPane>("document");
  const [confirmDialog, ask] = useConfirm();

  // A reply or generation still streaming after this draft was closed finishes for it, silently.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const say = useCallback((text: string) => mounted.current && announce(text), [announce]);

  const hasDraft = doc.draftStatus === "ready";
  const reloadEditor = useCallback((revision: number) => setEditorKey(`${doc.id}:${revision}`), [doc.id]);
  const flush = useCallback(async () => {
    await editor.current?.flush();
  }, []);

  const chat = useChatTurn(doc.id, doc.messages, { beforeSend: flush, onDraftReplaced: reloadEditor, announce: say });
  const generation = useDraftGeneration(doc.id, {
    onCompleted: reloadEditor,
    onFailed: () => {
      setView("chat");
      setDocInFront(false);
    },
    announce: say,
  });
  const { mutateAsync: applyRule } = useRuleAction(doc.id, { beforeAction: flush, onDraftReplaced: reloadEditor });
  const exporter = useExport(doc.id, {
    flush,
    confirm: (warnings, action) =>
      ask({
        title: action === "word" ? "Before you open it in Word" : "Before you download",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ),
        confirm: action === "word" ? "Open anyway" : "Download anyway",
        cancel: "Review first",
      }),
    onNotSaved: (message) => setSave({ status: "error", message }),
    announce: say,
  });
  const copy = useMutation({
    mutationFn: async () => copyDocument(doc.id, (await editor.current?.snapshot()) ?? null),
    onSuccess: (copied) => {
      onOpenDocument(copied);
      say("Your version was saved as a new draft.");
    },
    onError: (e) => setSave({ status: "error", message: errorMessage(e) }),
  });

  const leave = useCallback(async () => {
    try {
      await editor.current?.flush();
      return true;
    } catch {
      return ask({
        title: "Your latest edits could not be saved",
        body: "Leave this draft anyway? The edits made since the last save will be lost.",
        confirm: "Leave without saving",
        cancel: "Stay here",
        tone: "danger",
      });
    }
  }, [ask]);
  useImperativeHandle(ref, () => ({ leave }), [leave]);

  // Stable handlers keep the memoised panels and the editor from re-rendering on every streamed token.
  const onEditorStatus = useCallback((status: SaveStatus, message?: string) => setSave({ status, message }), []);
  const onEditorSaved = useCallback(
    (revision: number, savedAt: string) => patchDocument(queryClient, doc.id, (d) => ({ ...d, workingRevision: revision, savedAt })),
    [queryClient, doc.id],
  );
  const onRuleAction = useCallback((ruleId: string, action: RuleAction) => applyRule({ ruleId, action }), [applyRule]);
  const mode: DocMode = generation.generating ? "preview" : hasDraft ? "editor" : "template";
  const snapshot = useCallback(async () => (mode === "editor" ? ((await editor.current?.snapshot()) ?? null) : null), [mode]);
  const inactive = useMemo(() => new Set(doc.inactiveFieldIds), [doc.inactiveFieldIds]);

  const progress = documentProgress(doc, inactive);
  const shown: AssistantView = view === "clauses" && !progress.hasClauses ? "chat" : view;
  const tabs: TabItem<AssistantView>[] = [
    { id: "chat", label: "Chat" },
    {
      id: "details",
      label: "Details",
      name: `Details, ${progress.confirmed} of ${progress.total} confirmed`,
      badge: progress.total ? <Count>{`${progress.confirmed}/${progress.total}`}</Count> : undefined,
    },
    ...(progress.hasClauses
      ? [
          {
            id: "clauses" as const,
            label: "Clauses",
            name: progress.attention ? `Clauses, ${progress.attention} need attention` : "Clauses",
            badge: progress.attention ? <Count tone="warn">{progress.attention}</Count> : undefined,
          },
        ]
      : []),
  ];

  const startGeneration = async () => {
    if (
      hasDraft &&
      !(await ask({
        title: "Regenerate the draft?",
        body: "The draft is rebuilt from the template with your current answers. Edits you made in the editor are replaced.",
        confirm: "Regenerate",
        tone: "danger",
      }))
    )
      return;
    chat.clearFailure();
    setPane("document");
    setDocInFront(true);
    await generation.generate();
  };
  // One failure is shown at a time, with the retry that belongs to it.
  const failure = generation.failure ?? chat.failure;
  const retry = generation.failure ? () => void startGeneration() : chat.retry;
  const loadNewer = () =>
    void queryClient
      .fetchQuery({ ...documentQuery(doc.id), staleTime: 0 })
      .then(onOpenDocument, (e: unknown) => setSave({ status: "conflict", message: errorMessage(e) }));
  const newTemplate = async () => {
    if (!(await leave())) return;
    if (
      await ask({
        title: "Start with a different template?",
        body: "This draft stays saved. You can reopen it any time from Saved drafts.",
        confirm: "Choose a template",
      })
    )
      onClose();
  };

  return (
    // The shell never scrolls as a whole (not even through scrollIntoView); each pane scrolls on its own.
    <div className="flex h-dvh flex-col overflow-clip bg-app">
      <WorkspaceHeader
        title={doc.title}
        filename={doc.filename}
        status={statusLine(progress, { generating: generation.generating, hasDraft, save: save.status, savedAt: doc.savedAt })}
        note={!hasDraft && !generation.generating ? `Answers saved at ${clockTime(doc.savedAt)}` : null}
        hasDraft={hasDraft}
        canSaveNow={save.status === "unsaved" || save.status === "error"}
        saving={save.status === "saving"}
        onSaveNow={() => void flush().catch(() => undefined)}
        onDrafts={onShowDrafts}
        onNewTemplate={() => void newTemplate()}
        onDownload={() => void exporter.download(exportWarnings(doc))}
        downloading={exporter.busy === "download"}
        onOpenInWord={() => void exporter.openInWord(exportWarnings(doc))}
        openingInWord={exporter.busy === "word"}
        onGenerate={() => void startGeneration()}
        canGenerate={progress.ready && !generation.generating}
        generating={generation.generating}
      />
      <SaveBanner
        draftSave={hasDraft ? save : null}
        exportNotice={exporter.notice}
        onLoadNewer={loadNewer}
        onSaveAsNew={() => copy.mutate()}
        onRetrySave={() => void flush().catch(() => undefined)}
        onRetryExport={() => void exporter.retry(exportWarnings(doc))}
        onDismissExportNotice={exporter.dismissNotice}
      />
      <ViewSwitcher<AssistantView | "document">
        views={[...tabs, { id: "document", label: "Document", name: "Document" }]}
        active={docInFront ? "document" : shown}
        onSelect={(id) => {
          if (id === "document") return setDocInFront(true);
          setView(id);
          setDocInFront(false);
        }}
      />
      <div className="relative flex min-h-0 flex-1">
        <AssistantPane
          doc={doc}
          inactive={inactive}
          progress={progress}
          tabs={tabs}
          view={shown}
          onView={setView}
          hidden={docInFront}
          hasDraft={hasDraft}
          chat={{
            messages: chat.messages,
            busy: chat.busy,
            failure,
            disabledReason:
              doc.analysis === "markers_only"
                ? `The assistant is off for this template because the AI analysis did not run. ${hasDraft ? "Edit the draft directly in the document." : "Fill in the details under Details."}`
                : generation.generating
                  ? "Wait for the draft to finish."
                  : null,
            onSend: (text) => {
              generation.clearFailure();
              return chat.send(text);
            },
            onStop: chat.stop,
            onRetry: retry,
            onLanguage: chat.setLanguage,
          }}
          nextStep={
            <NextStep
              generating={generation.generating}
              filledSoFar={generation.blocks.filter((b) => b.partKind === "body").length}
              interrupted={doc.phase === "interrupted"}
              ready={progress.ready}
              hasDraft={hasDraft}
              stale={doc.draftStale}
              onGenerate={() => void startGeneration()}
              onStop={generation.stop}
            />
          }
          onRuleAction={onRuleAction}
        />
        <DocumentPane
          documentId={doc.id}
          filename={doc.filename}
          mode={mode}
          hasDraft={hasDraft}
          generating={generation.generating}
          blocks={generation.blocks}
          pane={pane}
          onPane={setPane}
          hidden={!docInFront}
          editorRef={editor}
          editorKey={editorKey}
          onEditorStatus={onEditorStatus}
          onEditorSaved={onEditorSaved}
          snapshot={snapshot}
          compareVersion={`${editorKey}:${doc.fieldsVersion}`}
          onRegenerate={() => void startGeneration()}
        />
      </div>
      {confirmDialog}
    </div>
  );
});
