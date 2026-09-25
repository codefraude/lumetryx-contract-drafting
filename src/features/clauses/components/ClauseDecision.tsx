"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { RuleView } from "@/features/documents/contracts/document-view";
import type {
  ChatLanguage,
  Field,
} from "@/features/documents/contracts/fields";
import { useCorrectField } from "@/features/documents/queries";
import { useErrorText } from "@/i18n/error-text";
import { Button } from "@/shared/ui/Button";

export function ClauseDecision({
  documentId,
  r,
  field,
  language,
  locked,
}: {
  documentId: string;
  r: RuleView;
  field: Field | undefined;
  language: ChatLanguage;
  locked: boolean;
}) {
  const t = useTranslations("clauses");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const [value, setValue] = useState("");
  const id = useId();
  const correction = useCorrectField(documentId);
  const busy = correction.isPending
    ? (correction.variables.value ?? null)
    : null;
  const err = correction.error ? errorText(correction.error) : null;
  const question =
    (language === "fr" ? field?.questionFr : null) ??
    field?.question ??
    t("fallbackQuestion", { label: field?.label ?? r.condition.fieldId });

  const answer = (v: string) => {
    correction.mutate({
      fieldId: r.condition.fieldId,
      value: v,
    });
  };

  const yesNo =
    field?.valueType === "boolean" ||
    r.condition.op === "is_true" ||
    r.condition.op === "is_false";

  return (
    <div className="mt-3 rounded-card border border-warn-line bg-warn-surface px-3.5 py-3">
      <p className="text-ui font-medium text-ink">{question}</p>
      {locked ? (
        <p className="mt-1 text-meta text-ink-2">{t("answerInChat")}</p>
      ) : yesNo ? (
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            busy={busy === "Yes"}
            disabled={busy !== null}
            onClick={() => answer("Yes")}
          >
            {t("yes")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            busy={busy === "No"}
            disabled={busy !== null}
            onClick={() => answer("No")}
          >
            {t("no")}
          </Button>
        </div>
      ) : (
        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();

            if (value.trim()) {
              answer(value.trim());
            }
          }}
        >
          <label htmlFor={`${id}-v`} className="sr-only">
            {question}
          </label>
          <input
            id={`${id}-v`}
            list={`${id}-o`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-control border border-control bg-surface px-3 text-ui text-ink transition-[border-color,box-shadow] duration-150 outline-none focus:border-accent-ink focus:ring-1 focus:ring-accent-ink dark:bg-raised pointer-coarse:h-11"
          />
          <datalist id={`${id}-o`}>
            {r.condition.values.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            busy={busy !== null}
            disabled={!value.trim()}
          >
            {tCommon("save")}
          </Button>
        </form>
      )}
      {err && (
        <p role="alert" className="mt-2 text-meta text-danger">
          {err}
        </p>
      )}
    </div>
  );
}
