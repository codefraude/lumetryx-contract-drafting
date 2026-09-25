import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { LOCALE_COOKIE, resolveLocale } from "./locales";

const MESSAGES = {
  en,
  fr,
};

export default getRequestConfig(async () => {
  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get("accept-language"),
  );

  return {
    locale,
    messages: MESSAGES[locale],
  };
});
