import { formatBoolean, formatDate, formatMoney, monthNumber, parseAmount, renderLang } from "./lang";
import type { DocLanguage, Field, FieldStatus, Lang, NormalizedValue, ValueType } from "./types";

export interface NormalizeResult {
  status: FieldStatus;
  displayValue: string | null;
  normalized: NormalizedValue | null;
  note: string | null;
}

const isValidYmd = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  // Calendar arithmetic in UTC only — never shifts a date-only value.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const formatLongDate = (isoDate: string): string => formatDate(isoDate, "en");

/** Parses an English or French date without any timezone. Numeric d/m ambiguity is surfaced, never guessed. */
export function parseDate(input: string): NormalizeResult {
  const s = input
    .trim()
    .replace(/^(le|on|the)\s+/i, "")
    .replace(/(\d)(st|nd|rd|th|er|re)\b/gi, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  const bad = (note: string): NormalizeResult => ({ status: "needs_clarification", displayValue: null, normalized: null, note });
  const invalid = () => bad(`“${input}” is not a valid calendar date.`);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }
  m = /^(\d{1,2}) (\p{L}+)\.? (\d{4})$/u.exec(s);
  if (m) {
    const mo = monthNumber(m[2]!);
    const [d, y] = [Number(m[1]), Number(m[3])];
    return mo > 0 && isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }
  m = /^(\p{L}+)\.? (\d{1,2}) (\d{4})$/u.exec(s);
  if (m) {
    const mo = monthNumber(m[1]!);
    const [d, y] = [Number(m[2]), Number(m[3])];
    return mo > 0 && isValidYmd(y, mo, d) ? ok(iso(y, mo, d)) : invalid();
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dmy = isValidYmd(y, b, a);
    const mdy = isValidYmd(y, a, b);
    if (dmy && mdy && a !== b) return bad(`“${input}” could be ${formatLongDate(iso(y, b, a))} or ${formatLongDate(iso(y, a, b))}. Which did you mean?`);
    if (dmy) return ok(iso(y, b, a));
    if (mdy) return ok(iso(y, a, b));
    return invalid();
  }
  return bad(`I couldn't read “${input}” as a date. Please give it like 1 October 2026 or 1 octobre 2026.`);

  function ok(isoDate: string): NormalizeResult {
    return { status: "confirmed", displayValue: formatLongDate(isoDate), normalized: { kind: "date", iso: isoDate }, note: null };
  }
}

const UNAMBIGUOUS: Record<string, string> = { mur: "MUR", usd: "USD", "us$": "USD", "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR", "£": "GBP", gbp: "GBP", zar: "ZAR", inr: "INR", aud: "AUD", cad: "CAD", sgd: "SGD", pkr: "PKR" };
/** Symbols shared by several currencies: resolved only by an explicit hint, never guessed. */
const RUPEES = { display: "Rs", candidates: ["MUR", "INR", "PKR", "LKR", "NPR"] };
const DOLLARS = { display: "$", candidates: ["USD", "AUD", "CAD", "SGD", "NZD"] };
const AMBIGUOUS: Record<string, { display: string; candidates: string[] }> = { rs: RUPEES, "rs.": RUPEES, "₨": RUPEES, rupees: RUPEES, roupies: RUPEES, $: DOLLARS, dollars: DOLLARS };
const DISPLAY: Record<string, string> = { MUR: "Rs", INR: "Rs", PKR: "Rs", LKR: "Rs", NPR: "Rs" };

/**
 * Parses money as an exact decimal string (never a float). A bare number, or an ambiguous
 * symbol such as “Rs” or “$”, needs a currency established by the template or the user.
 * `lang` is the language context of the answer and settles "25,000" (English) vs "25,500" style decimals.
 */
