import type {
  DocLanguage,
  Field,
  FieldStatus,
  Issue,
  Lang,
  NormalizedValue,
  Unit,
  ValueType,
} from "@/features/documents/contracts/fields";
import { AMBIGUOUS_SYMBOLS, currencyOf } from "./currency";
import { issue, issueNote } from "./issues";
import {
  formatBoolean,
  formatDate,
  formatMoney,
  monthNumber,
  parseAmount,
  renderLang,
} from "./lang";

export interface NormalizeResult {
  status: FieldStatus;
  displayValue: string | null;
  normalized: NormalizedValue | null;
  note: string | null;
  issue: Issue | null;
}

const confirmed = (
  displayValue: string,
  normalized: NormalizedValue,
): NormalizeResult => {
  return {
    status: "confirmed",
    displayValue,
    normalized,
    note: null,
    issue: null,
  };
};

const unclear = (
  i: Issue,
  normalized: NormalizedValue | null = null,
): NormalizeResult => {
  return {
    status: "needs_clarification",
    displayValue: null,
    normalized,
    note: issueNote(i),
    issue: i,
  };
};

const isValidYmd = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) {
    return false;
  }

  const dt = new Date(Date.UTC(y, m - 1, d));

  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

const iso = (y: number, m: number, d: number) => {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export const formatLongDate = (isoDate: string): string => {
  return formatDate(isoDate, "en");
};

export function parseDate(input: string): NormalizeResult {
  const s = input
    .trim()
    .replace(/^(le|on|the)\s+/i, "")
    .replace(/(\d)(st|nd|rd|th|er|re)\b/gi, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");

  const invalid = () => {
    return unclear(issue("invalid_date", { input }));
  };

  const ok = (isoDate: string) => {
    return confirmed(formatLongDate(isoDate), {
      kind: "date",
      iso: isoDate,
    });
  };

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);

  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];

    return isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }

  m = /^(\d{1,2}) (\p{L}+)\.? (\d{4})$/u.exec(s);

  if (m) {
    const mo = monthNumber(m[2] ?? "");
    const [d, y] = [Number(m[1]), Number(m[3])];

    return mo > 0 && isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }

  m = /^(\p{L}+)\.? (\d{1,2}) (\d{4})$/u.exec(s);

  if (m) {
    const mo = monthNumber(m[1] ?? "");
    const [d, y] = [Number(m[2]), Number(m[3])];

    return mo > 0 && isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);

  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dmy = isValidYmd(y, b, a);
    const mdy = isValidYmd(y, a, b);

    if (dmy && mdy && a !== b) {
      return unclear(
        issue("ambiguous_date", {
          input,
          a: formatLongDate(iso(y, b, a)),
          b: formatLongDate(iso(y, a, b)),
          aIso: iso(y, b, a),
          bIso: iso(y, a, b),
        }),
      );
    }

    if (dmy) {
      return ok(iso(y, b, a));
    }

    if (mdy) {
      return ok(iso(y, a, b));
    }

    return invalid();
  }

  return unclear(issue("unreadable_date", { input }));
}

const UNAMBIGUOUS: Record<string, string> = {
  mur: "MUR",
  usd: "USD",
  us$: "USD",
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "£": "GBP",
  gbp: "GBP",
  zar: "ZAR",
  inr: "INR",
  aud: "AUD",
  cad: "CAD",
  sgd: "SGD",
  pkr: "PKR",
  chf: "CHF",
};
const SYMBOL_SHOWN: Record<string, string> = {
  $: "$",
  dollar: "$",
  dollars: "$",
};
const DISPLAY: Record<string, string> = {
  MUR: "Rs",
  INR: "Rs",
  PKR: "Rs",
  LKR: "Rs",
  NPR: "Rs",
};

