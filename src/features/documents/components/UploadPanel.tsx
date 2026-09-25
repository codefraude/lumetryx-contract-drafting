"use client";

import {
  ChevronDown,
  CircleAlert,
  Download,
  FileUp,
  FolderOpen,
  LoaderCircle,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { BrandMark } from "@/shared/ui/BrandMark";
import { Button } from "@/shared/ui/Button";
import { LanguageControl } from "@/shared/ui/LanguageControl";
import { Callout } from "@/shared/ui/Status";
import { ThemeControl } from "@/shared/ui/ThemeControl";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXAMPLES: {
  file: string;
  title:
    | "residentialLease"
    | "mutualNda"
    | "servicesContract"
    | "bilingualLease"
    | "bilingualEmployment";
  language: "en" | "fr" | "mixed";
  conditional?: boolean;
}[] = [
  {
    file: "synthetic-residential-lease.docx",
    title: "residentialLease",
    language: "en",
  },
  {
    file: "synthetic-mutual-nda.docx",
    title: "mutualNda",
    language: "en",
  },
  {
    file: "synthetic-contrat-prestation-fr.docx",
    title: "servicesContract",
    language: "fr",
  },
  {
    file: "synthetic-bilingual-lease.docx",
    title: "bilingualLease",
    language: "mixed",
  },
  {
    file: "synthetic-bilingual-employment.docx",
    title: "bilingualEmployment",
    language: "mixed",
    conditional: true,
  },
];

type LocalProblem =
  | {
      kind: "notDocx";
      name: string;
    }
  | {
      kind: "tooLarge";
      name: string;
      size: number;
    }
  | { kind: "exampleFailed" };

interface Props {
  onFile(file: File): void;
  busy: string | null;
  error: string | null;
  onShowDrafts(): void;
  maxMb: number;
}

export function UploadPanel({
  onFile,
  busy,
  error,
  onShowDrafts,
  maxMb,
}: Props) {
  const t = useTranslations("upload");
  const tLanguages = useTranslations("languages");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [local, setLocal] = useState<LocalProblem | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  const accept = (f: File | undefined) => {
    setLocal(null);

    if (!f) {
      return;
    }

    if (!/\.docx$/i.test(f.name)) {
      return setLocal({
        kind: "notDocx",
        name: f.name,
      });
    }

    if (f.size > maxMb * 1024 * 1024) {
      return setLocal({
        kind: "tooLarge",
        name: f.name,
        size: f.size / 1024 / 1024,
      });
    }

    onFile(f);
  };

  const tryExample = async (ex: (typeof EXAMPLES)[number]) => {
    setLocal(null);
    setFetching(ex.file);

    try {
      const res = await fetch(`/examples/${ex.file}`);

      if (!res.ok) {
        throw new Error();
      }

      accept(new File([await res.blob()], ex.file, { type: DOCX_TYPE }));
    } catch {
      setLocal({ kind: "exampleFailed" });
    } finally {
      setFetching(null);
    }
  };

  const problem = !local
    ? error
    : local.kind === "notDocx"
      ? t("notDocx", { name: local.name })
      : local.kind === "tooLarge"
        ? t("tooLarge", {
            name: local.name,
            size: local.size,
            maxMb,
          })
        : t("exampleFailed");
  const working = Boolean(busy);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-5">
        <BrandMark />
        <p className="flex min-w-0 items-baseline gap-2.5 text-ui">
          <span className="font-semibold text-ink">Lumetryx</span>
          <span className="hidden truncate text-ink-3 sm:inline">
            {t("tagline")}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            icon={FolderOpen}
            onClick={onShowDrafts}
            aria-label={t("savedDrafts")}
            className="max-sm:px-2.5"
          >
            <span className="sm:hidden">{t("drafts")}</span>
            <span className="max-sm:hidden">{t("savedDrafts")}</span>
          </Button>
          <LanguageControl />
          <ThemeControl />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-10 pb-16 lg:pt-16">
        <h1 className="font-serif text-display font-semibold tracking-[-0.02em] text-ink">
          {t("heading")}
        </h1>
        <p className="mt-3 max-w-[62ch] text-body text-ink-2">{t("intro")}</p>

        <section aria-labelledby="upload-title" className="mt-8">
          <div
            onDragOver={(e) => {
              e.preventDefault();

              if (!working) {
                setOver(true);
              }
            }}
            onDragLeave={(e) => {
              const to = e.relatedTarget;

              if (!(to instanceof Node && e.currentTarget.contains(to))) {
                setOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);

              if (!working) {
                accept(e.dataTransfer.files[0]);
              }
            }}
            className={`rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors duration-150 sm:py-12 ${over ? "border-accent-ink bg-accent-surface" : "border-control/50 bg-surface"}`}
          >
            {working ? (
              <div role="status">
                <LoaderCircle
                  aria-hidden
                  className="mx-auto size-6 animate-spin text-ink-3"
                />
                <h2
                  id="upload-title"
                  className="mt-4 text-title font-semibold break-words text-ink"
                >
                  {t("reading", { name: busy ?? "" })}
                </h2>
                <p className="mx-auto mt-1 max-w-[44ch] text-ui text-ink-2">
                  {t("readingDetail")}
                </p>
              </div>
            ) : (
              <>
                <FileUp aria-hidden className="mx-auto size-6 text-ink-3" />
                <h2
                  id="upload-title"
                  className="mt-4 text-title font-semibold text-ink"
                >
                  {over ? t("dropToUpload") : t("dropHere")}
                </h2>
                <Button
                  size="lg"
                  variant="primary"
                  icon={Upload}
                  className="mt-5"
                  onClick={() => input.current?.click()}
                >
                  {t("uploadTemplate")}
                </Button>
                <p className="mt-4 text-meta text-ink-3">
                  {t("limits", { maxMb })}
                  <br />
                  {t("blanks")}
                </p>
              </>
            )}
            <input
              ref={input}
              type="file"
              accept={`.docx,${DOCX_TYPE}`}
              className="sr-only"
              tabIndex={-1}
              aria-label={t("chooseFile")}
              onChange={(e) => {
                accept(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {problem && !working && (
            <Callout
              tone="danger"
              role="alert"
              icon={CircleAlert}
              title={t("problemTitle")}
              className="mt-4"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => input.current?.click()}
                >
                  {t("chooseAnother")}
                </Button>
              }
            >
              {problem}
            </Callout>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-x-1.5 text-ui text-ink-2">
            {t("continuing")}
            <button
              type="button"
              onClick={onShowDrafts}
              className="font-medium text-accent-ink underline underline-offset-2 hover:no-underline pointer-coarse:min-h-11"
            >
              {t("openSaved")}
            </button>
            <span className="basis-full text-meta text-ink-3">
              {t("linkedToBrowser")}
            </span>
          </p>
        </section>

        <div className="mt-10">
          <h2 className="text-ui font-semibold text-ink">{t("examples")}</h2>
          <p className="mt-0.5 text-meta text-ink-3">{t("examplesNote")}</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {EXAMPLES.map((ex) => {
              const title = t(`exampleTitles.${ex.title}`);
              const language = tLanguages(ex.language);

              return (
                <li key={ex.file} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium text-ink">
                      {title}
                    </p>
                    <p className="text-meta text-ink-3">
                      {ex.conditional
                        ? t("withConditional", { language })
                        : language}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={fetching === ex.file}
                    disabled={working || fetching !== null}
                    onClick={() => void tryExample(ex)}
                    aria-label={t("useExample", { title })}
                  >
                    {t("use")}
                  </Button>
                  <a
                    href={`/examples/${ex.file}`}
                    download
                    aria-label={t("downloadExample", { title })}
                    title={t("downloadWordFile")}
                    className="grid size-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink pointer-coarse:size-11"
                  >
                    <Download aria-hidden className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        <details className="group mt-8 border-y border-line">
          <summary className="flex list-none items-center gap-2 py-3 text-ui font-medium text-ink [&::-webkit-details-marker]:hidden">
            {t("whatHappens")}
            <ChevronDown
              aria-hidden
              className="ml-auto size-4 text-ink-3 transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <ul className="space-y-2 pb-4 text-ui text-ink-2">
            <li>{t("privacyFile", { maxMb })}</li>
            <li>{t("privacyAi")}</li>
            <li>{t("privacyFormatting")}</li>
            <li>{t("privacyStorage")}</li>
          </ul>
        </details>
      </main>
    </div>
  );
}
