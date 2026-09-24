"use client";

import { CircleCheck, CircleHelp, CircleMinus, CircleSlash, Lightbulb, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { RuleAction, RuleView } from "@/features/documents/contracts/document-view";
import type { ChatLanguage, Field } from "@/features/documents/contracts/fields";
import { errorMessage } from "@/lib/http";
import { Button } from "@/shared/ui/Button";
import { Callout, StatusBadge, type Tone } from "@/shared/ui/Status";
import { needsAttention } from "../clause-status";
import { ClauseDecision } from "./ClauseDecision";

const STATE: Record<RuleView["state"], { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  included: { label: "Included", tone: "ok", icon: CircleCheck },
  excluded: { label: "Excluded", tone: "neutral", icon: CircleSlash },
  unresolved: { label: "Needs decision", tone: "warn", icon: CircleHelp },
  proposed: { label: "Suggested", tone: "accent", icon: Lightbulb },
  dismissed: { label: "Not conditional", tone: "neutral", icon: CircleMinus },
};

export interface RuleCardProps {
  documentId: string;
  r: RuleView;
  fields: Field[];
  language: ChatLanguage;
  /** A draft exists: answers change through the chat so the draft is patched safely. */
  locked: boolean;
  onAction(ruleId: string, action: RuleAction): Promise<unknown>;
}

/** One conditional clause: its state and reason, and the decision or confirmation it waits for. */
export function RuleCard({ documentId, r, fields, language, locked, onAction }: RuleCardProps) {
  const [busy, setBusy] = useState<RuleAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const s = STATE[r.state];
  const act = async (a: RuleAction) => {
    setBusy(a);
    setErr(null);
    try {
      await onAction(r.id, a);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const btn = (a: RuleAction, label: string, variant: "primary" | "secondary" | "ghost" = "secondary") => (
    <Button size="sm" variant={variant} busy={busy === a} disabled={busy !== null} onClick={() => void act(a)}>
      {label}
    </Button>
  );
  const evidence = r.evidence ?? "";
  return (
    <li className={`lx-fade rounded-card border bg-surface p-4 shadow-sm dark:bg-raised ${needsAttention(r) ? "border-warn-line" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[14.5px] font-semibold leading-snug text-ink">{r.label}</h3>
        <StatusBadge tone={s.tone} icon={s.icon}>
          {s.label}
        </StatusBadge>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink-2">{r.reason}</p>

      {r.pending && (
        <Callout
          tone="warn"
          icon={TriangleAlert}
          role="status"
          className="mt-3"
          actions={
            <>
              {btn("apply", "Remove the clause", "primary")}
              {btn("include", "Keep it (always include)")}
            </>
          }
        >
          The answers call for {r.state === "excluded" ? "removing" : "changing"} this clause, but you edited it in the draft. Removing it keeps your edited
          version, which comes back if the clause is included again.
        </Callout>
      )}
      {r.state === "unresolved" && !r.pending && (
        <ClauseDecision documentId={documentId} r={r} field={fields.find((f) => f.id === r.condition.fieldId)} language={language} locked={locked} />
      )}
      {r.state === "proposed" && (
        <>
          {evidence && (
            <blockquote className="mt-3 border-l-2 border-line pl-3 font-serif text-[14px] italic leading-relaxed text-ink-2">
              <span className="sr-only">The template says: </span>“{evidence.length > 180 && !more ? `${evidence.slice(0, 180).trimEnd()}…` : evidence}”
              {evidence.length > 180 && (
                <button
                  type="button"
                  onClick={() => setMore((m) => !m)}
                  className="ml-1 font-sans text-[12.5px] not-italic font-medium text-accent-ink hover:underline"
                >
                  {more ? "Show less" : "Show all"}
                </button>
              )}
            </blockquote>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {btn("confirm", "Make it conditional", "primary")}
            {btn("dismiss", "Dismiss suggestion", "ghost")}
          </div>
        </>
      )}
      {r.hasEditedVariant && r.applied === "excluded" && (
        <p className="mt-2.5 text-[13px] text-ink-2">Your edited version is kept and will be restored if this clause is included again.</p>
      )}

      {r.confirmed && !r.dismissed && !r.pending && (
        <div className="-ml-2 mt-2 flex flex-wrap gap-1">
          {r.override ? (
            btn("clear_override", "Follow the condition again", "ghost")
          ) : (
            <>
              {btn("include", "Always include", "ghost")}
              {btn("exclude", "Always exclude", "ghost")}
            </>
          )}
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {err}
        </p>
      )}
    </li>
  );
}
