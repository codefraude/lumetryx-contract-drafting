import { GROUP_ORDER, type Field } from "./contracts/fields";

/**
 * What is still needed before a draft can be generated. One definition, used by the assistant's
 * questions, draft generation and the saved-drafts list on the server, and by the workspace status,
 * the chat header and the Details panel in the browser.
 *
 * `inactive` holds fields that only appear inside excluded or undecided clauses, and condition
 * answers no active clause depends on: they are not needed right now.
 */

/** Required, unconfirmed fields in questioning order. */
export const outstandingFields = (fields: Field[], inactive: ReadonlySet<string> = new Set()): Field[] =>
  fields
    .filter((f) => f.required && f.status !== "confirmed" && !inactive.has(f.id))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

/**
 * Details the lawyer still has to give. A yes/no answer that decides a clause is counted as a
 * clause decision instead, so it is never counted twice.
 */
export const detailsLeft = (fields: Field[], inactive: ReadonlySet<string>): number =>
  outstandingFields(fields, inactive).filter((f) => f.source !== "condition").length;

export interface DetailProgress {
  confirmed: number;
  total: number;
}

/** Required details (not clause decisions) that are needed now, and how many are confirmed. */
export function detailProgress(fields: Field[], inactive: ReadonlySet<string>): DetailProgress {
  const required = fields.filter((f) => f.required && f.source !== "condition" && !inactive.has(f.id));
  return { confirmed: required.filter((f) => f.status === "confirmed").length, total: required.length };
}
