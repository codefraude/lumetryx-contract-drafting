import type {
  ChatLanguage,
  DocLanguage,
  Lang,
} from "@/features/documents/contracts/fields";

/**
 * Deterministic language detection for English/French contract
 * text. It counts common function words and accented words; short
 * or balanced text is reported as "unknown" rather than guessed.
 */
const EN = new Set(
  "the and of to in is are shall be by for with this that any or as on at from which will may not its their such each all under between hereby agreement party parties tenant landlord employee employer company services provider client date".split(
    " ",
  ),
);
const FR = new Set(
  "le la les des du de et est sont une un pour dans par sur au aux que qui ne pas avec ce cette ces ses son sa leur être sera présent présente contrat bailleur locataire salarié salariée employeur société entre conformément ainsi tout toute chaque lors dont ou où prestataire parties partie date".split(
    " ",
  ),
);

// Words present in both sets carry no signal.
for (const w of [...EN]) {
  if (FR.has(w)) {
    EN.delete(w);
    FR.delete(w);
  }
}

const ACCENTED = /[éèêëàâçùûüîïôœ]/i;

export interface LangScore {
  en: number;
  fr: number;
}

export function scoreText(text: string): LangScore {
  let en = 0;
  let fr = 0;

  for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
    const w = raw.replace(/^[ldjmnstcq]'/, "");

    if (!w) {
      continue;
    }

    if (raw !== w) {
      fr += 1;
    } // elision: l', d', qu' …

    if (EN.has(w)) {
      en += 1;
    }

    if (FR.has(w)) {
      fr += 1;
    } else if (ACCENTED.test(w)) {
      fr += 0.5;
    }
  }

  return {
    en,
    fr,
  };
}

export function detectLanguage(text: string): Lang {
  const { en, fr } = scoreText(text);

  if (en + fr < 2) {
    return "unknown";
  }

  if (en >= 2 * fr) {
    return "en";
  }

  if (fr >= 2 * en) {
    return "fr";
  }

  return "unknown";
}

