import { CircleAlert, CircleCheck, Info, LoaderCircle, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import { Button } from "@/shared/ui/Button";
import { TONE, type Tone } from "@/shared/ui/Status";

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

interface SaveBannerProps {
  /** The editor's save state once a draft exists; null before. */
  draftSave: { status: SaveStatus; message?: string } | null;
  exportError: string | null;
  onLoadNewer(): void;
  onSaveAsNew(): void;
  onRetrySave(): void;
  onRetryDownload(): void;
  onDismissExportError(): void;
}

/** A problem with the draft's copy on the server: changed elsewhere, not saved, or not downloaded. */
export function SaveBanner({ draftSave: save, exportError, onLoadNewer, onSaveAsNew, onRetrySave, onRetryDownload, onDismissExportError }: SaveBannerProps) {
  if (save?.status === "conflict")
    return (
      <Banner
        tone="warn"
        icon={TriangleAlert}
        title="This draft was changed somewhere else."
        actions={
          <>
            <Button size="sm" variant="primary" onClick={onLoadNewer}>Load the newer version</Button>
            <Button size="sm" variant="secondary" onClick={onSaveAsNew}>Save mine as a new draft</Button>
          </>
        }
      >
        {save.message}
      </Banner>
    );
  if (save?.status === "error")
    return (
      <Banner tone="danger" icon={CircleAlert} title="Your latest edits are not saved." actions={<Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetrySave}>Retry save</Button>}>
        {save.message}
      </Banner>
    );
  if (exportError)
    return (
      <Banner
        tone="danger"
        icon={CircleAlert}
        title="The download failed."
        actions={
          <>
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetryDownload}>Try again</Button>
            <Button size="sm" variant="ghost" onClick={onDismissExportError}>Dismiss</Button>
          </>
        }
      >
        {exportError}
      </Banner>
    );
  return null;
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

interface NextStepProps {
  generating: boolean;
  filledSoFar: number;
  interrupted: boolean;
  ready: boolean;
  hasDraft: boolean;
  stale: boolean;
  onGenerate(): void;
  onStop(): void;
}

/** What to do next about the draft, shown above the message box. */
export function NextStep({ generating, filledSoFar, interrupted, ready, hasDraft, stale, onGenerate, onStop }: NextStepProps) {
  if (generating) return <StepBar icon={<LoaderCircle aria-hidden className="size-4 animate-spin text-accent-ink" />} text="Generating the draft" detail={`${filledSoFar} paragraphs filled so far`} action={<Button variant="secondary" onClick={onStop}>Stop</Button>} />;
  if (interrupted) return <StepBar tone="warn" icon={<TriangleAlert aria-hidden className="size-4 text-warn" />} text="The last draft generation was interrupted" detail="Your answers are saved." action={<Button variant="primary" onClick={onGenerate}>Retry generation</Button>} />;
  if (ready && !hasDraft) return <StepBar tone="accent" icon={<CircleCheck aria-hidden className="size-4 text-accent-ink" />} text="All details are confirmed" detail="Generate the draft to review and edit it." action={<Button variant="primary" onClick={onGenerate}>Generate draft</Button>} />;
  if (hasDraft && stale && ready) return <StepBar icon={<Info aria-hidden className="size-4 text-ink-2" />} text="Some answers changed since the draft was made" detail="Regenerating rebuilds it from the template and replaces your edits." action={<Button variant="secondary" onClick={onGenerate}>Regenerate</Button>} />;
  return null;
}
