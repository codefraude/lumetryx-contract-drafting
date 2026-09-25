import type { useTranslations } from "next-intl";
import { needsAttention, visibleRules } from "@/features/clauses/clause-status";
import type { DocumentView } from "@/features/documents/contracts/document-view";
import type { SaveStatus } from "@/features/documents/editor/save-coordinator";
import {
  detailProgress,
  detailsLeft,
  outstandingFields,
} from "@/features/documents/progress";

export type StatusTone = "busy" | "ok" | "neutral" | "warn" | "danger";

export type StatusTranslator = ReturnType<typeof useTranslations<"status">>;

export interface StatusLine {
  text: string;
  tone: StatusTone;
}

const SAVE_TONE: Record<SaveStatus, StatusTone> = {
  loading: "busy",
  saved: "ok",
  unsaved: "neutral",
  saving: "busy",
  error: "danger",
  conflict: "warn",
  viewing: "neutral",
};

export const clockTime = (iso: string, locale: string) => {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const stillNeeded = (
  t: StatusTranslator,
  details: number,
  decisions: number,
) => {
  if (details && decisions) {
    return t("bothNeeded", {
      details,
      decisions,
    });
  }

  if (details) {
    return t("detailsNeeded", { details });
  }

  return decisions ? t("decisionsNeeded", { decisions }) : null;
};

export interface DocumentProgress {
  confirmed: number;
  total: number;
  detailsLeft: number;
  decisions: number;
  ready: boolean;
  hasClauses: boolean;
  attention: number;
}

export function documentProgress(
  doc: DocumentView,
  inactive: ReadonlySet<string>,
): DocumentProgress {
  const decisions = doc.rules.filter((r) => r.state === "unresolved").length;
  const rules = visibleRules(doc.rules);
  const issues = doc.ruleIssues.length + doc.structureIssues.length;

  return {
    ...detailProgress(doc.fields, inactive),
    detailsLeft: detailsLeft(doc.fields, inactive),
    decisions,
    ready:
      outstandingFields(doc.fields, inactive).length === 0 && decisions === 0,
    hasClauses: rules.length > 0 || issues > 0,
    attention: rules.filter(needsAttention).length + issues,
  };
}

export function statusLine(
  t: StatusTranslator,
  p: DocumentProgress,
  {
    generating,
    hasDraft,
    save,
    savedAt,
    locale,
  }: {
    generating: boolean;
    hasDraft: boolean;
    save: SaveStatus;
    savedAt: string;
    locale: string;
  },
): StatusLine {
  if (generating) {
    return {
      text: t("generating"),
      tone: "busy",
    };
  }

  if (hasDraft) {
    return {
      text:
        save === "saved"
          ? t("savedAt", { time: clockTime(savedAt, locale) })
          : t(save),
      tone: SAVE_TONE[save],
    };
  }

  const need = stillNeeded(t, p.detailsLeft, p.decisions);

  return need
    ? {
        text: need,
        tone: "neutral",
      }
    : {
        text: t("ready"),
        tone: "ok",
      };
}

export const exportWarnings = (
  t: StatusTranslator,
  d: DocumentView,
): string[] => {
  return [
    ...d.rules
      .filter((r) => r.state === "unresolved")
      .map((r) => t("undecided", { label: r.label })),
    ...d.rules
      .filter((r) => r.pending)
      .map((r) => t("awaitingConfirmation", { label: r.label })),
    ...d.structureIssues.map((i) => i.message),
    ...d.ruleIssues,
  ];
};