const SHORT_FR = /^(oui|non|bonjour|merci|d'accord|exact|voilà|si)\b/i;
const SHORT_EN = /^(yes|no|hello|hi|thanks|thank you|okay|ok|correct|sure)\b/i;

/**
 * Language of a chat message; only confident
 * results change the conversation language.
 */
export function messageLanguage(text: string): Lang {
  const t = text.trim();
  const l = detectLanguage(t);

  if (l !== "unknown") {
    return l;
  }

  if (SHORT_FR.test(t)) {
    return "fr";
  }

  if (SHORT_EN.test(t)) {
    return "en";
  }

  return "unknown";
}

/** Dominant language of a template from per-block scores weighted by length. */
export function documentLanguage(texts: string[]): {
  document: DocLanguage;
  en: number;
  fr: number;
} {
  let en = 0;
  let fr = 0;

  for (const t of texts) {
    const l = detectLanguage(t);

    if (l === "en") {
      en += t.length;
    }

    if (l === "fr") {
      fr += t.length;
    }
  }

  const total = en + fr;
  const share = {
    en: total ? en / total : 0,
    fr: total ? fr / total : 0,
  };

  const round = (n: number) => {
    return Math.round(n * 100) / 100;
  };

  if (total < 40) {
    return {
      document: "unknown",
      en: round(share.en),
      fr: round(share.fr),
    };
  }

  const document: DocLanguage =
    share.en >= 0.85 ? "en" : share.fr >= 0.85 ? "fr" : "mixed";

  return {
    document,
    en: round(share.en),
    fr: round(share.fr),
  };
}

/**
 * Conversation language: explicit choice, then the
 * user's latest confident message, then the template.
 */
export function replyLanguage(
  explicit: ChatLanguage | null,
  message: string | null,
  doc: DocLanguage,
): ChatLanguage {
  if (explicit) {
    return explicit;
  }

  const m = message ? messageLanguage(message) : "unknown";

  if (m !== "unknown") {
    return m;
  }

  return doc === "fr" ? "fr" : "en";
}

/** How a value is rendered at an occurrence whose own language is unknown. */
export const renderLang = (occurrence: Lang, doc: DocLanguage): "en" | "fr" => {
  return occurrence !== "unknown" ? occurrence : doc === "fr" ? "fr" : "en";
};

export const MONTHS_EN = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const FR_ABBR = [
  "janv",
  "févr",
  "mars",
  "avr",
  "mai",
  "juin",
  "juil",
  "août",
  "sept",
  "oct",
  "nov",
  "déc",
];

export const stripAccents = (s: string) => {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
};

/**
 * Month number (1–12) for an English or French month
 * name/abbreviation, or 0. French needs the full name or
 * a standard abbreviation (juin/juillet share a prefix).
 */
export function monthNumber(name: string): number {
  const n = stripAccents(name.toLowerCase().replace(/\.$/, ""));
  const fr = MONTHS_FR.findIndex(
    (m, i) => stripAccents(m) === n || stripAccents(FR_ABBR[i] ?? m) === n,
  );

  if (fr >= 0) {
    return fr + 1;
  }

  const en = n.length >= 3 ? MONTHS_EN.findIndex((m) => m.startsWith(n)) : -1;

  return en + 1;
}

export function formatDate(iso: string, lang: "en" | "fr"): string {
  // A normalized date is always YYYY-MM-DD.
  const [y = 0, m = 0, d = 0] = iso.split("-").map(Number);

  if (lang === "fr") {
    return `${d} ${MONTHS_FR[m - 1]} ${y}`;
  }

  const month = MONTHS_EN[m - 1] ?? "";

  return `${d} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`;
}

const NBSP = " ";

/** Renders an exact decimal string; no floating point is involved. */
export function formatAmount(amount: string, lang: "en" | "fr"): string {
  const [int = "", frac] = amount.split(".");
  const showFrac = frac && /[1-9]/.test(frac) ? frac.padEnd(2, "0") : "";

  if (lang === "fr") {
    return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${showFrac ? `,${showFrac}` : ""}`;
  }

  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${showFrac ? `.${showFrac}` : ""}`;
}

/** English: "EUR 1,250.50"; French: "1 250,50 EUR" (non-breaking spaces). */
export const formatMoney = (
  amount: string,
  symbol: string,
  lang: "en" | "fr",
) => {
  return lang === "fr"
    ? `${formatAmount(amount, "fr")}${NBSP}${symbol}`
    : `${symbol} ${formatAmount(amount, "en")}`;
};

export type AmountParse =
  | {
      ok: true;
      amount: string;
    }
  | {
      ok: false;
      ambiguous: boolean;
      note: string;
    };

/**
 * Reads "1 250,50", "1,250.50", "25,000" or "1.250" as an exact decimal.
 * One separator before exactly three digits is thousands in English but
 * a decimal in French, so the language must settle it, or we ask.
 */
export function parseAmount(raw: string, lang: Lang): AmountParse {
  const s = raw.trim().replace(/[   ']/g, " ");

  const bad = (note: string): AmountParse => {
    return {
      ok: false,
      ambiguous: false,
      note,
    };
  };

  const ask = (a: string, b: string): AmountParse => {
    return {
      ok: false,
      ambiguous: true,
      note: `“${raw.trim()}” could mean ${a} or ${b}. Which is it?`,
    };
  };

  let t = s;

  if (/ /.test(t)) {
    if (!/^\d{1,3}( \d{3})+([.,]\d{1,4})?$/.test(t)) {
      return bad(`“${raw.trim()}” is not a valid amount.`);
    }

    t = t.replace(/ /g, "");
  }

  const commas = (t.match(/,/g) ?? []).length;
  const dots = (t.match(/\./g) ?? []).length;

  const groupedOk = (int: string, sep: string) => {
    return new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(int);
  };

  let amount: string;

  if (commas && dots) {
    const dec = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const grp = dec === "," ? "." : ",";
    const [int, frac] = [
      t.slice(0, t.lastIndexOf(dec)),
      t.slice(t.lastIndexOf(dec) + 1),
    ];

    if (!groupedOk(int, grp) || !/^\d{1,4}$/.test(frac)) {
      return bad(`“${raw.trim()}” is not a valid amount.`);
    }

    amount = `${int.split(grp).join("")}.${frac}`;
  } else if (commas || dots) {
    const sep = commas ? "," : ".";
    const parts = t.split(sep);

    if (parts.length > 2) {
      if (!groupedOk(t, sep)) {
        return bad(`“${raw.trim()}” is not a valid amount.`);
      }

      amount = parts.join("");
    } else {
      const [int = "", frac = ""] = parts;

      if (!/^\d+$/.test(int) || !/^\d+$/.test(frac)) {
        return bad(`“${raw.trim()}” is not a valid amount.`);
      }

      if (frac.length === 3) {
        const thousands = `${int}${frac}`;
        const decimal = `${int}.${frac}`;
        // English writes thousands with commas;
        // French writes decimals with commas.
        const settled =
          sep === ","
            ? lang === "en"
              ? thousands
              : null
            : lang === "en"
              ? decimal
              : null;

        if (!settled) {
          return ask(
            `${formatAmount(thousands, "en")} (thousands)`,
            `${decimal} (decimals)`,
          );
        }

        amount = settled;
      } else if (frac.length <= 4) {
        amount = `${int}.${frac}`;
      } else {
        return bad(`“${raw.trim()}” is not a valid amount.`);
      }
    }
  } else {
    amount = t;
  }

  if (!/^\d+(\.\d{1,4})?$/.test(amount)) {
    return bad(`“${raw.trim()}” is not a valid amount.`);
  }

  return {
    ok: true,
    amount: amount.replace(/^0+(?=\d)/, ""),
  };
}

export function formatBoolean(value: boolean, lang: "en" | "fr"): string {
  return lang === "fr" ? (value ? "Oui" : "Non") : value ? "Yes" : "No";
}
