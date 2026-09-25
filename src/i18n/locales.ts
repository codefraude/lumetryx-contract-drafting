export const LOCALES = ["en", "fr"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (value: unknown): value is AppLocale => {
  return LOCALES.some((l) => l === value);
};

const preference = (header: string, language: AppLocale) => {
  let best = {
    q: 0,
    at: Infinity,
  };

  header.split(",").forEach((part, at) => {
    const [tag = "", ...params] = part.trim().toLowerCase().split(";");
    const q = Number(
      params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2) ?? 1,
    );

    if (tag.split("-")[0] === language && q > best.q) {
      best = {
        q,
        at,
      };
    }
  });

  return best;
};

export const negotiateLocale = (acceptLanguage: string | null): AppLocale => {
  if (!acceptLanguage) {
    return DEFAULT_LOCALE;
  }

  const fr = preference(acceptLanguage, "fr");
  const en = preference(acceptLanguage, "en");

  return fr.q > en.q || (fr.q > 0 && fr.q === en.q && fr.at < en.at)
    ? "fr"
    : "en";
};

export const resolveLocale = (
  cookie: string | undefined,
  acceptLanguage: string | null,
): AppLocale => {
  return isLocale(cookie) ? cookie : negotiateLocale(acceptLanguage);
};
