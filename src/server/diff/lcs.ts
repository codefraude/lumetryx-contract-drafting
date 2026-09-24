/**
 * Longest-common-subsequence alignment of two sequences (whose items are never undefined), shared
 * by the word diff and the block alignment. On a tie the next item of `a` is taken as removed.
 */

export type LcsStep<T> = { op: "both"; i: number; j: number; a: T; b: T } | { op: "a"; i: number; a: T } | { op: "b"; j: number; b: T };

export function lcsSteps<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): LcsStep<T>[] {
  const width = b.length + 1;
  // length(i, j): LCS of a[i:] and b[j:]. The last row and column stay 0.
  const table = new Uint32Array((a.length + 1) * width);
  const length = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const x = a[i];
      const y = b[j];
      table[i * width + j] = x !== undefined && y !== undefined && same(x, y) ? length(i + 1, j + 1) + 1 : Math.max(length(i + 1, j), length(i, j + 1));
    }
  }
  const steps: LcsStep<T>[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const x = a[i];
    const y = b[j];
    if (x === undefined || y === undefined) break;
    if (same(x, y)) steps.push({ op: "both", i: i++, j: j++, a: x, b: y });
    else if (length(i + 1, j) >= length(i, j + 1)) steps.push({ op: "a", i: i++, a: x });
    else steps.push({ op: "b", j: j++, b: y });
  }
  a.slice(i).forEach((x, k) => steps.push({ op: "a", i: i + k, a: x }));
  b.slice(j).forEach((y, k) => steps.push({ op: "b", j: j + k, b: y }));
  return steps;
}
