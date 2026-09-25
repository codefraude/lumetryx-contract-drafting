import { GROUP_ORDER, type Field } from "./contracts/fields";

export const outstandingFields = (
  fields: Field[],
  inactive: ReadonlySet<string> = new Set(),
): Field[] => {
  return fields
    .filter(
      (f) => f.required && f.status !== "confirmed" && !inactive.has(f.id),
    )
    .sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
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
