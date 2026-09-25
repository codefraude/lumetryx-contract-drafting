import type {
  Field,
  Lang,
  Resolution,
  Variant,
  VariantLang,
} from "@/features/documents/contracts/fields";
import { variantLangs } from "@/features/documents/progress";
import { issue, issueNote } from "./issues";
import { normalizeValue, properCase } from "./normalize";

export interface Proposal {
  resolution: Resolution;
  value?: string | null;
  lang?: Lang;
  onlyLang?: VariantLang | null;
  translation?: {
    lang: VariantLang;
    value: string;
  } | null;
  evidence?: string | null;
  figures?: string | null;
}

export interface ResolveContext {
  currencyHint: string | null;
  lang: Lang;
}

const cleared = {
  rawValue: null,
  displayValue: null,
  normalized: null,
  variants: [],
  note: null,
  issue: null,
};

const digits = (s: string) => {
  return (s.match(/\d+/g) ?? []).sort().join(",");
};

export const translationFits = (value: string, translation: string) => {
  const t = translation.trim();
  const ratio = t.length / Math.max(1, value.trim().length);

  return t !== "" && ratio > 0.3 && ratio < 3.5 && digits(value) === digits(t);
};

function withVariants(
  f: Field,
  p: Proposal,
  display: string,
): Pick<Field, "variants" | "status" | "note" | "issue"> {
  const langs = variantLangs(f);

  if (!langs.length) {
    return {
      variants: [],
      status: "confirmed",
      note: null,
      issue: null,
    };
  }

  const firstLang = langs[0] ?? "en";
  const own: VariantLang =
    p.onlyLang ??
    (p.lang === "en" || p.lang === "fr" ? p.lang : null) ??
    firstLang;
  const kept = p.onlyLang ? f.variants.filter((v) => v.lang !== own) : [];
  const variants: Variant[] = [
    ...kept,
    {
      lang: own,
      value: display,
      origin: "user",
    },
  ];
  const t = p.translation;

  if (
    t &&
    t.lang !== own &&
    langs.includes(t.lang) &&
    !variants.some((v) => v.lang === t.lang) &&
    translationFits(display, t.value)
  ) {
    variants.push({
      lang: t.lang,
      value: t.value.trim(),
      origin: "translation",
    });
  }

  const missing = langs.find((l) => !variants.some((v) => v.lang === l));

  if (missing) {
    const i = issue("translation_needed", { missing });

    return {
      variants,
      status: "needs_clarification",
      note: issueNote(i),
      issue: i,
    };
  }

  return {
    variants,
    status: "confirmed",
    note: null,
    issue: null,
  };
}

export function resolveField(
  f: Field,
  p: Proposal,
  ctx: ResolveContext,
): Field {
  const evidence = p.evidence?.slice(0, 400) ?? null;

  if (p.resolution === "unknown") {
    return {
      ...f,
      ...cleared,
      status: "missing",
      resolution: "unknown",
      evidence,
    };
  }

  const refuses =
    (p.resolution === "left_blank" && f.required) ||
    ((p.resolution === "none" || p.resolution === "not_applicable") &&
      f.valueType === "party" &&
      f.role === null);

  if (refuses) {
    const i = issue("required_field");

    return {
      ...f,
      ...cleared,
      status: "needs_clarification",
      resolution: null,
      note: issueNote(i),
      issue: i,
      evidence,
    };
  }

  if (p.resolution !== "value") {
    return {
      ...f,
      ...cleared,
      status: "confirmed",
      resolution: p.resolution,
      evidence,
    };
  }

  const given = (p.value ?? "").trim();

  if (!given) {
    return {
      ...f,
      ...cleared,
      status: "missing",
      resolution: null,
      evidence,
    };
  }

  if (p.onlyLang && f.displayValue && variantLangs(f).includes(p.onlyLang)) {
    return {
      ...f,
      ...withVariants(f, p, given),
      evidence,
    };
  }

  const value =
    f.valueType === "party" || f.valueType === "address"
      ? properCase(given)
      : given;
  const r = normalizeValue(f.valueType, value, {
    currencyHint: ctx.currencyHint,
    lang: ctx.lang,
    unit: f.unit,
  });
  const figures =
    p.figures && r.normalized?.kind === "date"
      ? {
          ...r.normalized,
          figures: p.figures,
        }
      : null;
  const display = figures ? (p.figures ?? value) : r.displayValue;
  const base: Field = {
    ...f,
    rawValue: value,
    status: r.status,
    displayValue: display,
    normalized: figures ?? r.normalized,
    note: r.note,
    issue: r.issue,
    resolution: r.status === "confirmed" ? "value" : null,
    evidence,
    variants: [],
  };

  if (r.status !== "confirmed" || !display) {
    return base;
  }

  return {
    ...base,
    ...withVariants(f, p, display),
  };
}
