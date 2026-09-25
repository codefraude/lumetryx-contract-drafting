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
import { useRef, useState } from "react";
import { BrandMark } from "@/shared/ui/BrandMark";
import { Button } from "@/shared/ui/Button";
import { Callout } from "@/shared/ui/Status";
import { ThemeControl } from "@/shared/ui/ThemeControl";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXAMPLES: {
  file: string;
  title: string;
  language: string;
  conditional?: boolean;
}[] = [
  {
    file: "synthetic-residential-lease.docx",
    title: "Residential lease",
    language: "English",
  },
  {
    file: "synthetic-mutual-nda.docx",
    title: "Mutual NDA",
    language: "English",
  },
  {
    file: "synthetic-contrat-prestation-fr.docx",
    title: "Contrat de prestation de services",
    language: "French",
  },
  {
    file: "synthetic-bilingual-lease.docx",
    title: "Bilingual lease",
    language: "English and French",
  },
  {
    file: "synthetic-bilingual-employment.docx",
    title: "Bilingual employment contract",
    language: "English and French",
    conditional: true,
  },
];

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
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  const accept = (f: File | undefined) => {
    setLocal(null);

    if (!f) {
      return;
    }

    if (!/\.docx$/i.test(f.name)) {
      return setLocal(
        `“${f.name}” is not a Word .docx file. If your template is a .doc, PDF or Pages file, open it in Word, save it as .docx, then upload that copy.`,
      );
    }

    if (f.size > maxMb * 1024 * 1024) {
      return setLocal(
        `“${f.name}” is ${(f.size / 1024 / 1024).toFixed(1)} MB. Files up to ${maxMb} MB are supported; remove large images from the template and try again.`,
      );
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
      setLocal(
        "The example could not be loaded. Check your connection and try again.",
      );
    } finally {
      setFetching(null);
    }
  };

  const problem = local ?? error;
  const working = Boolean(busy);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-5">
        <BrandMark />
        <p className="flex min-w-0 items-baseline gap-2.5 text-ui">
          <span className="font-semibold text-ink">Lumetryx</span>
          <span className="hidden truncate text-ink-3 sm:inline">
            Contract drafting
          </span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            icon={FolderOpen}
            onClick={onShowDrafts}
            aria-label="Saved drafts"
            className="max-sm:px-2.5"
          >
            <span className="sm:hidden">Drafts</span>
            <span className="max-sm:hidden">Saved drafts</span>
          </Button>
          <ThemeControl />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pt-10 pb-16 lg:pt-16">
        <h1 className="font-serif text-display font-semibold tracking-[-0.02em] text-ink">
          Draft a contract from your Word template
        </h1>
        <p className="mt-3 max-w-[62ch] text-body text-ink-2">
          Upload a .docx template. The assistant asks for the missing details
          and writes them into your document, so its formatting carries over.
        </p>

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
                  Reading “{busy}”
                </h2>
                <p className="mx-auto mt-1 max-w-[44ch] text-ui text-ink-2">
                  Checking the file and finding the fields to fill. This usually
                  takes a few seconds.
                </p>
              </div>
            ) : (
              <>
                <FileUp aria-hidden className="mx-auto size-6 text-ink-3" />
                <h2
                  id="upload-title"
                  className="mt-4 text-title font-semibold text-ink"
                >
                  {over ? "Drop to upload" : "Drop a Word template here"}
                </h2>
                <Button
                  size="lg"
                  variant="primary"
                  icon={Upload}
                  className="mt-5"
                  onClick={() => input.current?.click()}
                >
                  Upload template
                </Button>
                <p className="mt-4 text-meta text-ink-3">
                  One .docx file up to {maxMb} MB, in English, French or both.
                  <br />
                  Blanks can be [NAME], {"{{date}}"}, a line of underscores or
                  Word placeholder boxes.
                </p>
              </>
            )}
            <input
              ref={input}
              type="file"
              accept={`.docx,${DOCX_TYPE}`}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a Word template"
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
              title="This file could not be used"
              className="mt-4"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => input.current?.click()}
                >
                  Choose another file
                </Button>
              }
            >
              {problem}
            </Callout>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-x-1.5 text-ui text-ink-2">
            Continuing earlier work?
            <button
              type="button"
              onClick={onShowDrafts}
              className="font-medium text-accent-ink underline underline-offset-2 hover:no-underline pointer-coarse:min-h-11"
            >
              Open a saved draft
            </button>
            <span className="basis-full text-meta text-ink-3">
              Drafts are linked to this browser.
            </span>
          </p>
        </section>

        <div className="mt-10">
          <h2 className="text-ui font-semibold text-ink">Examples</h2>
          <p className="mt-0.5 text-meta text-ink-3">
            Synthetic documents with fictional parties.
          </p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {EXAMPLES.map((ex) => (
              <li key={ex.file} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium text-ink">
                    {ex.title}
                  </p>
                  <p className="text-meta text-ink-3">
                    {ex.language}
                    {ex.conditional && ", with a conditional clause"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  busy={fetching === ex.file}
                  disabled={working || fetching !== null}
                  onClick={() => void tryExample(ex)}
                  aria-label={`Use the ${ex.title} example`}
                >
                  Use
                </Button>
                <a
                  href={`/examples/${ex.file}`}
                  download
                  aria-label={`Download the ${ex.title} example`}
                  title="Download Word file"
                  className="grid size-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink pointer-coarse:size-11"
                >
                  <Download aria-hidden className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        <details className="group mt-8 border-y border-line">
          <summary className="flex list-none items-center gap-2 py-3 text-ui font-medium text-ink [&::-webkit-details-marker]:hidden">
            What happens to your file
            <ChevronDown
              aria-hidden
              className="ml-auto size-4 text-ink-3 transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <ul className="space-y-2 pb-4 text-ui text-ink-2">
            <li>
              One unencrypted .docx up to {maxMb} MB. Macros are never run.
            </li>
            <li>
              To find the fields and understand your answers, the template text
              and your messages are sent from the server to Google&apos;s Gemini
              model, directly or, when configured, through Vercel&apos;s AI
              Gateway.
            </li>
            <li>
              Values are written into the template&apos;s own text, so fonts,
              numbering, tables, headers and footers carry over. Review the
              draft before you rely on it.
            </li>
            <li>
              No account is needed. Drafts are saved on the server, linked to
              this browser, and kept for a set period after their last save.
            </li>
          </ul>
        </details>
      </main>
    </div>
  );
}
