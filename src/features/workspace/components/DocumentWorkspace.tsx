"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChatTurn } from "@/features/chat/use-chat-turn";
import { copyDocument } from "@/features/documents/api";
import type {
  DocumentView,
  RuleAction,
} from "@/features/documents/contracts/document-view";
import type {
  EditorHandle,
  SaveStatus,
} from "@/features/documents/editor/SuperDocEditor";
import {
  documentQuery,
  patchDocument,
  useRuleAction,
} from "@/features/documents/queries";
import { useDraftGeneration } from "@/features/documents/use-draft-generation";
import { useErrorText } from "@/i18n/error-text";
import { useConfirm } from "@/shared/ui/ConfirmDialog";
import { Count } from "@/shared/ui/Status";
import type { TabItem } from "@/shared/ui/TabBar";
import { useExport } from "../use-export";
import {
  clockTime,
  documentProgress,
  exportWarnings,
  statusLine,
} from "../workspace-status";
import { AssistantPane, type AssistantView } from "./AssistantPane";
import { DocumentPane, type DocMode, type DocPane } from "./DocumentPane";
import { ViewSwitcher } from "./ViewSwitcher";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { NextStep, SaveBanner } from "./WorkspaceNotices";

export interface DocumentWorkspaceHandle {
  leave(): Promise<boolean>;
}

interface Props {
  doc: DocumentView;
  onShowDrafts(): void;
  onClose(): void;
  onOpenDocument(view: DocumentView): void;
  announce(text: string): void;
}

