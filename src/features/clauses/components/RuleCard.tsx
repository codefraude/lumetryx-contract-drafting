"use client";

import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleSlash,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type {
  RuleAction,
  RuleView,
} from "@/features/documents/contracts/document-view";
import type {
  ChatLanguage,
  Field,
} from "@/features/documents/contracts/fields";
import { useErrorText } from "@/i18n/error-text";
import { Button } from "@/shared/ui/Button";
import { Callout, StatusText, type Tone } from "@/shared/ui/Status";
import { ClauseDecision } from "./ClauseDecision";

const STATE: Record<
  RuleView["state"],
  {
    tone: Tone;
    icon: typeof CircleCheck;
  }
> = {
  included: {
    tone: "ok",
    icon: CircleCheck,
  },
  excluded: {
    tone: "neutral",
    icon: CircleSlash,
  },
  unresolved: {
    tone: "warn",
    icon: CircleHelp,
  },
  proposed: {
    tone: "neutral",
    icon: Lightbulb,
  },
  dismissed: {
    tone: "neutral",
    icon: CircleMinus,
  },
};

export interface RuleCardProps {
  documentId: string;
  r: RuleView;
  fields: Field[];
  language: ChatLanguage;
  locked: boolean;
  onAction(ruleId: string, action: RuleAction): Promise<unknown>;
}

export function RuleCard({
  documentId,
  r,
  fields,
  language,
  locked,
  onAction,
}: RuleCardProps) {
  const t = useTranslations("clauses");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const [busy, setBusy] = useState<RuleAction | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const s = STATE[r.state];

  const act = async (a: RuleAction) => {
    setBusy(a);
    setErr(null);

    try {
      await onAction(r.id, a);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const btn = (
    a: RuleAction,
    label: string,
    variant: "primary" | "secondary" | "ghost" = "secondary",
  ) => {
    return (
      <Button
        size="sm"
        variant={variant}
        busy={busy === a}
        disabled={busy !== null}
        onClick={() => void act(a)}
      >
        {label}
      </Button>
    );
  };

  const evidence = r.evidence ?? "";

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 text-ui font-semibold text-ink">{r.label}</h3>
        <StatusText tone={s.tone} icon={s.icon}>
          {t(`state.${r.state}`)}
        </StatusText>
      </div>
      <p className="mt-0.5 text-meta text-ink-2">{r.reason}</p>

      {r.pending && (
        <Callout
          tone="warn"
          icon={TriangleAlert}
          role="status"
          className="mt-3"
          actions={
            <>
              {btn("apply", t("removeClause"), "primary")}
              {btn("include", t("keepClause"))}
            </>
          }
        >
          {t("pendingBody", { state: r.state })}
        </Callout>
      )}
      {r.state === "unresolved" && !r.pending && (
        <ClauseDecision
          documentId={documentId}
          r={r}
          field={fields.find((f) => f.id === r.condition.fieldId)}
          language={language}
          locked={locked}
        />
      )}
      {r.state === "proposed" && (
        <>
          {evidence && (
            <blockquote className="mt-3 border-l-2 border-line pl-3 font-serif text-body text-ink-2">
              <span className="sr-only">{t("templateSays")}</span>
              {tCommon("quoted", {
                text:
                  evidence.length > 180 && !more
                    ? `${evidence.slice(0, 180).trimEnd()}…`
                    : evidence,
              })}
              {evidence.length > 180 && (
                <button
                  type="button"
                  onClick={() => setMore((m) => !m)}
                  className="ml-1 font-sans text-meta font-medium text-accent-ink hover:underline pointer-coarse:min-h-11"
                >
                  {more ? t("showLess") : t("showAll")}
                </button>
              )}
            </blockquote>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {btn("confirm", t("makeConditional"), "primary")}
            {btn("dismiss", t("dismissSuggestion"), "ghost")}
          </div>
        </>
      )}
      {r.hasEditedVariant && r.applied === "excluded" && (
        <p className="mt-2 text-meta text-ink-2">{t("editedKept")}</p>
      )}

      {r.confirmed && !r.dismissed && !r.pending && (
        <div className="mt-2 -ml-2.5 flex flex-wrap gap-1">
          {r.override ? (
            btn("clear_override", t("followCondition"), "ghost")
          ) : (
            <>
              {btn("include", t("alwaysInclude"), "ghost")}
              {btn("exclude", t("alwaysExclude"), "ghost")}
            </>
          )}
        </div>
      )}
      {err !== null && (
        <p role="alert" className="mt-2 text-meta text-danger">
          {errorText(err)}
        </p>
      )}
    </li>
  );
}
