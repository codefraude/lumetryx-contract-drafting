"use client";

import { ChevronDown, CircleCheck, CircleHelp, CircleMinus, CircleSlash, Lightbulb, TriangleAlert } from "lucide-react";
import { memo, useId, useState } from "react";
import type { DocumentView, RuleAction } from "@/lib/client/api";
import type { ChatLanguage, Field } from "@/lib/fields/types";
import { Button, Callout, StatusBadge, type Tone } from "./ui";

type RuleView = DocumentView["rules"][number];

const STATE: Record<RuleView["state"], { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  included: { label: "Included", tone: "ok", icon: CircleCheck },
  excluded: { label: "Excluded", tone: "neutral", icon: CircleSlash },
  unresolved: { label: "Needs decision", tone: "warn", icon: CircleHelp },
  proposed: { label: "Suggested", tone: "accent", icon: Lightbulb },
  dismissed: { label: "Not conditional", tone: "neutral", icon: CircleMinus },
};

/** Items that need the user come first. */
const rank = (r: RuleView) => (r.pending ? 0 : r.state === "unresolved" ? 1 : r.state === "proposed" ? 2 : r.state === "dismissed" ? 4 : 3);

interface Props {
  rules: RuleView[];
  fields: Field[];
  language: ChatLanguage;
  /** A draft exists: answers change through the chat so the draft is patched safely. */
  locked: boolean;
  ruleIssues: string[];
  structureIssues: DocumentView["structureIssues"];
  onAction(ruleId: string, action: RuleAction): Promise<void>;
  onAnswer(fieldId: string, value: string): Promise<void>;
}

export const needsAttention = (r: RuleView) => r.state === "unresolved" || r.state === "proposed" || r.pending;

function Decision({ r, field, language, locked, onAnswer }: { r: RuleView; field: Field | undefined; language: ChatLanguage; locked: boolean; onAnswer: Props["onAnswer"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const id = useId();
  const question = (language === "fr" ? field?.questionFr : null) ?? field?.question ?? `What is “${field?.label ?? r.condition.fieldId}”?`;
  const answer = async (v: string) => {
    setBusy(v);
    setErr(null);
    try {
      await onAnswer(r.condition.fieldId, v);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const yesNo = field?.valueType === "boolean" || r.condition.op === "is_true" || r.condition.op === "is_false";
  return (
    <div className="mt-3 rounded-xl border border-warn-line bg-warn-surface/60 p-3">
      <p className="text-[13.5px] font-medium leading-snug text-ink">{question}</p>
      {locked ? (
        <p className="mt-1.5 text-[13px] text-ink-2">Answer in the chat, so the draft is updated safely.</p>
      ) : yesNo ? (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" variant="secondary" busy={busy === "Yes"} disabled={busy !== null} onClick={() => void answer("Yes")}>Yes</Button>
          <Button size="sm" variant="secondary" busy={busy === "No"} disabled={busy !== null} onClick={() => void answer("No")}>No</Button>
        </div>
      ) : (
        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void answer(value.trim());
          }}
        >
          <label htmlFor={`${id}-v`} className="sr-only">{question}</label>
          <input id={`${id}-v`} list={`${id}-o`} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-0 flex-1 rounded-control border border-control bg-surface px-2.5 text-sm text-ink outline-none focus:border-primary dark:bg-raised pointer-coarse:h-10" />
          <datalist id={`${id}-o`}>
            {r.condition.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Button type="submit" size="sm" variant="secondary" busy={busy !== null} disabled={!value.trim()}>Save</Button>
        </form>
      )}
      {err && <p role="alert" className="mt-2 text-[13px] text-danger">{err}</p>}
    </div>
  );
}

function RuleCard({ r, fields, language, locked, onAction, onAnswer }: { r: RuleView } & Omit<Props, "rules" | "ruleIssues" | "structureIssues">) {
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
      setErr((e as Error).message);
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
        <Callout tone="warn" icon={TriangleAlert} role="status" className="mt-3" actions={<>{btn("apply", "Remove the clause", "primary")}{btn("include", "Keep it (always include)")}</>}>
          The answers call for {r.state === "excluded" ? "removing" : "changing"} this clause, but you edited it in the draft. Removing it keeps your edited version, which comes back if the clause is included again.
        </Callout>
      )}
      {r.state === "unresolved" && !r.pending && <Decision r={r} field={fields.find((f) => f.id === r.condition.fieldId)} language={language} locked={locked} onAnswer={onAnswer} />}
      {r.state === "proposed" && (
        <>
          {evidence && (
            <blockquote className="mt-3 border-l-2 border-line pl-3 font-serif text-[14px] italic leading-relaxed text-ink-2">
              <span className="sr-only">The template says: </span>“{evidence.length > 180 && !more ? `${evidence.slice(0, 180).trimEnd()}…` : evidence}”
              {evidence.length > 180 && (
                <button type="button" onClick={() => setMore((m) => !m)} className="ml-1 font-sans text-[12.5px] not-italic font-medium text-accent-ink hover:underline">
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
      {r.hasEditedVariant && r.applied === "excluded" && <p className="mt-2.5 text-[13px] text-ink-2">Your edited version is kept and will be restored if this clause is included again.</p>}

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
      {err && <p role="alert" className="mt-2 text-[13px] text-danger">{err}</p>}
    </li>
  );
}

/** Conditional clauses with their status and reason, and any problems the document structure raised. */
export const ClausePanel = memo(function ClausePanel({ rules, ruleIssues, structureIssues, ...rest }: Props) {
  const [showIssues, setShowIssues] = useState(true);
  const visible = rules.filter((r) => !r.dismissed || r.source === "ai").sort((a, b) => rank(a) - rank(b));
  const issues = [...ruleIssues, ...structureIssues.map((i) => i.message)];
  const included = visible.filter((r) => r.state === "included").length;
  const excluded = visible.filter((r) => r.state === "excluded").length;
  const attention = visible.filter(needsAttention).length;
  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <div>
        <p className="text-[15px] font-semibold text-ink">Conditional clauses</p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {visible.length ? `${included} included, ${excluded} excluded${attention ? `, ${attention} waiting for you` : ""}.` : "This template has no conditional clauses."} Clauses follow your answers; a suggested condition applies only after you confirm it.
        </p>
      </div>
      {issues.length > 0 && (
        <div className="rounded-xl border border-warn-line bg-warn-surface text-warn">
          <button type="button" aria-expanded={showIssues} onClick={() => setShowIssues((o) => !o)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13.5px] font-semibold">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {issues.length} {issues.length === 1 ? "problem" : "problems"} to review
            <ChevronDown aria-hidden className={`ml-auto size-4 transition-transform duration-200 ${showIssues ? "rotate-180" : ""}`} />
          </button>
          {showIssues && (
            <ul className="space-y-1.5 border-t border-warn-line px-3.5 py-2.5 text-[13px] leading-snug" aria-label="Problems to review">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((r) => (
            <RuleCard key={r.id} r={r} {...rest} />
          ))}
        </ul>
      )}
    </div>
  );
});
