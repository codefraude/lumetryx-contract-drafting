"use client";

import { ChevronDown, CircleAlert, Download, FileText, FileUp, FolderOpen, LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ThemeControl } from "./ThemeControl";
import { BrandMark, Button } from "./ui";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Synthetic fixtures shipped in public/examples. */
const EXAMPLES: { file: string; title: string; language: string; conditional?: boolean }[] = [
  { file: "synthetic-residential-lease.docx", title: "Residential lease", language: "English" },
  { file: "synthetic-mutual-nda.docx", title: "Mutual NDA", language: "English" },
  { file: "synthetic-contrat-prestation-fr.docx", title: "Contrat de prestation de services", language: "French" },
  { file: "synthetic-bilingual-lease.docx", title: "Bilingual lease", language: "English and French" },
  { file: "synthetic-bilingual-employment.docx", title: "Bilingual employment contract", language: "English and French", conditional: true },
];

const STEPS = [
  { title: "Upload your template", text: "A Word .docx with blanks such as [NAME], {{date}} or a line of underscores." },
  { title: "Complete the details", text: "Answer the assistant in English or French, or fill the details in yourself." },
  { title: "Review and download", text: "Edit the draft, compare it with the template, and download it as .docx." },
];

const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

interface Props {
  onFile(file: File): void;
  /** Name of the file being read, while its upload and analysis run. */
  busy: string | null;
  error: string | null;
  onShowDrafts(): void;
  maxMb: number;
}

