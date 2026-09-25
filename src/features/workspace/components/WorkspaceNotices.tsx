import {
  CircleAlert,
  Info,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import type { ExportNotice } from "../use-export";
import { Button } from "@/shared/ui/Button";
import { TONE_BOX, TONE_TEXT, type Tone } from "@/shared/ui/Status";

function Banner({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  role = "alert",
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-x-0 border-t-0 border-b px-4 py-2.5 text-ui ${TONE_BOX[tone]}`}
    >
      <Icon aria-hidden className={`size-4 shrink-0 ${TONE_TEXT[tone]}`} />
      <p className="min-w-0 flex-1 basis-64">
        <span className={`font-semibold ${TONE_TEXT[tone]}`}>{title}</span>
        {children && <span className="ml-1.5 text-ink-2">{children}</span>}
      </p>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

interface SaveBannerProps {
  /** The editor's save state once a draft exists; null before. */
  draftSave: {
    status: SaveStatus;
    message?: string;
  } | null;
  exportNotice: ExportNotice | null;
  onLoadNewer(): void;
  onSaveAsNew(): void;
  onRetrySave(): void;
  onRetryExport(): void;
  onDismissExportNotice(): void;
}

/**
 * A problem with the draft's copy on the server (changed
 * elsewhere, not saved, not exported), or Word being opened.
 */
export function SaveBanner({
  draftSave: save,
  exportNotice,
  onLoadNewer,
  onSaveAsNew,
  onRetrySave,
  onRetryExport,
  onDismissExportNotice,
}: SaveBannerProps) {
  if (save?.status === "conflict") {
    return (
      <Banner
        tone="warn"
        icon={TriangleAlert}
        title="This draft was changed somewhere else."
        actions={
          <>
            <Button size="sm" variant="primary" onClick={onLoadNewer}>
              Load the newer version
            </Button>
            <Button size="sm" variant="secondary" onClick={onSaveAsNew}>
              Save mine as a new draft
            </Button>
          </>
        }
      >
        {save.message}
      </Banner>
    );
  }

  if (save?.status === "error") {
    return (
      <Banner
        tone="danger"
        icon={CircleAlert}
        title="Your latest edits are not saved."
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={RotateCcw}
            onClick={onRetrySave}
          >
            Try again
          </Button>
        }
      >
        {save.message}
      </Banner>
    );
  }

  if (exportNotice?.kind === "word") {
    return (
      <Banner
        tone="neutral"
        icon={Info}
        role="status"
        title="Opening the draft in Word."
        actions={
          <Button size="sm" variant="ghost" onClick={onDismissExportNotice}>
            Dismiss
          </Button>
        }
      >
        Word downloads a copy of the saved draft; use Save As to keep it. If
        nothing opens, Word may not be installed on this device, so use Download
        Word file instead.
      </Banner>
    );
  }

  if (exportNotice) {
    return (
      <Banner
        tone="danger"
        icon={CircleAlert}
        title={
          exportNotice.action === "word"
            ? "The draft could not be opened in Word."
            : "The download failed."
        }
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={RotateCcw}
              onClick={onRetryExport}
            >
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismissExportNotice}>
              Dismiss
            </Button>
          </>
        }
      >
        {exportNotice.message}
      </Banner>
    );
  }

  return null;
}

function StepBar({
  tone = "neutral",
  icon,
  text,
  detail,
  action,
}: {
  tone?: "neutral" | "warn";
  icon: ReactNode;
  text: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`mx-3 mb-2 flex items-center gap-3 rounded-card border px-3.5 py-2.5 sm:mx-4 ${TONE_BOX[tone]}`}
    >
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-semibold text-ink">{text}</p>
        {detail && <p className="text-meta text-ink-2">{detail}</p>}
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

/**
 * What to do next about the draft, shown above the message
 * box. Generating a first draft is the header's action.
 */
export function NextStep({
  generating,
  filledSoFar,
  interrupted,
  ready,
  hasDraft,
  stale,
  onGenerate,
  onStop,
}: NextStepProps) {
  if (generating) {
    return (
      <StepBar
        icon={
          <LoaderCircle
            aria-hidden
            className="size-4 animate-spin text-ink-2"
          />
        }
        text="Generating the draft"
        detail={`${filledSoFar} paragraphs filled so far`}
        action={
          <Button variant="secondary" onClick={onStop}>
            Stop
          </Button>
        }
      />
    );
  }

  if (interrupted) {
    return (
      <StepBar
        tone="warn"
        icon={<TriangleAlert aria-hidden className="size-4 text-warn" />}
        text="The last draft generation was interrupted"
        detail="Your answers are saved."
        action={
          <Button variant="primary" onClick={onGenerate}>
            Retry generation
          </Button>
        }
      />
    );
  }

  if (hasDraft && stale && ready) {
    return (
      <StepBar
        icon={<Info aria-hidden className="size-4 text-ink-2" />}
        text="Some answers changed since the draft was made"
        detail="Regenerating rebuilds it from the template and replaces your edits."
        action={
          <Button variant="secondary" onClick={onGenerate}>
            Regenerate
          </Button>
        }
      />
    );
  }

  return null;
}
