import { GROUP_ORDER, type Field } from "./contracts/fields";

/**
 * What's still needed before generating; the server and the browser
 * both count from here. `inactive`: fields used only in excluded or
 * undecided clauses, and conditions no active clause needs.
 */

/** Required, unconfirmed fields in questioning order. */
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

/**
 * A yes/no answer that decides a clause
 * counts as a decision instead, never twice.
 */
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

/**
 * Required details (not clause decisions) that
 * are needed now, and how many are confirmed.
 */
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