export function parseMoney(
  input: string,
  currencyHint?: string | null,
  lang: Lang = "unknown",
): NormalizeResult {
  const s = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*(per|a|\/|par)\s*(month|year|annum|mois|an|année)\b.*$/i, "")
    .replace(/\b(monthly|mensuel(le)?s?)\b/i, "")
    .trim();
  const m =
    /^([^\d\s.,]{1,8}\.?)?\s?(\d[\d,.\s  ]*\d|\d)\s?([\p{L}€£$₨]{1,9}\.?)?$/iu.exec(
      s,
    );

  if (!m) {
    return unclear(issue("unreadable_amount", { input }));
  }

  const parsed = parseAmount(m[2] ?? "", lang);

  if (!parsed.ok) {
    return unclear(parsed.issue);
  }

  const amount = parsed.amount;
  const symbol = (m[1] ?? m[3] ?? "").toLowerCase().trim();
  const hint = currencyHint?.toUpperCase() ?? null;
  let code: string | null = UNAMBIGUOUS[symbol] ?? null;
  let display = code;
  const candidates = AMBIGUOUS_SYMBOLS[symbol];

  if (candidates) {
    display = SYMBOL_SHOWN[symbol] ?? "Rs";
    code = hint && candidates.includes(hint) ? hint : null;

    if (!code) {
      return unclear(
        issue("ambiguous_currency", {
          symbol: display,
          candidates: candidates.join(", "),
          amount,
        }),
        {
          kind: "money",
          amount,
          currency: "XXX",
        },
      );
    }
  }

  if (!symbol && hint && /^[A-Z]{3}$/.test(hint)) {
    code = hint;
    display = DISPLAY[hint] ?? hint;
  }

  if (!code) {
    return unclear(issue("missing_currency", { amount }), {
      kind: "money",
      amount,
      currency: "XXX",
    });
  }

  const shown = display ?? code;

  return confirmed(formatMoney(amount, shown, "en"), {
    kind: "money",
    amount,
    currency: code,
    ...(shown !== code ? { symbol: shown } : {}),
  });
}

export function templateCurrencyHint(allText: string): string | null {
  const found = new Set<string>();

  if (
    /\bMUR\b|Mauritian rupee|roupies? mauricienne|Republic of Mauritius|République de Maurice/i.test(
      allText,
    )
  ) {
    found.add("MUR");
  }

  if (/\bINR\b|Indian rupee/i.test(allText)) {
    found.add("INR");
  }

  if (/\bUSD\b|US dollar/i.test(allText)) {
    found.add("USD");
  }

  if (/\bEUR\b|\beuros?\b|€/i.test(allText)) {
    found.add("EUR");
  }

  if (/\bGBP\b|pounds sterling|livres? sterling|£/i.test(allText)) {
    found.add("GBP");
  }

  return found.size === 1 ? ([...found][0] ?? null) : null;
}

export function parseBoolean(input: string): NormalizeResult {
  const s = input.trim().toLowerCase();
  const val = /^(yes|y|true|oui|vrai|affirmative|correct|exact)\b/.test(s)
    ? true
    : /^(no|n|false|non|faux|negative)\b/.test(s)
      ? false
      : null;

  if (val === null) {
    return unclear(issue("invalid_boolean", { input }));
  }

  return confirmed(formatBoolean(val, "en"), {
    kind: "boolean",
    value: val,
  });
}

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/;

export function parseEmail(input: string): NormalizeResult {
  const value = input.trim().replace(/^mailto:/i, "");

  return EMAIL.test(value)
    ? confirmed(value, {
        kind: "text",
        value,
      })
    : unclear(issue("invalid_email", { input }));
}

export function parseCurrency(input: string): NormalizeResult {
  const symbol = input.trim().toLowerCase();
  const candidates = AMBIGUOUS_SYMBOLS[symbol];

  if (candidates) {
    return unclear(
      issue("ambiguous_currency", {
        symbol: input.trim(),
        candidates: candidates.join(", "),
      }),
    );
  }

  const code = UNAMBIGUOUS[symbol] ?? currencyOf(input);

  return code
    ? confirmed(code, {
        kind: "text",
        value: code,
      })
    : unclear(issue("unknown_currency", { input }));
}

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  sixty: 60,
  ninety: 90,
  zéro: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  quinze: 15,
  vingt: 20,
  trente: 30,
  quarante: 40,
  soixante: 60,
  "quatre-vingt-dix": 90,
};

const UNIT_TEXT: Record<Unit, RegExp> = {
  days: /^(calendar )?days?$|^jours?( calendaires)?$/,
  business_days:
    /^(business|working) days?$|^jours? (ouvrés|ouvres|ouvrables)$/,
  hours: /^hours?$|^heures?$/,
  weeks: /^weeks?$|^semaines?$/,
  months: /^months?$|^mois$/,
  years: /^years?$|^ans?$|^années?$/,
  persons: /^(persons?|people|occupants?|personnes?)$/,
};

const UNIT_NAMES: Record<Unit, string> = {
  days: "days",
  business_days: "business days",
  hours: "hours",
  weeks: "weeks",
  months: "months",
  years: "years",
  persons: "persons",
};

