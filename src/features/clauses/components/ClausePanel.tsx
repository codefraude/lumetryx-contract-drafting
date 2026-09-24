"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { memo, useState } from "react";
import type { DocumentView, RuleView } from "@/features/documents/contracts/document-view";
import { byAttention, needsAttention, visibleRules } from "../clause-status";
import { RuleCard, type RuleCardProps } from "./RuleCard";

interface Props extends Omit<RuleCardProps, "r"> {
  rules: RuleView[];
  ruleIssues: string[];
  structureIssues: DocumentView["structureIssues"];
}

/** Conditional clauses with their status and reason, and any problems the document structure raised. */
export const ClausePanel = memo(function ClausePanel({ rules, ruleIssues, structureIssues, ...rest }: Props) {
  const [showIssues, setShowIssues] = useState(true);
  const visible = visibleRules(rules).sort(byAttention);
  const issues = [...ruleIssues, ...structureIssues.map((i) => i.message)];
  const included = visible.filter((r) => r.state === "included").length;
  const excluded = visible.filter((r) => r.state === "excluded").length;
  const attention = visible.filter(needsAttention).length;
  return (
    <div>
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <p className="text-ui font-semibold text-ink">Conditional clauses</p>
        <p className="mt-0.5 text-meta text-ink-2">
          {visible.length
            ? `${included} included, ${excluded} excluded${attention ? `, ${attention} waiting for you` : ""}.`
            : "This template has no conditional clauses."}{" "}
          Clauses follow your answers; a suggested condition applies only after you confirm it.
        </p>
      </div>
      {issues.length > 0 && (
        <div className="mx-4 mb-4 rounded-card border border-warn-line bg-warn-surface sm:mx-5">
          <button
            type="button"
            aria-expanded={showIssues}
            onClick={() => setShowIssues((o) => !o)}
            className="flex w-full items-center gap-2 rounded-card px-3.5 py-2.5 text-left text-ui font-semibold text-warn focus-visible:-outline-offset-2 pointer-coarse:min-h-11"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {issues.length} {issues.length === 1 ? "problem" : "problems"} to review
            <ChevronDown aria-hidden className={`ml-auto size-4 transition-transform duration-150 ${showIssues ? "rotate-180" : ""}`} />
          </button>
          {showIssues && (
            <ul className="space-y-1.5 border-t border-warn-line px-3.5 py-2.5 text-meta text-ink-2" aria-label="Problems to review">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {visible.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {visible.map((r) => (
            <RuleCard key={r.id} r={r} {...rest} />
          ))}
        </ul>
      )}
    </div>
  );
});
