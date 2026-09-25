"use client";

import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useErrorText } from "@/i18n/error-text";
import { Button } from "@/shared/ui/Button";
import { StatusText, type Tone } from "@/shared/ui/Status";
import type { Field, VariantLang } from "../contracts/fields";
import { variantLangs } from "../progress";
import { useCorrectField } from "../queries";

const STATUS: Record<
  Field["status"],
  {
    tone: Tone;
    icon: typeof CircleCheck;
  }
> = {
  confirmed: {
    tone: "ok",
    icon: CircleCheck,
  },
  needs_clarification: {
    tone: "warn",
    icon: TriangleAlert,
  },
  missing: {
    tone: "neutral",
    icon: CircleDashed,
  },
};

const INPUT =
  "h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-ui text-ink transition-[border-color,box-shadow] duration-150 outline-none focus:border-accent-ink focus:ring-1 focus:ring-accent-ink dark:bg-raised pointer-coarse:h-11";

const longDate = (iso: string, locale: string) => {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
};

export function FieldRow({
  documentId,
  f,
  locked,
  inactive,
}: {
  documentId: string;
  f: Field;
  locked: boolean;
  inactive: boolean;
}) {
  const t = useTranslations("fields");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const errorText = useErrorText();
  const langs = variantLangs(f);
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [value, setValue] = useState(f.rawValue ?? "");
  const [wording, setWording] = useState<Partial<Record<VariantLang, string>>>(
    () => Object.fromEntries(f.variants.map((v) => [v.lang, v.value])),
  );
  const correction = useCorrectField(documentId);
  const busy = correction.isPending;
  const err = correction.error ? errorText(correction.error) : null;
  const id = useId();
  const s = STATUS[f.status];

  const issueText = () => {
    if (!f.issue) {
      return f.note;
    }

    const p = { ...f.issue.params };

    if (p.aIso && p.bIso) {
      p.a = longDate(p.aIso, locale);
      p.b = longDate(p.bIso, locale);
    }

    if (f.unit) {
      p.unit = t(`units.${f.unit}`);
    }

    return t(`issues.${f.issue.code}`, {
      input: "",
      a: "",
      b: "",
      thousands: "",
      decimal: "",
      symbol: "",
      candidates: "",
      amount: "",
      unit: "",
      end: "",
      start: "",
      values: "",
      evidence: "",
      missing: "",
      ...p,
    });
  };

  const shown = () => {
    if (f.resolution && f.resolution !== "value") {
      return t(`resolution.${f.resolution}`);
    }

    if (f.normalized?.kind === "date" && !f.normalized.figures) {
      return longDate(f.normalized.iso, locale);
    }

    return f.displayValue;
  };

  const resolve = (resolution: "none" | "not_applicable" | "left_blank") => {
    correction.mutate(
      {
        fieldId: f.id,
        resolution,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const saveWording = (pending: VariantLang[]) => {
    const [lang, ...rest] = pending;
    const text = lang ? wording[lang]?.trim() : undefined;

    if (!lang || !text) {
      setEditing(false);

      return;
    }

    correction.mutate(
      {
        fieldId: f.id,
        value: text,
        lang,
      },
      { onSuccess: () => saveWording(rest) },
    );
  };

  const note = f.status !== "confirmed" ? issueText() : null;
  const current = shown();
  const conditional =
    f.requiredReason?.code === "conditional"
      ? f.requiredReason.params.clause
      : undefined;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ui font-semibold text-ink">
          {f.label}
          {!f.required && (
            <span className="ml-1.5 font-normal text-ink-3">
              {t("optional")}
            </span>
          )}
        </p>
        {!inactive && (
          <StatusText tone={s.tone} icon={s.icon}>
            {t(`status.${f.status}`)}
          </StatusText>
        )}
      </div>
      {langs.length > 0 && f.variants.length > 0 ? (
        <ul className="mt-1 space-y-1 text-ui">
          {f.variants.map((v) => (
            <li key={v.lang}>
              <span className="mr-1.5 text-meta text-ink-3">
                {t("variants.language", { lang: v.lang })}
              </span>
              <span lang={v.lang} className="text-ink">
                {v.value}
              </span>
              {v.origin === "translation" && (
                <span className="block text-meta text-ink-3">
                  {t("variants.translated")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-ui">
          {current ? (
            <span className="border-b border-accent-ink/40 pb-px text-ink">
              {current}
            </span>
          ) : (
            <span className="inline-block min-w-36 border-b border-dashed border-control/50 pb-px text-ink-3">
              {inactive ? t("notNeeded") : t("notAnswered")}
            </span>
          )}
        </p>
      )}
      {inactive && (
        <p className="mt-1.5 text-meta text-ink-3">{t("inactive")}</p>
      )}
      {conditional && !inactive && (
        <p className="mt-1.5 text-meta text-ink-3">
          {t("reason.conditional", { clause: conditional })}
        </p>
      )}
      {note && (
        <p className="mt-1.5 flex gap-1.5 text-meta text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {note}
        </p>
      )}
      {f.confidence < 0.8 && (
        <p className="mt-1.5 text-meta text-ink-3">{t("lowConfidence")}</p>
      )}

      {editing ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();

            if (langs.length) {
              saveWording(langs);

              return;
            }

            correction.mutate(
              {
                fieldId: f.id,
                value: value.trim() || null,
              },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          {langs.length ? (
            langs.map((lang, i) => (
              <div key={lang} className="flex w-full flex-col gap-1">
                <label
                  className="text-meta text-ink-3"
                  htmlFor={`${id}-${lang}`}
                >
                  {t("variants.language", { lang })}
                </label>
                <input
                  id={`${id}-${lang}`}
                  lang={lang}
                  autoFocus={i === 0}
                  value={wording[lang] ?? ""}
                  onChange={(e) =>
                    setWording((w) => ({
                      ...w,
                      [lang]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                  className={INPUT}
                />
              </div>
            ))
          ) : (
            <>
              <label className="sr-only" htmlFor={`${id}-v`}>
                {f.label}
              </label>
              <input
                id={`${id}-v`}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
                className={INPUT}
              />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              {tCommon("save")}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {tCommon("cancel")}
            </Button>
            {f.valueType !== "party" && (
              <Button variant="ghost" onClick={() => resolve("none")}>
                {t("actions.none")}
              </Button>
            )}
            {f.valueType !== "party" && (
              <Button variant="ghost" onClick={() => resolve("not_applicable")}>
                {t("actions.notApplicable")}
              </Button>
            )}
            {!f.required && (
              <Button variant="ghost" onClick={() => resolve("left_blank")}>
                {t("actions.leaveBlank")}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="mt-1.5 -ml-2.5 flex flex-wrap items-center gap-1">
          {!locked && (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={Pencil}
                onClick={() => setEditing(true)}
              >
                {f.displayValue || f.resolution ? t("edit") : t("fillIn")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                busy={busy}
                onClick={() =>
                  correction.mutate({
                    fieldId: f.id,
                    required: !f.required,
                  })
                }
              >
                {f.required ? t("notAField") : t("markRequired")}
              </Button>
            </>
          )}
          {f.context.trim() && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showSource}
              aria-controls={`${id}-src`}
              onClick={() => setShowSource((o) => !o)}
            >
              {t("whereItAppears")}
              <ChevronDown
                aria-hidden
                className={`size-3.5 transition-transform duration-150 ${showSource ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>
      )}
      {showSource && (
        <blockquote
          id={`${id}-src`}
          className="mt-2 border-l-2 border-line pl-3 font-serif text-body text-ink-2"
        >
          {tCommon("quoted", { text: f.context.trim() })}
        </blockquote>
      )}
      {err && (
        <p role="alert" className="mt-2 text-meta text-danger">
          {err}
        </p>
      )}
    </li>
  );
}
