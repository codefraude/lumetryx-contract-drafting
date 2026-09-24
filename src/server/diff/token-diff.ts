import type { Segment } from "@/features/comparison/contracts";
import { lcsSteps } from "./lcs";

/** Words, spaces and punctuation; template placeholders ({{x}}, [X]) stay whole so a filled value reads as one replacement. */
export const tokenize = (s: string) => s.match(/\{\{[^}]*\}\}|\[[^\]]*\]|_{4,}|\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Longest-common-subsequence diff over tokens; exact comparison (accents, digits and punctuation all count). */
export function diffTokens(a: string, b: string): Segment[] {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250_000)
    return merge([
      { op: "del", text: a },
      { op: "ins", text: b },
    ]);
  return merge(
    lcsSteps(x, y, (p, q) => p === q).map((s): Segment =>
      s.op === "both" ? { op: "eq", text: s.a } : s.op === "a" ? { op: "del", text: s.a } : { op: "ins", text: s.b },
    ),
  );
}

function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const prev = out.at(-1);
    if (prev && prev.op === s.op) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}
