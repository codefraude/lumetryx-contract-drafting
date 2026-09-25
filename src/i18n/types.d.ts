import type en from "../../messages/en.json";
import type { LOCALES } from "./locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}
