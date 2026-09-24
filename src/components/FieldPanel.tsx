"use client";

import { ChevronDown, CircleCheck, CircleDashed, Pencil, TriangleAlert } from "lucide-react";
import { memo, useId, useState } from "react";
import { GROUP_ORDER, type Field } from "@/lib/fields/types";
import { Button, Callout, StatusBadge, type Tone } from "./ui";

const STATUS: Record<Field["status"], { label: string; tone: Tone; icon: typeof CircleCheck }> = {
  confirmed: { label: "Confirmed", tone: "ok", icon: CircleCheck },
  needs_clarification: { label: "Needs clarification", tone: "warn", icon: TriangleAlert },
  missing: { label: "Missing", tone: "neutral", icon: CircleDashed },
};

interface Props {
  fields: Field[];
  /** When a draft exists, answers change through chat so the draft is patched safely. */
  locked: boolean;
  /** Fields only used by excluded or undecided clauses: kept, but not needed now. */
  inactive: ReadonlySet<string>;
  onCorrect(fieldId: string, value: string | null): Promise<void>;
  onToggleRequired(fieldId: string, required: boolean): Promise<void>;
}

const byGroup = (a: Field, b: Field) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);

function FieldRow({ f, locked, inactive, onCorrect, onToggleRequired }: { f: Field; inactive: boolean } & Omit<Props, "fields" | "inactive">) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [value, setValue] = useState(f.rawValue ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const s = STATUS[f.status];
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      return true;
    } catch (x) {
      setErr((x as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="lx-fade px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug text-ink">
            {f.label}
            {!f.required && <span className="ml-1.5 font-normal text-ink-3">Optional</span>}
          </p>
          {/* A filled blank for answers, an empty one for what is still missing. */}
          <p className="mt-1.5 text-[14px] leading-snug">
            {f.displayValue ? (
              <span className="border-b border-primary/45 pb-px text-ink">{f.displayValue}</span>
            ) : (
              <span className="inline-block min-w-36 border-b border-dashed border-control/70 pb-px italic text-ink-3">{inactive ? "Not needed now" : "Not answered yet"}</span>
            )}
          </p>
          {inactive && <p className="mt-1.5 text-[12.5px] text-ink-3">Only used by a clause that is excluded or still undecided.</p>}
          {f.note && f.status !== "confirmed" && (
            <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {f.note}
            </p>
          )}
          {f.confidence < 0.8 && <p className="mt-1.5 text-[12.5px] text-ink-3">Found with lower confidence. Check that it really is a field.</p>}
        </div>
        {!inactive && (
          <StatusBadge tone={s.tone} icon={s.icon}>
            {s.label}
          </StatusBadge>
        )}
      </div>

      {editing ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => onCorrect(f.id, value.trim() || null))) setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`${id}-v`}>{f.label}</label>
          <input id={`${id}-v`} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className="h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-primary focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lx-primary)_20%,transparent)] dark:bg-raised pointer-coarse:h-11" />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="-ml-2 mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
          {!locked && (
            <>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)} className="text-accent-ink">
                {f.displayValue ? "Edit" : "Fill in"}
              </Button>
              <Button size="sm" variant="ghost" busy={busy} onClick={() => void run(() => onToggleRequired(f.id, !f.required))}>
                {f.required ? "Not a field, leave blank" : "Mark as required"}
              </Button>
            </>
          )}
          {f.context.trim() && (
            <Button size="sm" variant="ghost" aria-expanded={showSource} aria-controls={`${id}-src`} onClick={() => setShowSource((o) => !o)}>
              Where it appears
              <ChevronDown aria-hidden className={`size-3.5 transition-transform duration-200 ${showSource ? "rotate-180" : ""}`} />
            </Button>
          )}
        </div>
      )}
      {showSource && (
        <blockquote id={`${id}-src`} className="lx-fade mt-2 border-l-2 border-line pl-3 font-serif text-[14px] italic leading-relaxed text-ink-2">
          “{f.context.trim()}”
        </blockquote>
      )}
      {err && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {err}
        </p>
      )}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section>
      <h3 className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2 text-[12.5px] font-semibold text-ink-2 backdrop-blur-[2px] sm:px-5">
        {title}
        <span className="tabular-nums text-ink-3">{count}</span>
      </h3>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

/** Details: what is still needed first, then confirmed answers, then fields not needed now. */
export const FieldPanel = memo(function FieldPanel({ fields, locked, inactive, onCorrect, onToggleRequired }: Props) {
  // Yes/no answers that decide clauses live under Clauses, so they are not counted twice.
  const details = fields.filter((f) => f.source !== "condition");
  const active = details.filter((f) => !inactive.has(f.id));
  const needed = active.filter((f) => f.required && f.status !== "confirmed").sort(byGroup);
  const done = active.filter((f) => f.status === "confirmed").sort(byGroup);
  const rest = details.filter((f) => inactive.has(f.id) || (!f.required && f.status !== "confirmed")).sort(byGroup);
  const required = active.filter((f) => f.required);
  const row = (f: Field) => <FieldRow key={`${f.id}:${f.rawValue ?? ""}:${f.required}`} f={f} inactive={inactive.has(f.id)} locked={locked} onCorrect={onCorrect} onToggleRequired={onToggleRequired} />;

  if (!details.length)
    return (
      <div className="p-5">
        <Callout icon={CircleDashed} title="No fields were found in this template">
          Mark the blanks in Word as [NAME], {"{{name}}"}, a line of underscores or a placeholder box (content control), then upload the template again.
        </Callout>
      </div>
    );
  return (
    <div>
      <div className="px-4 pb-3 pt-4 sm:px-5">
        <p className="text-[15px] font-semibold text-ink">
          {required.filter((f) => f.status === "confirmed").length} of {required.length} required details confirmed
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">{locked ? "A draft exists, so change answers in the chat. The draft is then updated wherever you have not edited it yourself." : "Answer in the chat, or fill a detail in here."}</p>
      </div>
      <Section title="Still needed" count={needed.length}>{needed.map(row)}</Section>
      <Section title="Confirmed" count={done.length}>{done.map(row)}</Section>
      <Section title="Not needed now" count={rest.length}>{rest.map(row)}</Section>
    </div>
  );
});
