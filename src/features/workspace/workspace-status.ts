import { needsAttention, visibleRules } from "@/features/clauses/clause-status";
import type { DocumentView } from "@/features/documents/contracts/document-view";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import { detailProgress, detailsLeft, outstandingFields } from "@/features/documents/progress";

/** What the workspace shows about the open draft, derived from its view and the editor's save state. */

export type StatusTone = "busy" | "ok" | "neutral" | "warn" | "danger";

export interface StatusLine {
  text: string;
  tone: StatusTone;
  /** Changes when the line's meaning changes, so its icon animates once. */
  key: string;
}

const SAVE: Record<SaveStatus, { text: string; tone: StatusTone }> = {
  loading: { text: "Opening…", tone: "busy" },
  saved: { text: "Saved", tone: "ok" },
  unsaved: { text: "Unsaved changes", tone: "neutral" },
  saving: { text: "Saving…", tone: "busy" },
  error: { text: "Save failed", tone: "danger" },
  conflict: { text: "Changed in another tab", tone: "warn" },
  viewing: { text: "Template preview", tone: "neutral" },
};

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface DocumentProgress {
  confirmed: number;
  total: number;
  detailsLeft: number;
  /** Clause decisions still to make. */
  decisions: number;
  /** Nothing required is missing: the draft can be generated. */
  ready: boolean;
  hasClauses: boolean;
  /** Clauses and clause problems that need the lawyer. */
  attention: number;
}

/** What is still needed. A yes/no answer that settles an undecided clause counts once, as a decision. */
export function documentProgress(doc: DocumentView, inactive: ReadonlySet<string>): DocumentProgress {
  const decisions = doc.rules.filter((r) => r.state === "unresolved").length;
  const rules = visibleRules(doc.rules);
  const issues = doc.ruleIssues.length + doc.structureIssues.length;
  return {
    ...detailProgress(doc.fields, inactive),
    detailsLeft: detailsLeft(doc.fields, inactive),
    decisions,
    ready: outstandingFields(doc.fields, inactive).length === 0 && decisions === 0,
    hasClauses: rules.length > 0 || issues > 0,
    attention: rules.filter(needsAttention).length + issues,
  };
}

/** The header's status: generating, the editor's save state once a draft exists, or what is still needed. */
export function statusLine(p: DocumentProgress, { generating, hasDraft, save, savedAt }: { generating: boolean; hasDraft: boolean; save: SaveStatus; savedAt: string }): StatusLine {
  if (generating) return { text: "Generating the draft…", tone: "busy", key: "generating" };
  if (hasDraft) return { text: save === "saved" ? `Saved at ${clockTime(savedAt)}` : SAVE[save].text, tone: SAVE[save].tone, key: `${save}:${savedAt}` };
  const need = [p.detailsLeft && count(p.detailsLeft, "detail"), p.decisions && count(p.decisions, "decision")].filter(Boolean).join(" and ");
  return need ? { text: `${need} still needed`, tone: "neutral", key: need } : { text: "Ready to generate", tone: "ok", key: "ready" };
}

/** Issues the lawyer should see before exporting a contract that may be incomplete or broken. */
export const exportWarnings = (d: DocumentView): string[] => [
  ...d.rules.filter((r) => r.state === "unresolved").map((r) => `“${r.label}” is still undecided.`),
  ...d.rules.filter((r) => r.pending).map((r) => `“${r.label}” waits for your confirmation.`),
  ...d.structureIssues.map((i) => i.message),
  ...d.ruleIssues,
];
