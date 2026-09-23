"use client";

import { CircleAlert, CircleCheck, Info, LoaderCircle, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, streamEvents, type DocumentView, type RuleAction } from "@/lib/client/api";
import type { DraftBlock, StreamEvent } from "@/lib/events";
import type { ChatLanguage } from "@/lib/fields/types";
import { ChatHeader, ChatPanel, type ChatError, type ChatMessage } from "./ChatPanel";
import { ClausePanel, needsAttention } from "./ClausePanel";
import { ComparePanel } from "./ComparePanel";
import { DraftPreview, PaperSkeleton } from "./DraftPreview";
import { DraftsDrawer } from "./DraftsDrawer";
import { FieldPanel } from "./FieldPanel";
import type { EditorHandle, SaveStatus } from "./SuperDocEditor";
import { BrandMark, Button, Count, TabBar, TONE, useConfirm, type Tone } from "./ui";
import { UploadPanel } from "./UploadPanel";
import { WorkspaceHeader, type StatusTone } from "./WorkspaceHeader";

// The editor is large; load it only when a document is on screen.
const SuperDocEditor = dynamic(() => import("./SuperDocEditor").then((m) => m.SuperDocEditor), { ssr: false, loading: () => <PaperSkeleton /> });

type DocMode = "template" | "preview" | "editor";
type AssistantView = "chat" | "details" | "clauses";
type Failure = ChatError & { retry?: { kind: "chat"; text: string } | { kind: "generate" } };

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown): ChatError => ({ message: e instanceof Error ? e.message : "Something went wrong.", retryable: e instanceof ApiError ? e.retryable : true });
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const SAVE: Record<SaveStatus, { text: string; tone: StatusTone }> = {
  loading: { text: "Opening…", tone: "busy" },
  saved: { text: "Saved", tone: "ok" },
  unsaved: { text: "Unsaved changes", tone: "neutral" },
  saving: { text: "Saving…", tone: "busy" },
  error: { text: "Save failed", tone: "danger" },
  conflict: { text: "Changed in another tab", tone: "warn" },
  viewing: { text: "Template preview", tone: "neutral" },
};

/** Issues the user should see before exporting a contract that may be incomplete or broken. */
const exportWarnings = (d: DocumentView) => [
  ...d.rules.filter((r) => r.state === "unresolved").map((r) => `“${r.label}” is still undecided.`),
  ...d.rules.filter((r) => r.pending).map((r) => `“${r.label}” waits for your confirmation.`),
  ...d.structureIssues.map((i) => i.message),
  ...d.ruleIssues,
];

/**
 * Panels stay mounted and are hidden with visibility, so scroll positions, unsent text and the editor survive switching.
 * An active panel inherits visibility (never forces it), so a hidden region on narrow screens hides everything inside it.
 */
function Panel({ base, id, active, scroll, className = "", children }: { base: string; id: string; active: boolean; scroll?: boolean; className?: string; children: ReactNode }) {
  return (
    <div id={`${base}-panel-${id}`} role="tabpanel" aria-labelledby={`${base}-tab-${id}`} className={`absolute inset-0 transition-[opacity,visibility] duration-200 ${active ? "opacity-100" : "pointer-events-none invisible opacity-0"} ${scroll ? "overflow-y-auto overscroll-contain" : ""} ${className}`}>
      {children}
    </div>
  );
}

