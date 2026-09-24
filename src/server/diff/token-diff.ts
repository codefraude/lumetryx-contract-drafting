import type { Segment } from "@/features/comparison/contracts";

/** Words, spaces and punctuation; template placeholders ({{x}}, [X]) stay whole so a filled value reads as one replacement. */
export const tokenize = (s: string) => s.match(/\{\{[^}]*\}\}|\[[^\]]*\]|_{4,}|\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Longest-common-subsequence diff over tokens; exact comparison (accents, digits and punctuation all count). */
export function diffTokens(a: string, b: string): Segment[] {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250_000) return merge([{ op: "del", text: a }, { op: "ins", text: b }]);
  const n = x.length;
  const m = y.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = x[i] === y[j] ? dp[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(dp[(i + 1) * (m + 1) + j]!, dp[i * (m + 1) + j + 1]!);
  const out: Segment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: "eq", text: x[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!) out.push({ op: "del", text: x[i++]! });
    else out.push({ op: "ins", text: y[j++]! });
  }
  while (i < n) out.push({ op: "del", text: x[i++]! });
  while (j < m) out.push({ op: "ins", text: y[j++]! });
  return merge(out);
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
