import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { ApiError } from "@/lib/http";

export type ErrorTranslator = ReturnType<typeof useTranslations<"errors">>;

const TRANSLATED = [
  "invalid_response",
  "draft_closed",
  "editor_not_ready",
  "unauthorized",
  "forbidden",
  "stale",
  "busy",
  "budget",
  "aborted",
  "not_found",
  "storage_unavailable",
  "internal",
  "no_file",
  "not_zip",
  "zip_bomb",
  "macro_enabled",
] as const;

const isTranslated = (code: string): code is (typeof TRANSLATED)[number] => {
  return TRANSLATED.some((c) => c === code);
};

export const errorText = (t: ErrorTranslator, error: unknown): string => {
  if (error instanceof ApiError) {
    const status = /^http_(\d{3})$/.exec(error.code)?.[1];

    if (status) {
      return t("http", { status });
    }

    if (isTranslated(error.code)) {
      return t(error.code);
    }
  }

  return error instanceof Error && error.message ? error.message : t("unknown");
};

export const useErrorText = () => {
  const t = useTranslations("errors");

  return useCallback(
    (error: unknown) => {
      return errorText(t, error);
    },
    [t],
  );
};
