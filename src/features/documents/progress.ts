import { GROUP_ORDER, type Field, type VariantLang } from "./contracts/fields";

const IDENTIFIER =
  /reference|référence|\bref\b|number|numéro|\bno\b|code|identifi|\bid\b|name|nom|title|titre|e-?mail|courriel/i;

export const variantLangs = (f: Field): VariantLang[] => {
  if (
    f.valueType !== "text" ||
    IDENTIFIER.test(f.label) ||
    IDENTIFIER.test(f.id.replace(/_/g, " "))
  ) {
    return [];
  }

  const langs = new Set<VariantLang>();

  for (const o of f.occurrences) {
    if (o.lang === "en" || o.lang === "fr") {
      langs.add(o.lang);
    }
  }

  return langs.size > 1 ? [...langs] : [];
};

const deferred = (f: Field) => {
  return f.resolution === "unknown" ? 1 : 0;
};

export const outstandingFields = (
  fields: Field[],
  inactive: ReadonlySet<string> = new Set(),
): Field[] => {
  return fields
    .filter(
      (f) => f.required && f.status !== "confirmed" && !inactive.has(f.id),
    )
    .sort(
      (a, b) =>
        deferred(a) - deferred(b) ||
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
};

export const detailsLeft = (
  fields: Field[],
  inactive: ReadonlySet<string>,
): number => {
  return outstandingFields(fields, inactive).filter(
    (f) => f.source !== "condition",
  ).length;
};

export interface DetailProgress {
  confirmed: number;
  total: number;
}

export function detailProgress(
  fields: Field[],
  inactive: ReadonlySet<string>,
): DetailProgress {
  const required = fields.filter(
    (f) => f.required && f.source !== "condition" && !inactive.has(f.id),
  );

  return {
    confirmed: required.filter((f) => f.status === "confirmed").length,
    total: required.length,
  };
}

export const nextQuestions = (
  fields: Field[],
  inactive: ReadonlySet<string>,
  limit = 3,
): Field[] => {
  const open = outstandingFields(fields, inactive).filter(
    (f) => f.status === "missing",
  );
  const [head] = open;

  if (!head) {
    return [];
  }

  const same = open.filter(
    (f) => f.group === head.group && deferred(f) === deferred(head),
  );
  const sameOwner = head.owner
    ? same.filter((f) => f.owner === head.owner)
    : [];
  const rest = same.filter((f) => !sameOwner.includes(f));

  return [...sameOwner, ...rest].slice(0, limit);
};
