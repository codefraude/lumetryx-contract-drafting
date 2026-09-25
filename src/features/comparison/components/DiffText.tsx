import type { Segment } from "../contracts";

const Ins = ({ text }: { text: string }) => {
  return (
    <ins className="rounded-[3px] bg-ins-surface px-0.5 text-ins underline decoration-ins/60 underline-offset-[3px]">
      <span className="sr-only">[added: </span>
      {text}
      <span className="sr-only">]</span>
    </ins>
  );
};

const Del = ({ text }: { text: string }) => {
  return (
    <del className="rounded-[3px] bg-del-surface px-0.5 text-del line-through decoration-del/70">
      <span className="sr-only">[removed: </span>
      {text}
      <span className="sr-only">]</span>
    </del>
  );
};

function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];

  segments.forEach((s, i) => {
    const prev = out.at(-1);
    const joins =
      s.op === "eq" &&
      !s.text.trim() &&
      prev &&
      prev.op !== "eq" &&
      segments[i + 1]?.op === prev.op;

    if (prev && (joins || prev.op === s.op)) {
      out[out.length - 1] = {
        ...prev,
        text: prev.text + s.text,
      };
    } else {
      out.push(s);
    }
  });

  return out;
}

export function DiffText({
  segments,
  side,
}: {
  segments: Segment[];
  side?: "template" | "draft";
}) {
  const shown = merge(
    segments.filter(
      (s) =>
        !side ||
        s.op === "eq" ||
        (side === "template" ? s.op === "del" : s.op === "ins"),
    ),
  );

  if (!shown.length) {
    return (
      <p className="text-meta text-ink-3">
        {side === "template" ? "Not in the template" : "Not in the draft"}
      </p>
    );
  }

  return (
    <p className="font-serif text-body leading-relaxed break-words whitespace-pre-wrap text-ink">
      {shown.map((s, i) =>
        s.op === "ins" ? (
          <Ins key={i} text={s.text} />
        ) : s.op === "del" ? (
          <Del key={i} text={s.text} />
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}