export function parseMoney(input: string, currencyHint?: string | null, lang: Lang = "unknown"): NormalizeResult {
  const s = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*(per|a|\/|par)\s*(month|year|annum|mois|an|année)\b.*$/i, "")
    .replace(/\b(monthly|mensuel(le)?s?)\b/i, "")
    .trim();
  const m = /^([^\d\s.,]{1,8}\.?)?\s?(\d[\d,.\s  ]*\d|\d)\s?([\p{L}€£$₨]{1,9}\.?)?$/iu.exec(s);
  const unreadable = (note: string): NormalizeResult => ({ status: "needs_clarification", displayValue: null, normalized: null, note });
  if (!m) return unreadable(`I couldn't read “${input}” as an amount.`);
  const parsed = parseAmount(m[2]!, lang);
  if (!parsed.ok) return unreadable(parsed.note);
  const amount = parsed.amount;
  const symbol = (m[1] ?? m[3] ?? "").toLowerCase().trim();
  const hint = currencyHint?.toUpperCase() ?? null;
  let code: string | null = UNAMBIGUOUS[symbol] ?? null;
  let display = code;
  const amb = AMBIGUOUS[symbol];
  if (amb) {
    display = amb.display;
    code = hint && amb.candidates.includes(hint) ? hint : null;
    if (!code) return { status: "needs_clarification", displayValue: null, normalized: { kind: "money", amount, currency: "XXX" }, note: `“${amb.display}” is used by several currencies (${amb.candidates.join(", ")}). Which one is it?` };
  }
  if (!symbol && hint && /^[A-Z]{3}$/.test(hint)) {
    code = hint;
    display = DISPLAY[hint] ?? hint;
  }
  if (!code) return { status: "needs_clarification", displayValue: null, normalized: { kind: "money", amount, currency: "XXX" }, note: `Which currency is ${amount} in?` };
  return { status: "confirmed", displayValue: formatMoney(amount, display!, "en"), normalized: { kind: "money", amount, currency: code, ...(display !== code ? { symbol: display! } : {}) }, note: null };
}

/** Infers a currency only when the template itself names one unambiguously. */
export function templateCurrencyHint(allText: string): string | null {
  const found = new Set<string>();
  if (/\bMUR\b|Mauritian rupee|roupies? mauricienne|Republic of Mauritius|République de Maurice/i.test(allText)) found.add("MUR");
  if (/\bINR\b|Indian rupee/i.test(allText)) found.add("INR");
  if (/\bUSD\b|US dollar/i.test(allText)) found.add("USD");
  if (/\bEUR\b|\beuros?\b|€/i.test(allText)) found.add("EUR");
  if (/\bGBP\b|pounds sterling|livres? sterling|£/i.test(allText)) found.add("GBP");
  return found.size === 1 ? [...found][0]! : null;
}

export function parseBoolean(input: string): NormalizeResult {
  const s = input.trim().toLowerCase();
  const val = /^(yes|y|true|oui|vrai|affirmative|correct|exact)\b/.test(s) ? true : /^(no|n|false|non|faux|negative)\b/.test(s) ? false : null;
  if (val === null) return { status: "needs_clarification", displayValue: null, normalized: null, note: `Please answer yes or no (oui ou non) — “${input}” doesn't settle it.` };
  return { status: "confirmed", displayValue: formatBoolean(val, "en"), normalized: { kind: "boolean", value: val }, note: null };
}

/** Deterministic validation applied to every value the model proposes, before anything is committed. */
export function normalizeValue(valueType: ValueType, raw: string, opts: { currencyHint?: string | null; lang?: Lang } = {}): NormalizeResult {
  const value = raw.trim();
  if (!value) return { status: "missing", displayValue: null, normalized: null, note: null };
  switch (valueType) {
    case "date":
      return parseDate(value);
    case "money":
      return parseMoney(value, opts.currencyHint, opts.lang);
    case "boolean":
      return parseBoolean(value);
    case "number":
    case "percentage":
    case "duration":
      return { status: "confirmed", displayValue: value, normalized: { kind: "number", value }, note: null };
    default:
      return { status: "confirmed", displayValue: value, normalized: { kind: "text", value }, note: null };
  }
}

/**
 * The text written at one occurrence. Dates and amounts follow the occurrence's language
 * (“1 October 2026” / “1 octobre 2026”); names, addresses and identifiers are written as given.
 */
export function renderAt(f: Field, occurrenceLang: Lang, docLang: DocLanguage): string | null {
  if (f.status !== "confirmed" || !f.displayValue) return null;
  const lang = renderLang(occurrenceLang, docLang);
  const n = f.normalized;
  if (n?.kind === "date") return formatDate(n.iso, lang);
  if (n?.kind === "money") return formatMoney(n.amount, n.symbol ?? n.currency, lang);
  if (n?.kind === "boolean") return formatBoolean(n.value, lang);
  return f.displayValue;
}

/** Flags start/end date pairs that are out of order. Returns field ids with a note. */
export function chronologyIssues(fields: Field[]): { fieldId: string; note: string }[] {
  const dates = fields.filter((f) => f.normalized?.kind === "date");
  const start = dates.find((f) => /\b(start|commence|begin|effective|début|prise d'effet|entrée en vigueur)/i.test(f.label));
  const end = dates.find((f) => /\b(end|expir|terminat|fin\b|échéance)/i.test(f.label));
  if (start?.normalized?.kind === "date" && end?.normalized?.kind === "date" && end.normalized.iso <= start.normalized.iso) {
    return [{ fieldId: end.id, note: `The end date (${end.displayValue}) is not after the start date (${start.displayValue}).` }];
  }
  return [];
}
