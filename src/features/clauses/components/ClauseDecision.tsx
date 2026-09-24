"use client";

import { useId, useState } from "react";
import type { RuleView } from "@/features/documents/contracts/document-view";
import type { ChatLanguage, Field } from "@/features/documents/contracts/fields";
import { useCorrectField } from "@/features/documents/queries";
import { errorMessage } from "@/lib/http";
import { Button } from "@/shared/ui/Button";

/** The yes/no (or value) answer an undecided clause waits for. */
export function ClauseDecision({ documentId, r, field, language, locked }: { documentId: string; r: RuleView; field: Field | undefined; language: ChatLanguage; locked: boolean }) {
  const [value, setValue] = useState("");
  const id = useId();
  const correction = useCorrectField(documentId);
  const busy = correction.isPending ? (correction.variables.value ?? null) : null;
  const err = correction.error ? errorMessage(correction.error) : null;
  const question = (language === "fr" ? field?.questionFr : null) ?? field?.question ?? `What is “${field?.label ?? r.condition.fieldId}”?`;
  const answer = (v: string) => correction.mutate({ fieldId: r.condition.fieldId, value: v });
  const yesNo = field?.valueType === "boolean" || r.condition.op === "is_true" || r.condition.op === "is_false";
  return (
    <div className="mt-3 rounded-xl border border-warn-line bg-warn-surface/60 p-3">
      <p className="text-[13.5px] font-medium leading-snug text-ink">{question}</p>
      {locked ? (
        <p className="mt-1.5 text-[13px] text-ink-2">Answer in the chat, so the draft is updated safely.</p>
      ) : yesNo ? (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" variant="secondary" busy={busy === "Yes"} disabled={busy !== null} onClick={() => answer("Yes")}>Yes</Button>
          <Button size="sm" variant="secondary" busy={busy === "No"} disabled={busy !== null} onClick={() => answer("No")}>No</Button>
        </div>
      ) : (
        <form
          className="mt-2.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) answer(value.trim());
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