function Banner({ tone, icon: Icon, title, children, actions }: { tone: Tone; icon: LucideIcon; title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <div role="alert" className={`lx-rise flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-x-0 border-t-0 border-b px-4 py-2.5 text-sm ${TONE[tone]}`}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-semibold">{title}</span>
        {children && <span className="ml-1.5 opacity-90">{children}</span>}
      </p>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

function StepBar({ tone = "neutral", icon, text, detail, action }: { tone?: "neutral" | "accent" | "warn"; icon: ReactNode; text: string; detail?: string; action: ReactNode }) {
  const cls = tone === "accent" ? "border-transparent bg-accent-surface" : tone === "warn" ? "border-warn-line bg-warn-surface" : "border-line bg-subtle";
  return (
    <div role="status" className={`lx-rise mx-3 mb-1 flex items-center gap-3 rounded-xl border px-3.5 py-2.5 sm:mx-4 ${cls}`}>
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug text-ink">{text}</p>
        {detail && <p className="text-[12.5px] leading-snug text-ink-2">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function Workspace({ maxUploadMb }: { maxUploadMb: number }) {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [booting, setBooting] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<DocMode>("template");
  const [editorKey, setEditorKey] = useState("0");
  const [save, setSave] = useState<{ status: SaveStatus; message?: string }>({ status: "loading" });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [view, setView] = useState<AssistantView>("chat");
  /** Narrow screens show one region at a time; true when that region is the document. */
  const [docInFront, setDocInFront] = useState(false);
  const [pane, setPane] = useState<"document" | "compare">("document");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [confirmDialog, ask] = useConfirm();
  const editor = useRef<EditorHandle>(null);
  const abort = useRef<AbortController | null>(null);

  const adopt = useCallback((v: DocumentView) => {
    setDoc(v);
    setSavedAt(v.savedAt);
    setMessages(v.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
    setMode(v.draftStatus === "ready" ? "editor" : "template");
    setEditorKey(`${v.id}:${v.workingRevision}`);
    setFailure(null);
    setExportError(null);
  }, []);

  /** Adopts a fresh view of the same draft without reloading the editor. */
  const adoptKeepingEditor = (v: DocumentView) => {
    setDoc(v);
    setSavedAt(v.savedAt);
    setMessages(v.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
  };

  useEffect(() => {
    api
      .current()
      .then((r) => r.document && adopt(r.document))
      .catch(() => undefined)
      .finally(() => setBooting(false));
  }, [adopt]);

  /** Saves pending editor edits before leaving this draft; asks before discarding them if saving fails. */
  const leaveDraft = async (): Promise<boolean> => {
    try {
      await editor.current?.flush();
      return true;
    } catch {
      return ask({ title: "Your latest edits could not be saved", body: "Leave this draft anyway? The edits made since the last save will be lost.", confirm: "Leave without saving", cancel: "Stay here", tone: "danger" });
    }
  };

  const onUpload = async (file: File) => {
    setUploadError(null);
    setUploading(file.name);
    try {
      adopt(await api.upload(file));
      setView("chat");
      setPane("document");
      setDocInFront(false);
    } catch (e) {
      setUploadError(errMsg(e).message);
    } finally {
      setUploading(null);
    }
  };

  const applyFields = (e: Extract<StreamEvent, { type: "fields_updated" }>) => setDoc((d) => (d ? { ...d, fields: e.fields, fieldsVersion: e.fieldsVersion, draftStale: d.draftStatus === "ready" } : d));

  /** Server-derived parts of the view (rules, inactive fields, issues) are refreshed after a turn. */
  const refresh = async (id: string) => {
    try {
      const v = await api.get(id);
      setDoc((d) => (d && d.id === v.id ? { ...v, messages: d.messages } : d));
      setSavedAt(v.savedAt);
    } catch {
      /* the next action reports errors */
    }
  };

  /** `retry` resends a failed message without adding it to the conversation a second time. */
  const send = async (text: string, retry = false): Promise<boolean> => {
    if (!doc) return false;
    setFailure(null);
    try {
      // Make sure any browser edit is saved before the server may patch the draft.
      if (mode === "editor") await editor.current?.flush();
    } catch {
      setFailure({ message: "Your latest edit could not be saved, so the message was not sent. It is back in the box below; send it again once saving works.", retryable: false });
      return false;
    }
    const replyId = `a-${Date.now()}`;
    setMessages((m) => [...m, ...(retry ? [] : [{ id: `u-${Date.now()}`, role: "user" as const, content: text }]), { id: replyId, role: "assistant" as const, content: "", streaming: true }]);
    setChatBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let finished = false;
    try {
      await streamEvents(
        `/api/documents/${doc.id}/chat`,
        { message: text, fieldsVersion: doc.fieldsVersion },
        (e) => {
          if (e.type === "fields_updated") {
            applyFields(e);
            if (e.changed.length) setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, updated: e.changed.length } : x)));
          }
          if (e.type === "assistant_delta") setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: x.content + e.text } : x)));
          if (e.type === "assistant_done") {
            finished = true;
            setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: e.text, streaming: false } : x)));
            setAnnounce(`Assistant replied: ${e.text.slice(0, 400)}`);
          }
          if (e.type === "draft_patch") {
            setDoc((d) => (d ? { ...d, workingRevision: e.workingRevision } : d));
            if (e.applied.length || e.clauseChanges.length) setEditorKey(`${doc.id}:${e.workingRevision}`);
            const notes: string[] = [];
            if (e.conflicts.length) notes.push(`You edited the text where ${e.conflicts.length === 1 ? "this answer" : "these answers"} appeared (${e.conflicts.join(", ")}), so your edit was kept and the draft was not changed there. Update it in the editor, or regenerate the draft from the template (this discards manual edits).`);
            for (const c of e.clauseChanges) notes.push(`Clause ${c.action === "exclude" ? "removed" : "restored"}: “${c.label}” (${c.reason}).`);
            for (const c of e.needsConfirmation) notes.push(`“${c.label}” should now be ${c.action === "exclude" ? "removed" : "included"}, but you edited it. Confirm it under Clauses.`);
            if (notes.length) setMessages((m) => [...m, ...notes.map((content, i) => ({ id: `n-${Date.now()}-${i}`, role: "notice" as const, content }))]);
          }
          if (e.type === "error") setFailure({ message: e.message, retryable: e.retryable, retry: { kind: "chat", text } });
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setFailure({ ...errMsg(e), retry: { kind: "chat", text } });
    } finally {
      setChatBusy(false);
      abort.current = null;
      setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, streaming: false, content: x.content || (finished ? x.content : ctrl.signal.aborted ? "(stopped)" : "") } : x)).filter((x) => x.role !== "assistant" || x.content));
      void refresh(doc.id);
    }
    return true;
  };

  const generate = async () => {
    if (!doc) return;
    if (doc.draftStatus === "ready" && !(await ask({ title: "Regenerate the draft?", body: "The draft is rebuilt from the template with your current answers. Edits you made in the editor are replaced.", confirm: "Regenerate", tone: "danger" }))) return;
    setBlocks([]);
    setFailure(null);
    setGenerating(true);
    setMode("preview");
    setPane("document");
    setDocInFront(true);
    setAnnounce("Generating the draft.");
    const ctrl = new AbortController();
    abort.current = ctrl;
    const hadDraft = doc.draftStatus === "ready";
    let completed = false;
    try {
      await streamEvents(
        `/api/documents/${doc.id}/draft`,
        { fieldsVersion: doc.fieldsVersion },
        (e) => {
          if (e.type === "draft_block_ready") setBlocks((b) => [...b, e.block]);
          if (e.type === "draft_complete") {
            completed = true;
            setDoc((d) => (d ? { ...d, draftStatus: "ready", phase: "draft", draftStale: false, workingRevision: e.workingRevision, fieldsVersion: e.fieldsVersion } : d));
            setEditorKey(`${doc.id}:${e.workingRevision}`);
            setMode("editor");
            setAnnounce("The draft is ready to edit.");
          }
          if (e.type === "error") {
            setFailure({ message: e.message, retryable: e.retryable, retry: { kind: "generate" } });
            setView("chat");
            setDocInFront(false);
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setFailure({ ...errMsg(e), retry: { kind: "generate" } });
        setView("chat");
        setDocInFront(false);
      }
    } finally {
      setGenerating(false);
      abort.current = null;
      // A cancelled or failed generation never replaces the previous state.
      setMode(completed || hadDraft ? "editor" : "template");
      void refresh(doc.id);
    }
  };

  const download = async () => {
    if (!doc) return;
    setExportError(null);
    try {
      // The download is the saved working draft, so the latest editor state must be saved first.
      await editor.current?.flush();
    } catch {
      return setSave({ status: "error", message: "Your latest edit is not saved yet, so the download would miss it. Retry saving first." });
    }
    const warnings = exportWarnings(doc);
    if (
      warnings.length &&
      !(await ask({
        title: "Before you download",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ),
        confirm: "Download anyway",
        cancel: "Review first",
      }))
    )
      return;
    setDownloading(true);
    try {
      const { blob, filename } = await api.download(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setAnnounce(`Downloaded ${filename}.`);
    } catch (e) {
      setExportError(errMsg(e).message);
    } finally {
      setDownloading(false);
    }
  };

  // Stable handlers keep the memoised panels and the editor from re-rendering on every streamed token.
  const correct = useCallback(
    async (fieldId: string, value: string | null) => {
      if (!doc) return;
      const v = await api.correctField(doc.id, { fieldsVersion: doc.fieldsVersion, fieldId, value });
      setDoc({ ...v, messages: doc.messages });
      setSavedAt(v.savedAt);
    },
    [doc],
  );
  const toggleRequired = useCallback(
    async (fieldId: string, required: boolean) => {
      if (!doc) return;
      const v = await api.correctField(doc.id, { fieldsVersion: doc.fieldsVersion, fieldId, required });
      setDoc({ ...v, messages: doc.messages });
    },
    [doc],
  );
  const ruleAct = useCallback(
    async (ruleId: string, action: RuleAction) => {
      if (!doc) return;
      // The server changes the saved draft, so pending browser edits are saved first.
      await editor.current?.flush();
      const v = await api.rule(doc.id, { fieldsVersion: doc.fieldsVersion, ruleId, action });
      const revisionChanged = v.workingRevision !== doc.workingRevision;
      setDoc({ ...v, messages: doc.messages });
      setSavedAt(v.savedAt);
      if (revisionChanged) setEditorKey(`${v.id}:${v.workingRevision}`);
    },
    [doc],
  );
  const onEditorStatus = useCallback((status: SaveStatus, message?: string) => setSave({ status, message }), []);
  const onEditorSaved = useCallback((_rev: number, at: string) => setSavedAt(at), []);
  const snapshot = useCallback(async () => (mode === "editor" ? ((await editor.current?.snapshot()) ?? null) : null), [mode]);
  const inactive = useMemo(() => new Set(doc?.inactiveFieldIds ?? []), [doc?.inactiveFieldIds]);

  const setLanguage = async (language: ChatLanguage | null) => {
    if (!doc) return;
    try {
      adoptKeepingEditor(await api.setLanguage(doc.id, doc.fieldsVersion, language));
    } catch (e) {
      setFailure(errMsg(e));
    }
  };

  const openDraft = async (id: string) => {
    if (id === doc?.id) return setDraftsOpen(false);
    if (!(await leaveDraft())) return;
    adopt(await api.get(id));
    setPane("document");
    setDraftsOpen(false);
  };

  const saveAsNew = async () => {
    if (!doc) return;
    try {
      const snap = await editor.current?.snapshot();
      adopt(await api.copy(doc.id, snap ?? null));
      setAnnounce("Your version was saved as a new draft.");
    } catch (e) {
      setSave({ status: "error", message: errMsg(e).message });
    }
  };

  const newTemplate = async () => {
    if (!(await leaveDraft())) return;
    if (await ask({ title: "Start with a different template?", body: "This draft stays saved. You can reopen it any time from Saved drafts.", confirm: "Choose a template" })) setDoc(null);
  };

  if (booting)
    return (
      <div className="grid min-h-dvh place-items-center">
        <p role="status" className="lx-fade flex items-center gap-3 text-sm text-ink-2">
          <BrandMark />
          Opening your workspace…
        </p>
      </div>
    );

  if (!doc)
    return (
      <>
        <UploadPanel onFile={onUpload} busy={uploading} error={uploadError} onShowDrafts={() => setDraftsOpen(true)} maxMb={maxUploadMb} />
        <DraftsDrawer open={draftsOpen} currentId={null} onClose={() => setDraftsOpen(false)} onOpen={openDraft} onDeleted={() => undefined} onRenamed={() => undefined} />
        {confirmDialog}
      </>
    );

  // What is still needed. A yes/no answer that settles an undecided clause counts once, as a decision.
  const hasDraft = doc.draftStatus === "ready";
  const missing = doc.fields.filter((f) => f.required && f.status !== "confirmed" && !inactive.has(f.id));
  const undecided = doc.rules.filter((r) => r.state === "unresolved");
  const settles = new Set(undecided.map((r) => r.condition.fieldId));
  const detailsLeft = missing.filter((f) => !(f.source === "condition" && settles.has(f.id))).length;
  const ready = !missing.length && !undecided.length;
  const required = doc.fields.filter((f) => f.required && f.source !== "condition" && !inactive.has(f.id));
  const progress = { confirmed: required.filter((f) => f.status === "confirmed").length, total: required.length, decisions: undecided.length };
  const rulesShown = doc.rules.filter((r) => !r.dismissed || r.source === "ai");
  const hasClauses = rulesShown.length > 0 || doc.ruleIssues.length > 0 || doc.structureIssues.length > 0;
  const attention = rulesShown.filter(needsAttention).length + doc.ruleIssues.length + doc.structureIssues.length;
  const shown: AssistantView = view === "clauses" && !hasClauses ? "chat" : view;

  const need = [detailsLeft && count(detailsLeft, "detail"), undecided.length && count(undecided.length, "decision")].filter(Boolean).join(" and ");
  const status = generating
    ? { text: "Generating the draft…", tone: "busy" as const, key: "generating" }
    : hasDraft
      ? { text: save.status === "saved" && savedAt ? `Saved at ${time(savedAt)}` : SAVE[save.status].text, tone: SAVE[save.status].tone, key: `${save.status}:${savedAt}` }
      : { text: need ? `${need} still needed` : "Ready to generate", tone: need ? ("neutral" as const) : ("ok" as const), key: need || "ready" };

  const tabs = [
    { id: "chat" as const, label: "Chat" },
    { id: "details" as const, label: "Details", name: `Details, ${progress.confirmed} of ${progress.total} confirmed`, badge: progress.total ? <Count>{`${progress.confirmed}/${progress.total}`}</Count> : undefined },
    ...(hasClauses ? [{ id: "clauses" as const, label: "Clauses", name: attention ? `Clauses, ${attention} need attention` : "Clauses", badge: attention ? <Count tone="warn">{attention}</Count> : undefined }] : []),
  ];
  const views = [...tabs, { id: "document" as const, label: "Document", name: "Document" }];
  const front = docInFront ? "document" : shown;
  const frontIndex = Math.max(0, views.findIndex((v) => v.id === front));

  const retry = () => {
    const r = failure?.retry;
    if (r?.kind === "chat") void send(r.text, true);
    if (r?.kind === "generate") void generate();
  };

  const nextStep = generating ? (
    <StepBar icon={<LoaderCircle aria-hidden className="size-4 animate-spin text-accent-ink" />} text="Generating the draft" detail={`${blocks.filter((b) => b.partKind === "body").length} paragraphs filled so far`} action={<Button variant="secondary" onClick={() => abort.current?.abort()}>Stop</Button>} />
  ) : doc.phase === "interrupted" ? (
    <StepBar tone="warn" icon={<TriangleAlert aria-hidden className="size-4 text-warn" />} text="The last draft generation was interrupted" detail="Your answers are saved." action={<Button variant="primary" onClick={() => void generate()}>Retry generation</Button>} />
  ) : ready && !hasDraft ? (
    <StepBar tone="accent" icon={<CircleCheck aria-hidden className="size-4 text-accent-ink" />} text="All details are confirmed" detail="Generate the draft to review and edit it." action={<Button variant="primary" onClick={() => void generate()}>Generate draft</Button>} />
  ) : hasDraft && doc.draftStale && ready ? (
    <StepBar icon={<Info aria-hidden className="size-4 text-ink-2" />} text="Some answers changed since the draft was made" detail="Regenerating rebuilds it from the template and replaces your edits." action={<Button variant="secondary" onClick={() => void generate()}>Regenerate</Button>} />
  ) : null;

  const banner =
    hasDraft && save.status === "conflict" ? (
      <Banner
        tone="warn"
        icon={TriangleAlert}
        title="This draft was changed somewhere else."
        actions={
          <>
            <Button size="sm" variant="primary" onClick={() => void api.get(doc.id).then(adopt)}>Load the newer version</Button>
            <Button size="sm" variant="secondary" onClick={() => void saveAsNew()}>Save mine as a new draft</Button>
          </>
        }
      >
        {save.message}
      </Banner>
    ) : hasDraft && save.status === "error" ? (
      <Banner tone="danger" icon={CircleAlert} title="Your latest edits are not saved." actions={<Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void editor.current?.flush().catch(() => undefined)}>Retry save</Button>}>
        {save.message}
      </Banner>
    ) : exportError ? (
      <Banner
        tone="danger"
        icon={CircleAlert}
        title="The download failed."
        actions={
          <>
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void download()}>Try again</Button>
            <Button size="sm" variant="ghost" onClick={() => setExportError(null)}>Dismiss</Button>
          </>
        }
      >
        {exportError}
      </Banner>
    ) : null;

  return (
    <div className="lx-rise flex h-dvh flex-col bg-app">
      <WorkspaceHeader
        title={doc.title}
        filename={doc.filename}
        status={status}
        note={!hasDraft && !generating ? `Answers saved at ${time(savedAt ?? doc.savedAt)}` : null}
        step={hasDraft && !generating ? 2 : ready || generating ? 1 : 0}
        hasDraft={hasDraft}
        canSaveNow={save.status === "unsaved" || save.status === "error"}
        saving={save.status === "saving"}
        onSaveNow={() => void editor.current?.flush().catch(() => undefined)}
        onDrafts={() => setDraftsOpen(true)}
        onNewTemplate={() => void newTemplate()}
        onDownload={() => void download()}
        downloadDisabled={!hasDraft || generating}
        downloadHint={generating ? "Available when the draft is ready" : !hasDraft ? "Generate the draft first" : null}
        downloading={downloading}
      />
      {banner}

      <nav aria-label="Views" className="shrink-0 border-b border-line bg-surface px-3 py-2 lg:hidden">
        <div className="relative grid rounded-control border border-line bg-subtle p-0.5" style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}>
          <span aria-hidden className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[8px] bg-surface shadow-sm ring-1 ring-line transition-transform duration-200 ease-(--ease-out) dark:bg-raised" style={{ width: `calc((100% - 4px) / ${views.length})`, transform: `translateX(${frontIndex * 100}%)` }} />
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={front === v.id}
              aria-label={v.name}
              onClick={() => {
                if (v.id === "document") return setDocInFront(true);
                setView(v.id);
                setDocInFront(false);
              }}
              className={`relative inline-flex h-9 min-w-0 items-center justify-center gap-1 rounded-[8px] px-1 text-[13.5px] font-medium transition-colors duration-150 ${front === v.id ? "text-ink" : "text-ink-2"}`}
            >
              <span className="truncate">{v.label}</span>
              {/* On phones the Details count stays in the accessible name only; the Clauses warning count always shows. */}
              {"badge" in v && v.badge && <span className={v.id === "details" ? "max-sm:hidden" : ""}>{v.badge}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Assistant and details" className={`flex min-h-0 flex-col bg-surface max-lg:absolute max-lg:inset-0 max-lg:transition-[opacity,visibility] max-lg:duration-200 lg:w-[clamp(360px,30vw,430px)] lg:shrink-0 lg:border-r lg:border-line ${docInFront ? "max-lg:pointer-events-none max-lg:invisible max-lg:opacity-0" : ""}`}>
          <div className="shrink-0 border-b border-line px-4 py-2.5 max-lg:hidden sm:px-5">
            <TabBar<AssistantView> idBase="assistant" label="Assistant views" value={shown} onChange={setView} items={tabs} />
          </div>
          <div className="relative min-h-0 flex-1">
            <Panel base="assistant" id="chat" active={shown === "chat"} className="flex flex-col">
              <ChatPanel
                messages={messages}
                busy={chatBusy}
                error={failure}
                header={<ChatHeader language={doc.analysis === "ai" ? doc.language : null} onLanguage={(l) => void setLanguage(l)} progress={progress} onReviewDetails={() => setView("details")} onReviewClauses={() => setView("clauses")} />}
                disabledReason={doc.analysis === "markers_only" ? "The assistant is unavailable for this template. Fill the details in under Details." : generating ? "Wait for the draft to finish." : null}
                onSend={send}
                onStop={() => abort.current?.abort()}
                onRetry={retry}
                footer={nextStep}
              />
            </Panel>
            <Panel base="assistant" id="details" active={shown === "details"} scroll>
              <FieldPanel fields={doc.fields} inactive={inactive} locked={hasDraft} onCorrect={correct} onToggleRequired={toggleRequired} />
            </Panel>
            {hasClauses && (
              <Panel base="assistant" id="clauses" active={shown === "clauses"} scroll>
                <ClausePanel rules={doc.rules} fields={doc.fields} language={doc.language.effective} locked={hasDraft} ruleIssues={doc.ruleIssues} structureIssues={doc.structureIssues} onAction={ruleAct} onAnswer={correct} />
              </Panel>
            )}
          </div>
        </aside>

        <main aria-label="Document" className={`flex min-h-0 min-w-0 flex-1 flex-col max-lg:absolute max-lg:inset-0 max-lg:transition-[opacity,visibility] max-lg:duration-200 ${docInFront ? "" : "max-lg:pointer-events-none max-lg:invisible max-lg:opacity-0"}`}>
          <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2 sm:px-4">
            <TabBar<"document" | "compare">
              idBase="doc"
              label="Document view"
              value={pane}
              onChange={setPane}
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
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void generate()} className="ml-auto">
                Regenerate
              </Button>
            )}
          </div>
          <div className="relative min-h-0 flex-1">
            <Panel base="doc" id="document" active={pane === "document"}>
              {mode === "preview" ? (
                <DraftPreview blocks={blocks} generating={generating} />
              ) : (
                <SuperDocEditor ref={editor} documentId={doc.id} filename={doc.filename} source={mode === "editor" ? "working" : "original"} loadKey={mode === "editor" ? editorKey : `${doc.id}:original`} onStatus={onEditorStatus} onSaved={onEditorSaved} />
              )}
            </Panel>
            {pane === "compare" && (
              <Panel base="doc" id="compare" active>
                <ComparePanel documentId={doc.id} snapshot={snapshot} version={`${doc.workingRevision}:${doc.fieldsVersion}`} />
              </Panel>
            )}
          </div>
        </main>
      </div>

      <DraftsDrawer
        open={draftsOpen}
        currentId={doc.id}
        onClose={() => setDraftsOpen(false)}
        onOpen={openDraft}
        onDeleted={(id) => id === doc.id && setDoc(null)}
        onRenamed={(id, title) => id === doc.id && setDoc((d) => (d ? { ...d, title } : d))}
      />
      {confirmDialog}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
