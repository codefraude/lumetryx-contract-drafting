"use client";

import { CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, type ReactNode } from "react";
import { Callout } from "@/shared/ui/Status";
import { GROUP_ORDER, type Field } from "../contracts/fields";
import { detailProgress } from "../progress";
import { FieldRow } from "./FieldRow";

interface Props {
  documentId: string;
  fields: Field[];
  locked: boolean;
  assistant: boolean;
  inactive: ReadonlySet<string>;
}

const byGroup = (a: Field, b: Field) => {
  return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (!count) {
    return null;
  }

  return (
    <section>
      <h3 className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-2 text-meta font-semibold text-ink-2 sm:px-5">
        {title}
        <span className="text-ink-3 tabular-nums">{count}</span>
      </h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

export const FieldPanel = memo(function FieldPanel({
  documentId,
  fields,
  locked,
  assistant,
  inactive,
}: Props) {
  const t = useTranslations("fields");
  const details = fields.filter((f) => f.source !== "condition");
  const active = details.filter((f) => !inactive.has(f.id));
  const needed = active
    .filter((f) => f.required && f.status !== "confirmed")
    .sort(byGroup);
  const done = active.filter((f) => f.status === "confirmed").sort(byGroup);
  const rest = details
    .filter(
      (f) => inactive.has(f.id) || (!f.required && f.status !== "confirmed"),
    )
    .sort(byGroup);
  const progress = detailProgress(fields, inactive);

  const row = (f: Field) => {
    return (
      <FieldRow
        key={`${f.id}:${f.rawValue ?? ""}:${f.required}`}
        documentId={documentId}
        f={f}
        inactive={inactive.has(f.id)}
        locked={locked}
      />
    );
  };

  if (!details.length) {
    return (
      <div className="px-4 py-4 sm:px-5">
        <Callout icon={CircleDashed} title={t("noFieldsTitle")}>
          {t("noFieldsBody")}
        </Callout>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <p className="text-ui font-semibold text-ink">
          {t("progress", {
            confirmed: progress.confirmed,
            total: progress.total,
          })}
        </p>
        <p className="mt-0.5 text-meta text-ink-2">
          {t(
            locked
              ? assistant
                ? "lockedAssistant"
                : "lockedNoAssistant"
              : assistant
                ? "openAssistant"
                : "openNoAssistant",
          )}
        </p>
      </div>
      <Section title={t("sections.stillNeeded")} count={needed.length}>
        {needed.map(row)}
      </Section>
      <Section title={t("sections.confirmed")} count={done.length}>
        {done.map(row)}
      </Section>
      <Section title={t("sections.notNeeded")} count={rest.length}>
        {rest.map(row)}
      </Section>
    </div>
  );
});
