"use client";

import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";
import { errorMessage } from "@/lib/http";
import { Button } from "@/shared/ui/Button";
import { StatusText, type Tone } from "@/shared/ui/Status";
import type { Field } from "../contracts/fields";
import { useCorrectField } from "../queries";

const STATUS: Record<
  Field["status"],
  {
    label: string;
    tone: Tone;
    icon: typeof CircleCheck;
  }
> = {
  confirmed: {
    label: "Confirmed",
    tone: "ok",
    icon: CircleCheck,
  },
  needs_clarification: {
    label: "Needs clarification",
    tone: "warn",
    icon: TriangleAlert,
  },
  missing: {
    label: "Missing",
    tone: "neutral",
    icon: CircleDashed,
  },
};

export function FieldRow({
  documentId,
  f,
  locked,
  inactive,
}: {
  documentId: string;
  f: Field;
  locked: boolean;
  inactive: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [value, setValue] = useState(f.rawValue ?? "");
  const correction = useCorrectField(documentId);
  const busy = correction.isPending;
  const err = correction.error ? errorMessage(correction.error) : null;
  const id = useId();
  const s = STATUS[f.status];

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ui font-semibold text-ink">
          {f.label}
          {!f.required && (
            <span className="ml-1.5 font-normal text-ink-3">Optional</span>
          )}
        </p>
        {!inactive && (
          <StatusText tone={s.tone} icon={s.icon}>
            {s.label}
          </StatusText>
        )}
      </div>
      <p className="mt-1 text-ui">
        {f.displayValue ? (
          <span className="border-b border-accent-ink/40 pb-px text-ink">
            {f.displayValue}
          </span>
        ) : (
          <span className="inline-block min-w-36 border-b border-dashed border-control/50 pb-px text-ink-3">
            {inactive ? "Not needed now" : "Not answered yet"}
          </span>
        )}
      </p>
      {inactive && (
        <p className="mt-1.5 text-meta text-ink-3">
          Only used by a clause that is excluded or still undecided.
        </p>
      )}
      {f.note && f.status !== "confirmed" && (
        <p className="mt-1.5 flex gap-1.5 text-meta text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {f.note}
        </p>
      )}
      {f.confidence < 0.8 && (
        <p className="mt-1.5 text-meta text-ink-3">
          Found with lower confidence. Check that it really is a field.
        </p>
      )}

      {editing ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();

            correction.mutate(
              {
                fieldId: f.id,
                value: value.trim() || null,
              },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <label className="sr-only" htmlFor={`${id}-v`}>
            {f.label}
          </label>
          <input
            id={`${id}-v`}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="h-9 min-w-0 flex-1 basis-48 rounded-control border border-control bg-surface px-3 text-ui text-ink transition-[border-color,box-shadow] duration-150 outline-none focus:border-accent-ink focus:ring-1 focus:ring-accent-ink dark:bg-raised pointer-coarse:h-11"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-1.5 -ml-2.5 flex flex-wrap items-center gap-1">
          {!locked && (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={Pencil}
                onClick={() => setEditing(true)}
              >
                {f.displayValue ? "Edit" : "Fill in"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                busy={busy}
                onClick={() =>
                  correction.mutate({
                    fieldId: f.id,
                    required: !f.required,
                  })
                }
              >
                {f.required ? "Not a field, leave blank" : "Mark as required"}
              </Button>
            </>
          )}
          {f.context.trim() && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showSource}
              aria-controls={`${id}-src`}
              onClick={() => setShowSource((o) => !o)}
            >
              Where it appears
              <ChevronDown
                aria-hidden
                className={`size-3.5 transition-transform duration-150 ${showSource ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>
      )}
      {showSource && (
        <blockquote
          id={`${id}-src`}
          className="mt-2 border-l-2 border-line pl-3 font-serif text-body text-ink-2"
        >
          “{f.context.trim()}”
        </blockquote>
      )}
      {err && (
        <p role="alert" className="mt-2 text-meta text-danger">
          {err}
        </p>
      )}
    </li>
  );
}