export function UploadPanel({ onFile, busy, error, onShowDrafts, maxMb }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  const accept = (f: File | undefined) => {
    setLocal(null);
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) return setLocal(`“${f.name}” is not a Word .docx file. If your template is a .doc, PDF or Pages file, open it in Word, save it as .docx, then upload that copy.`);
    if (f.size > maxMb * 1024 * 1024) return setLocal(`“${f.name}” is ${(f.size / 1024 / 1024).toFixed(1)} MB. Files up to ${maxMb} MB are supported; remove large images from the template and try again.`);
    onFile(f);
  };

  /** One click: fetch the bundled example and upload it like a file you chose. */
  const tryExample = async (ex: (typeof EXAMPLES)[number]) => {
    setLocal(null);
    setFetching(ex.file);
    try {
      const res = await fetch(`/examples/${ex.file}`);
      if (!res.ok) throw new Error();
      accept(new File([await res.blob()], ex.file, { type: DOCX_TYPE }));
    } catch {
      setLocal("The example could not be loaded. Check your connection and try again.");
    } finally {
      setFetching(null);
    }
  };

  const problem = local ?? error;
  const working = Boolean(busy);

  return (
    <div className="lx-fade flex min-h-dvh flex-col overflow-x-clip">
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-8">
          <BrandMark />
          <p className="flex min-w-0 items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Lumetryx</span>
            <span className="hidden truncate text-[14px] text-ink-3 sm:inline">Contract drafting</span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" icon={FolderOpen} onClick={onShowDrafts} aria-label="Saved drafts" className="max-sm:px-2.5">
              <span className="sm:hidden">Drafts</span>
              <span className="max-sm:hidden">Saved drafts</span>
            </Button>
            <ThemeControl />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-1 content-start gap-x-16 gap-y-10 px-4 pb-16 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:grid-rows-[auto_auto_auto_1fr] lg:pt-16">
        <div className="lg:col-start-1 lg:row-start-1">
          <h1 className="lx-rise max-w-[28ch] font-serif text-[30px] font-semibold leading-[1.12] tracking-[-0.015em] text-ink sm:text-[38px] lg:text-[36px] xl:text-[38px]" style={stagger(0)}>
            Draft a contract from your own Word template.
          </h1>
          <p className="lx-rise mt-4 max-w-[54ch] text-[16px] leading-relaxed text-ink-2" style={stagger(1)}>
            Upload the template you already use. The assistant asks for the missing details and writes them into the document itself, so its formatting carries over. You edit the draft and download a .docx.
          </p>
        </div>

        <section aria-labelledby="upload-title" className="lx-rise relative lg:col-start-2 lg:row-span-4 lg:row-start-1" style={stagger(2)}>
          {/* One faint tint behind the card gives it depth without decorating the page. */}
          <div aria-hidden className="pointer-events-none absolute -inset-8 -z-10 rounded-[40px] max-lg:hidden bg-[radial-gradient(60%_60%_at_50%_35%,var(--lx-tint),transparent)]" />
          <div className="rounded-[20px] border border-line bg-raised p-2 shadow-md">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!working) setOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                if (!working) accept(e.dataTransfer.files[0]);
              }}
              className={`rounded-[14px] border-2 border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-150 sm:px-10 sm:py-12 ${over ? "border-primary bg-accent-surface" : "border-control/40 hover:border-control/70"}`}
            >
              {working ? (
                <div role="status" className="lx-fade">
                  <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-surface text-accent-ink">
                    <LoaderCircle aria-hidden className="size-7 animate-spin" />
                  </div>
                  <h2 id="upload-title" className="mt-5 break-words text-[17px] font-semibold text-ink">
                    Reading “{busy}”
                  </h2>
                  <p className="mx-auto mt-1.5 max-w-[36ch] text-sm leading-relaxed text-ink-2">Checking the file and finding the fields to fill. This usually takes a few seconds.</p>
                </div>
              ) : (
                <>
                  <div className={`mx-auto grid size-14 place-items-center rounded-2xl bg-accent-surface text-accent-ink transition-transform duration-200 ease-(--ease-out) ${over ? "-translate-y-1 scale-105" : ""}`}>
                    <FileUp aria-hidden className="size-7" strokeWidth={1.8} />
                  </div>
                  <h2 id="upload-title" className="mt-5 text-[17px] font-semibold text-ink">
                    {over ? "Drop to upload" : "Start with your template"}
                  </h2>
                  <p className="mt-1.5 text-sm text-ink-2">Drag a .docx file here, or choose one from your computer.</p>
                  <Button size="lg" variant="primary" icon={Upload} className="mt-6" onClick={() => input.current?.click()}>
                    Upload Word template
                  </Button>
                  <p className="mt-4 text-[13px] text-ink-3">.docx up to {maxMb} MB, in English, French or both</p>
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
          </div>

          {problem && !working && (
            <div role="alert" className="lx-rise mt-4 flex gap-3 rounded-xl border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">This file could not be used</p>
                <p className="mt-0.5 leading-relaxed">{problem}</p>
                <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => input.current?.click()}>
                  Choose another file
                </Button>
              </div>
            </div>
          )}

          <p className="mt-4 px-1 text-[13.5px] text-ink-2">
            Continuing earlier work?{" "}
            <button type="button" onClick={onShowDrafts} className="font-medium text-accent-ink underline underline-offset-2 hover:no-underline">
              Open a saved draft
            </button>
            . Drafts are linked to this browser.
          </p>

          <div className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
              <h2 className="text-[14px] font-semibold text-ink">Try a synthetic example</h2>
              <p className="text-[12.5px] text-ink-3">Fictional documents made for testing</p>
            </div>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {EXAMPLES.map((ex) => (
                <li key={ex.file} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <FileText aria-hidden className="size-[18px] shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{ex.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      {ex.language}
                      {ex.conditional && <span className="ml-2 text-accent-ink">Conditional clause</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" busy={fetching === ex.file} disabled={working || fetching !== null} onClick={() => void tryExample(ex)} aria-label={`Use the ${ex.title} example`}>
                    Use
                  </Button>
                  <a href={`/examples/${ex.file}`} download aria-label={`Download the ${ex.title} example`} title="Download .docx" className="grid size-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-10">
                    <Download aria-hidden className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <ol className="lx-rise space-y-5 lg:col-start-1 lg:row-start-2" style={stagger(3)} aria-label="How it works">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.25rem_1fr] items-baseline">
              <span aria-hidden className="font-serif text-[22px] font-semibold leading-none text-accent-ink">
                {i + 1}.
              </span>
              <div>
                <p className="text-[15.5px] font-semibold text-ink">{s.title}</p>
                <p className="mt-0.5 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <details className="lx-rise group self-start rounded-card border border-line bg-surface/70 lg:col-start-1 lg:row-start-3" style={stagger(4)}>
          <summary className="flex list-none items-center gap-2 px-4 py-3 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            What happens to your file
            <ChevronDown aria-hidden className="ml-auto size-4 text-ink-3 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="space-y-2 border-t border-line px-4 py-3.5 text-[13.5px] leading-relaxed text-ink-2">
            <li>One unencrypted .docx up to {maxMb} MB. Macros are never run.</li>
            <li>To find the fields and understand your answers, the template text and your messages are sent from the server to the AI model (Google Gemini).</li>
            <li>Values are written into the template&apos;s own text, so fonts, numbering, tables, headers and footers carry over. Review the draft before you rely on it.</li>
            <li>No account is needed. Drafts are saved on the server, linked to this browser, and kept for a set period after their last save.</li>
          </ul>
        </details>
      </main>
    </div>
  );
}