export function parseCount(
  input: string,
  unit: Unit | null,
  decimals = false,
): NormalizeResult {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^(the|le|la)\s+/, "")
    .replace(/\s*%\s*$/, "");
  const m =
    /^(\d+(?:[.,]\d+)?|[\p{L}-]+?)(?:st|nd|rd|th|er|ème)?(?:\s+(.+))?$/u.exec(
      s,
    );
  const unitName = unit ? UNIT_NAMES[unit] : "";

  if (!m) {
    return unclear(
      issue("invalid_number", {
        input,
        unit: unitName,
      }),
    );
  }

  const [, head = "", tail] = m;
  const n = /^\d/.test(head)
    ? Number(head.replace(",", "."))
    : (WORDS[head] ?? Number.NaN);

  if (!Number.isFinite(n) || n < 0 || (!decimals && !Number.isInteger(n))) {
    return unclear(
      issue("invalid_number", {
        input,
        unit: unitName,
      }),
    );
  }

  if (tail && unit && !UNIT_TEXT[unit].test(tail.trim())) {
    return unclear(
      issue("unit_mismatch", {
        input,
        unit: unitName,
      }),
    );
  }

  const value = String(n);

  return confirmed(unit ? value : input.trim(), {
    kind: "number",
    value,
  });
}

export function normalizeValue(
  valueType: ValueType,
  raw: string,
  opts: {
    currencyHint?: string | null;
    lang?: Lang;
    unit?: Unit | null;
  } = {},
): NormalizeResult {
  const value = raw.trim();

  if (!value) {
    return {
      status: "missing",
      displayValue: null,
      normalized: null,
      note: null,
      issue: null,
    };
  }

  switch (valueType) {
    case "date":
      return parseDate(value);
    case "money":
      return parseMoney(value, opts.currencyHint, opts.lang);
    case "boolean":
      return parseBoolean(value);
    case "email":
      return parseEmail(value);
    case "currency":
      return parseCurrency(value);
    case "number":
      return parseCount(value, opts.unit ?? null, !opts.unit);
    case "duration":
      return opts.unit
        ? parseCount(value, opts.unit)
        : confirmed(value, {
            kind: "number",
            value,
          });
    case "percentage":
      return parseCount(value, null, true);
    default:
      return confirmed(value, {
        kind: "text",
        value,
      });
  }
}

const LOWER_WORDS = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "of",
  "the",
  "and",
  "van",
  "von",
  "der",
  "den",
  "da",
  "di",
  "au",
  "aux",
]);

export function properCase(value: string): string {
  if (/\p{Lu}/u.test(value) || /@|https?:/.test(value)) {
    return value;
  }

  return value.replace(/\p{L}[\p{L}'’-]*/gu, (word, at: number) => {
    return at > 0 && LOWER_WORDS.has(word)
      ? word
      : word.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => {
          return sep + ch.toUpperCase();
        });
  });
}

const RESOLUTION_TEXT = {
  none: {
    en: "None",
    fr: "Néant",
  },
  not_applicable: {
    en: "Not applicable",
    fr: "Sans objet",
  },
};

export function renderAt(
  f: Field,
  occurrenceLang: Lang,
  docLang: DocLanguage,
): string | null {
  if (f.status !== "confirmed" || f.resolution === "left_blank") {
    return null;
  }

  const lang = renderLang(occurrenceLang, docLang);

  if (f.resolution === "none" || f.resolution === "not_applicable") {
    return RESOLUTION_TEXT[f.resolution][lang];
  }

  if (!f.displayValue) {
    return null;
  }

  const variant = f.variants.find((v) => v.lang === occurrenceLang);

  if (variant) {
    return variant.value;
  }

  const n = f.normalized;

  if (n?.kind === "date") {
    return n.figures ?? formatDate(n.iso, lang);
  }

  if (n?.kind === "money") {
    return formatMoney(n.amount, n.symbol ?? n.currency, lang);
  }

  if (n?.kind === "boolean") {
    return formatBoolean(n.value, lang);
  }

  return f.displayValue;
}

const START =
  /\b(start|commence|begin|effective|début|debut|prise d'effet|entrée en vigueur)/i;
const END =
  /\b(end|expir|terminat|completion|fin\b|fin prévue|échéance|echeance)/i;

export function chronologyIssues(fields: Field[]): {
  fieldId: string;
  issue: Issue;
}[] {
  const dates = fields.filter(
    (f) => f.normalized?.kind === "date" && f.status === "confirmed",
  );
  const start = dates.find((f) => START.test(f.label) || START.test(f.id));
  const out: {
    fieldId: string;
    issue: Issue;
  }[] = [];

  if (start?.normalized?.kind !== "date") {
    return out;
  }

  for (const end of dates) {
    if (
      end !== start &&
      (END.test(end.label) || END.test(end.id)) &&
      !START.test(end.label) &&
      end.normalized?.kind === "date" &&
      end.normalized.iso <= start.normalized.iso
    ) {
      out.push({
        fieldId: end.id,
        issue: issue("date_order", {
          start: start.displayValue ?? start.normalized.iso,
          end: end.displayValue ?? end.normalized.iso,
        }),
      });
    }
  }

  return out;
}
