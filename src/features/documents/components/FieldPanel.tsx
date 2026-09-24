"use client";

import { CircleDashed } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Callout } from "@/shared/ui/Status";
import { GROUP_ORDER, type Field } from "../contracts/fields";
import { detailProgress } from "../progress";
import { FieldRow } from "./FieldRow";

interface Props {
  documentId: string;
  fields: Field[];
  /** When a draft exists, answers change through chat so the draft is patched safely. */
  locked: boolean;
  /** Fields only used by excluded or undecided clauses: kept, but not needed now. */
  inactive: ReadonlySet<string>;
}

const byGroup = (a: Field, b: Field) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <section>
      <h3 className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2 text-[12.5px] font-semibold text-ink-2 backdrop-blur-[2px] sm:px-5">
        {title}
        <span className="tabular-nums text-ink-3">{count}</span>
      </h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

/** Details: what is still needed first, then confirmed answers, then fields not needed now. */
export const FieldPanel = memo(function FieldPanel({ documentId, fields, locked, inactive }: Props) {
  // Yes/no answers that decide clauses live under Clauses, so they are not counted twice.
  const details = fields.filter((f) => f.source !== "condition");
  const active = details.filter((f) => !inactive.has(f.id));
  const needed = active.filter((f) => f.required && f.status !== "confirmed").sort(byGroup);
  const done = active.filter((f) => f.status === "confirmed").sort(byGroup);
  const rest = details.filter((f) => inactive.has(f.id) || (!f.required && f.status !== "confirmed")).sort(byGroup);
  const progress = detailProgress(fields, inactive);
  const row = (f: Field) => <FieldRow key={`${f.id}:${f.rawValue ?? ""}:${f.required}`} documentId={documentId} f={f} inactive={inactive.has(f.id)} locked={locked} />;

  if (!details.length)
    return (
      <div className="p-5">
        <Callout icon={CircleDashed} title="No fields were found in this template">
          Mark the blanks in Word as [NAME], {"{{name}}"}, a line of underscores or a placeholder box (content control), then upload the template again.
        </Callout>
      </div>
    );
  return (
    <div>
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <p className="text-[15px] font-semibold text-ink">
          {progress.confirmed} of {progress.total} required details confirmed
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">{locked ? "A draft exists, so change answers in the chat. The draft is then updated wherever you have not edited it yourself." : "Answer in the chat, or fill a detail in here."}</p>
      </div>
      <Section title="Still needed" count={needed.length}>{needed.map(row)}</Section>
      <Section title="Confirmed" count={done.length}>{done.map(row)}</Section>
      <Section title="Not needed now" count={rest.length}>{rest.map(row)}</Section>
    </div>
  );
});
