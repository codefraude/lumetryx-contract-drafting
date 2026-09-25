import {
  createTranslator,
  IntlErrorCode,
  type AbstractIntlMessages,
} from "next-intl";
import { describe, expect, it } from "vitest";
import { errorText } from "@/i18n/error-text";
import { negotiateLocale, resolveLocale } from "@/i18n/locales";
import { ApiError } from "@/lib/http";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const catalogs: Record<"en" | "fr", AbstractIntlMessages> = {
  en,
  fr,
};

const leaves = (
  messages: AbstractIntlMessages,
  prefix = "",
): [string, string][] => {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value]]
      : leaves(value, `${prefix}${key}.`),
  );
};

const keys = (messages: AbstractIntlMessages) => {
  return leaves(messages)
    .map(([key]) => key)
    .sort();
};

describe("message catalogs", () => {
  it("have the same keys in English and French", () => {
    expect(keys(catalogs.fr)).toEqual(keys(catalogs.en));
  });

  it("parse as ICU messages in both languages", () => {
    const invalid: string[] = [];

    for (const locale of ["en", "fr"] as const) {
      const flat: Record<string, string> = Object.fromEntries(
        leaves(catalogs[locale]).map(([key, message]) => [
          key.replaceAll(".", "/"),
          message,
        ]),
      );
      const t = createTranslator({
        locale,
        messages: flat,
        onError: (e) => {
          if (e.code === IntlErrorCode.INVALID_MESSAGE) {
            invalid.push(`${locale}: ${e.message}`);
          }
        },
      });

      for (const key of Object.keys(flat)) {
        t(key);
      }
    }

    expect(invalid).toEqual([]);
  });

  it("uses the typographic apostrophe in French", () => {
    expect(JSON.stringify(fr)).not.toMatch(/(?<![{}])'(?![{}])/);
  });
});

describe("locale negotiation", () => {
  it("prefers French only when the browser ranks it above English", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
    expect(negotiateLocale("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("fr");
    expect(negotiateLocale("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(negotiateLocale("en;q=0.5, fr;q=0.8")).toBe("fr");
    expect(negotiateLocale("fr-CA")).toBe("fr");
    expect(negotiateLocale("fr,en")).toBe("fr");
    expect(negotiateLocale("en,fr")).toBe("en");
    expect(negotiateLocale("de-DE,de;q=0.9,fr;q=0.5")).toBe("fr");
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("en");
    expect(negotiateLocale("fr;q=0,en;q=0.1")).toBe("en");
  });

  it("uses a valid cookie before the header", () => {
    expect(resolveLocale("fr", "en-US")).toBe("fr");
    expect(resolveLocale("en", "fr-FR")).toBe("en");
    expect(resolveLocale("de", "fr-FR")).toBe("fr");
    expect(resolveLocale(undefined, null)).toBe("en");
  });
});

describe("error text", () => {
  const t = createTranslator({
    locale: "en",
    messages: en,
    namespace: "errors",
  });

  it("translates known codes and keeps the server's message otherwise", () => {
    expect(
      errorText(t, new ApiError("unauthorized", "server text", 401, false)),
    ).toBe(en.errors.unauthorized);

    expect(
      errorText(
        createTranslator({
          locale: "fr",
          messages: fr,
          namespace: "errors",
        }),
        new ApiError("busy", "server text", 409, true),
      ),
    ).toBe(fr.errors.busy);

    expect(
      errorText(
        t,
        new ApiError(
          "rate_limited",
          "Too many requests. Try again in about 3 minute(s).",
          429,
          true,
        ),
      ),
    ).toBe("Too many requests. Try again in about 3 minute(s).");

    expect(
      errorText(t, new ApiError("http_502", "Request failed.", 502, true)),
    ).toBe("The request failed (error 502).");

    expect(errorText(t, new Error("Failed to fetch"))).toBe("Failed to fetch");
    expect(errorText(t, undefined)).toBe(en.errors.unknown);
  });
});