export const DocumentWorkspace = forwardRef<DocumentWorkspaceHandle, Props>(
  function DocumentWorkspace(
    { doc, onShowDrafts, onClose, onOpenDocument, announce },
    ref,
  ) {
    const t = useTranslations("workspace");
    const tStatus = useTranslations("status");
    const tCommon = useTranslations("common");
    const locale = useLocale();
    const errorText = useErrorText();
    const queryClient = useQueryClient();
    const editor = useRef<EditorHandle>(null);
    const [save, setSave] = useState<{
      status: SaveStatus;
      message?: string;
    }>({
      status: "loading",
    });
    const [editorKey, setEditorKey] = useState(
      `${doc.id}:${doc.workingRevision}`,
    );
    const [view, setView] = useState<AssistantView>("chat");
    const [docInFront, setDocInFront] = useState(false);
    const [pane, setPane] = useState<DocPane>("document");
    const [confirmDialog, ask] = useConfirm();

    const mounted = useRef(false);

    useEffect(() => {
      mounted.current = true;

      return () => {
        mounted.current = false;
      };
    }, []);

    const say = useCallback(
      (text: string) => mounted.current && announce(text),
      [announce],
    );

    const hasDraft = doc.draftStatus === "ready";
    const reloadEditor = useCallback(
      (revision: number) => setEditorKey(`${doc.id}:${revision}`),
      [doc.id],
    );
    const flush = useCallback(async () => {
      await editor.current?.flush();
    }, []);

    const chat = useChatTurn(doc.id, doc.messages, {
      beforeSend: flush,
      onDraftReplaced: reloadEditor,
      announce: say,
    });
    const generation = useDraftGeneration(doc.id, {
      onCompleted: reloadEditor,
      onFailed: () => {
        setView("chat");
        setDocInFront(false);
      },
      announce: say,
    });
    const { mutateAsync: applyRule } = useRuleAction(doc.id, {
      beforeAction: flush,
      onDraftReplaced: reloadEditor,
    });
    const exporter = useExport(doc.id, {
      flush,
      confirm: (warnings, action) =>
        ask({
          title: action === "word" ? t("beforeWord") : t("beforeDownload"),
          body: (
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ),
          confirm: action === "word" ? t("openAnyway") : t("downloadAnyway"),
          cancel: t("reviewFirst"),
        }),
      onNotSaved: (message) =>
        setSave({
          status: "error",
          message,
        }),
      announce: say,
      ask,
    });
    const copy = useMutation({
      mutationFn: async () =>
        copyDocument(doc.id, (await editor.current?.snapshot()) ?? null),
      onSuccess: (copied) => {
        onOpenDocument(copied);
        say(t("copied"));
      },
      onError: (e) =>
        setSave({
          status: "error",
          message: errorText(e),
        }),
    });

    const leave = useCallback(async () => {
      try {
        await editor.current?.flush();

        return true;
      } catch {
        return ask({
          title: t("leaveTitle"),
          body: t("leaveBody"),
          confirm: t("leaveConfirm"),
          cancel: t("stay"),
          tone: "danger",
        });
      }
    }, [ask, t]);

    useImperativeHandle(ref, () => ({ leave }), [leave]);

    const onEditorStatus = useCallback(
      (status: SaveStatus, error?: unknown) =>
        setSave({
          status,
          message: error === undefined ? undefined : errorText(error),
        }),
      [errorText],
    );
    const onEditorSaved = useCallback(
      (revision: number, savedAt: string) =>
        patchDocument(queryClient, doc.id, (d) => ({
          ...d,
          workingRevision: revision,
          savedAt,
        })),
      [queryClient, doc.id],
    );
    const onRuleAction = useCallback(
      (ruleId: string, action: RuleAction) =>
        applyRule({
          ruleId,
          action,
        }),
      [applyRule],
    );
    const mode: DocMode = generation.generating
      ? "preview"
      : hasDraft
        ? "editor"
        : "template";
    const snapshot = useCallback(
      async () =>
        mode === "editor" ? ((await editor.current?.snapshot()) ?? null) : null,
      [mode],
    );
    const inactive = useMemo(
      () => new Set(doc.inactiveFieldIds),
      [doc.inactiveFieldIds],
    );

    const progress = documentProgress(doc, inactive);
    const shown: AssistantView =
      view === "clauses" && !progress.hasClauses ? "chat" : view;
    const tabs: TabItem<AssistantView>[] = [
      {
        id: "chat",
        label: t("chat"),
      },
      {
        id: "details",
        label: t("details"),
        name: t("detailsName", {
          confirmed: progress.confirmed,
          total: progress.total,
        }),
        badge: progress.total ? (
          <Count>{`${progress.confirmed}/${progress.total}`}</Count>
        ) : undefined,
      },
      ...(progress.hasClauses
        ? [
            {
              id: "clauses" as const,
              label: t("clauses"),
              name: progress.attention
                ? t("clausesName", { count: progress.attention })
                : t("clauses"),
              badge: progress.attention ? (
                <Count tone="warn">{progress.attention}</Count>
              ) : undefined,
            },
          ]
        : []),
    ];

    const startGeneration = async () => {
      if (
        hasDraft &&
        !(await ask({
          title: t("regenerateTitle"),
          body: t("regenerateBody"),
          confirm: tCommon("regenerate"),
          tone: "danger",
        }))
      ) {
        return;
      }

      chat.clearFailure();
      setPane("document");
      setDocInFront(true);
      await generation.generate();
    };

    const failure = generation.failure ?? chat.failure;
    const retry = generation.failure
      ? () => void startGeneration()
      : chat.retry;

    const loadNewer = () => {
      return void queryClient
        .fetchQuery({
          ...documentQuery(doc.id),
          staleTime: 0,
        })
        .then(onOpenDocument, (e: unknown) =>
          setSave({
            status: "conflict",
            message: errorText(e),
          }),
        );
    };

    const newTemplate = async () => {
      if (!(await leave())) {
        return;
      }

      if (
        await ask({
          title: t("newTemplateTitle"),
          body: t("newTemplateBody"),
          confirm: t("chooseTemplate"),
        })
      ) {
        onClose();
      }
    };

    return (
      <div className="flex h-dvh flex-col overflow-clip bg-app">
        <WorkspaceHeader
          title={doc.title}
          filename={doc.filename}
          status={statusLine(tStatus, progress, {
            generating: generation.generating,
            hasDraft,
            save: save.status,
            savedAt: doc.savedAt,
            locale,
          })}
          note={
            !hasDraft && !generation.generating
              ? t("answersSavedAt", { time: clockTime(doc.savedAt, locale) })
              : null
          }
          hasDraft={hasDraft}
          canSaveNow={save.status === "unsaved" || save.status === "error"}
          saving={save.status === "saving"}
          onSaveNow={() => void flush().catch(() => undefined)}
          onDrafts={onShowDrafts}
          onNewTemplate={() => void newTemplate()}
          onDownload={() =>
            void exporter.download(exportWarnings(tStatus, doc))
          }
          downloading={exporter.busy === "download"}
          onOpenInWord={() =>
            void exporter.openInWord(exportWarnings(tStatus, doc))
          }
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
          onRetryExport={() =>
            void exporter.retry(exportWarnings(tStatus, doc))
          }
          onDismissExportNotice={exporter.dismissNotice}
        />
        <ViewSwitcher<AssistantView | "document">
          views={[
            ...tabs,
            {
              id: "document",
              label: t("document"),
              name: t("document"),
            },
          ]}
          active={docInFront ? "document" : shown}
          onSelect={(id) => {
            if (id === "document") {
              return setDocInFront(true);
            }

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
                  ? t(hasDraft ? "assistantOffDraft" : "assistantOffDetails")
                  : generation.generating
                    ? t("waitForDraft")
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
                filledSoFar={
                  generation.blocks.filter((b) => b.partKind === "body").length
                }
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
  },
);
