import type { RenderedBlock } from "@/server/docx/blocks";
import { lcsSteps } from "./lcs";

const words = (s: string) => {
  return new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
};

function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);

  if (!x.size && !y.size) {
    return 1;
  }

  let common = 0;

  for (const w of x) {
    if (y.has(w)) {
      common++;
    }
  }

  return common / Math.max(x.size, y.size);
}

type Pair = [number, number];

function monotonic(pairs: Pair[]): Pair[] {
  const tails: {
    k: number;
    j: number;
  }[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);

  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tails.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;

      if ((tails[mid]?.j ?? Infinity) < j) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    prev[k] = tails[lo - 1]?.k ?? -1;

    tails[lo] = {
      k,
      j,
    };
  });

  const out: Pair[] = [];

  for (let k = tails.at(-1)?.k ?? -1; k >= 0; k = prev[k] ?? -1) {
    const pair = pairs[k];

    if (pair) {
      out.unshift(pair);
    }
  }

  return out;
}

export function alignBlocks(o: RenderedBlock[], c: RenderedBlock[]): Pair[] {
  const cIndex = new Map<string, number>();

  c.forEach(
    (b, j) => b.paraId && !cIndex.has(b.paraId) && cIndex.set(b.paraId, j),
  );

  const byId: Pair[] = [];

  o.forEach((b, i) => {
    const j = b.paraId ? cIndex.get(b.paraId) : undefined;

    if (j !== undefined) {
      byId.push([i, j]);
    }
  });

  const anchors = monotonic(byId);
  const end: Pair = [o.length, c.length];
  const pairs: Pair[] = [];
  let pi = 0;
  let pj = 0;

  for (const [ai, aj] of [...anchors, end]) {
    const leftO: {
      i: number;
      block: RenderedBlock;
    }[] = [];
    const leftC: {
      j: number;
      block: RenderedBlock;
    }[] = [];

    for (const s of lcsSteps(
      o.slice(pi, ai),
      c.slice(pj, aj),
      (x, y) => x.text === y.text,
    )) {
      if (s.op === "both") {
        pairs.push([pi + s.i, pj + s.j]);
      } else if (s.op === "a") {
        leftO.push({
          i: pi + s.i,
          block: s.a,
        });
      } else {
        leftC.push({
          j: pj + s.j,
          block: s.b,
        });
      }
    }

    let k = 0;

    for (const left of leftO) {
      const found = leftC.findIndex(
        (right, idx) =>
          idx >= k &&
          right.block.kind === left.block.kind &&
          similarity(left.block.text, right.block.text) >= 0.4,
      );
      const match = leftC[found];

      if (match) {
        pairs.push([left.i, match.j]);
        k = found + 1;
      }
    }

    if (ai < o.length) {
      pairs.push([ai, aj]);
    }

    pi = ai + 1;
    pj = aj + 1;
  }

  return pairs.sort((a, b) => a[1] - b[1]);
}
