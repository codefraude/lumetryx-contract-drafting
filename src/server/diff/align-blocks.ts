import type { RenderedBlock } from "@/server/docx/blocks";

/**
 * Pairs template blocks with draft blocks: by Word's paragraph ids (kept by the editor) first,
 * then by text inside each gap, so serialization differences never show up as changes.
 */

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size && !y.size) return 1;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(x.size, y.size);
}

type Pair = [number, number];

/** Longest increasing subsequence of pairs by current index: drops crossing matches (moved paragraphs become delete + add). */
function monotonic(pairs: Pair[]): Pair[] {
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1]!;
    tails[lo] = k;
  });
  const out: Pair[] = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]!) out.unshift(pairs[k]!);
  return out;
}

export function alignBlocks(o: RenderedBlock[], c: RenderedBlock[]): Pair[] {
  const cIndex = new Map<string, number>();
  c.forEach((b, j) => b.paraId && !cIndex.has(b.paraId) && cIndex.set(b.paraId, j));
  const byId: Pair[] = [];
  o.forEach((b, i) => {
    const j = b.paraId ? cIndex.get(b.paraId) : undefined;
    if (j !== undefined) byId.push([i, j]);
  });
  const anchors = monotonic(byId);
  const pairs: Pair[] = [];
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of [...anchors, [o.length, c.length] as Pair]) {
    // Fallback inside each gap: exact-text LCS first, then similar blocks in order.
    const go = o.slice(pi, ai);
    const gc = c.slice(pj, aj);
    const dp: number[][] = Array.from({ length: go.length + 1 }, () => new Array<number>(gc.length + 1).fill(0));
    for (let i = go.length - 1; i >= 0; i--) for (let j = gc.length - 1; j >= 0; j--) dp[i]![j] = go[i]!.text === gc[j]!.text ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    const leftO: number[] = [];
    const leftC: number[] = [];
    while (i < go.length && j < gc.length) {
      if (go[i]!.text === gc[j]!.text) {
        pairs.push([pi + i++, pj + j++]);
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) leftO.push(pi + i++);
      else leftC.push(pj + j++);
    }
    while (i < go.length) leftO.push(pi + i++);
    while (j < gc.length) leftC.push(pj + j++);
    let k = 0;
    for (const oi of leftO) {
      const found = leftC.findIndex((cj, idx) => idx >= k && c[cj]!.kind === o[oi]!.kind && similarity(o[oi]!.text, c[cj]!.text) >= 0.4);
      if (found >= 0) {
        pairs.push([oi, leftC[found]!]);
        k = found + 1;
      }
    }
    if (ai < o.length) pairs.push([ai, aj]);
    pi = ai + 1;
    pj = aj + 1;
  }
  return pairs.sort((a, b) => a[1] - b[1]);
}
