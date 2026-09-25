export const CURRENCY_WORDS: Record<string, RegExp> = {
  MUR: /\bmur\b|mauritian|mauritius|mauricienne?s?\b/i,
  INR: /\binr\b|indian/i,
  PKR: /\bpkr\b|pakistan/i,
  LKR: /\blkr\b|sri lank/i,
  NPR: /\bnpr\b|nepal/i,
  USD: /\busd\b|us ?\$|us dollar|american dollar|dollars? américains?/i,
  EUR: /\beur\b|euro|€/i,
  GBP: /\bgbp\b|pound|£|livres? sterling/i,
  AUD: /\baud\b|australian/i,
  CAD: /\bcad\b|canadian/i,
  SGD: /\bsgd\b|singapore/i,
  ZAR: /\bzar\b|\brand\b/i,
  CHF: /\bchf\b|swiss franc|francs? suisses?/i,
};

export const AMBIGUOUS_SYMBOLS: Record<string, string[]> = {
  $: ["USD", "AUD", "CAD", "SGD", "NZD"],
  dollar: ["USD", "AUD", "CAD", "SGD", "NZD"],
  dollars: ["USD", "AUD", "CAD", "SGD", "NZD"],
  rs: ["MUR", "INR", "PKR", "LKR", "NPR"],
  "rs.": ["MUR", "INR", "PKR", "LKR", "NPR"],
  "₨": ["MUR", "INR", "PKR", "LKR", "NPR"],
  rupee: ["MUR", "INR", "PKR", "LKR", "NPR"],
  rupees: ["MUR", "INR", "PKR", "LKR", "NPR"],
  roupies: ["MUR", "INR", "PKR", "LKR", "NPR"],
};

export function currencyOf(text: string): string | null {
  const code = text.trim().toUpperCase();

  if (code in CURRENCY_WORDS) {
    return code;
  }

  return (
    Object.entries(CURRENCY_WORDS).find(([, words]) => words.test(text))?.[0] ??
    null
  );
}
