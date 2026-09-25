import type { Issue, IssueCode } from "@/features/documents/contracts/fields";

type Params = Record<string, string>;

const TEXT: Record<IssueCode, (p: Params) => string> = {
  ambiguous_date: (p) => {
    return `“${p.input}” could be ${p.a} or ${p.b}. Which did you mean?`;
  },
  invalid_date: (p) => {
    return `“${p.input}” is not a valid calendar date.`;
  },
  unreadable_date: (p) => {
    return `“${p.input}” could not be read as a date. Write it like 1 October 2026 or 1 octobre 2026.`;
  },
  ambiguous_amount: (p) => {
    return `“${p.input}” could mean ${p.thousands} (thousands) or ${p.decimal} (decimals). Which is it?`;
  },
  invalid_amount: (p) => {
    return `“${p.input}” is not a valid amount.`;
  },
  unreadable_amount: (p) => {
    return `I couldn't read “${p.input}” as an amount.`;
  },
  ambiguous_currency: (p) => {
    return `“${p.symbol}” is used by several currencies (${p.candidates}). Which one is it?`;
  },
  missing_currency: (p) => {
    return `Which currency is ${p.amount} in?`;
  },
  unknown_currency: (p) => {
    return `“${p.input}” is not a currency I recognise. Give its name or ISO code (for example EUR or MUR).`;
  },
  invalid_boolean: (p) => {
    return `Answer yes or no (oui ou non): “${p.input}” does not settle it.`;
  },
  invalid_email: (p) => {
    return `“${p.input}” is not a valid email address.`;
  },
  invalid_number: (p) => {
    return `“${p.input}” is not a whole number${p.unit ? ` of ${p.unit}` : ""}.`;
  },
  unit_mismatch: (p) => {
    return `The template counts this in ${p.unit}, but the answer was “${p.input}”. How many ${p.unit}?`;
  },
  date_order: (p) => {
    return `The end date (${p.end}) is not after the start date (${p.start}).`;
  },
  conflicting_values: (p) => {
    return `Two different values were given (${p.values}). Which one is right?`;
  },
  ambiguous_reference: (p) => {
    return `“${p.evidence}” could refer to ${p.candidates}. Which one did you mean?`;
  },
  required_field: () => {
    return "The template needs this detail, so it cannot be left blank or set to none. It can be marked optional under Details.";
  },
  translation_needed: (p) => {
    return `This text also appears in the ${p.missing === "fr" ? "French" : "English"} part of the contract. Give the ${p.missing === "fr" ? "French" : "English"} wording.`;
  },
  detected_blank: () => {
    return "Detected from a blank line; confirm what it should contain.";
  },
  detected_cell: () => {
    return "Detected from an empty table cell; confirm what it should contain.";
  },
};

export const issue = (code: IssueCode, params: Params = {}): Issue => {
  return {
    code,
    params,
  };
};

export const issueNote = (i: Issue): string => {
  return TEXT[i.code](i.params);
};
