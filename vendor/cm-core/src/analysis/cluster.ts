/**
 * Hierarchical clustering and a two-dimensional map of a distance matrix.
 */

export interface Merge {
  /** Node ids: leaves are `0…n-1`; merge `i` creates node `n + i`. */
  a: number;
  b: number;
  height: number;
  size: number;
}

/**
 * Average-linkage (UPGMA) clustering of a symmetric distance matrix. O(n^3), fine up to a few hundred items.
 * Returns the `n - 1` merges in order of increasing height.
 */
export function averageLinkage(dist: readonly (readonly number[])[]): Merge[] {
  const n = dist.length;
  const d: number[][] = dist.map((row) => [...row]);
  const active: number[] = Array.from({ length: n }, (_, i) => i);
  const node: number[] = Array.from({ length: n }, (_, i) => i);
  const size: number[] = new Array<number>(n).fill(1);
  const merges: Merge[] = [];
  while (active.length > 1) {
    let bi = 0; let bj = 1; let best = Infinity;
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const v = d[active[x]][active[y]];
        if (v < best) { best = v; bi = x; bj = y; }
      }
    }
    const i = active[bi];
    const j = active[bj];
    const total = size[i] + size[j];
    merges.push({ a: node[i], b: node[j], height: best, size: total });
    for (const k of active) {
      if (k === i || k === j) continue;
      const v = (d[i][k] * size[i] + d[j][k] * size[j]) / total;
      d[i][k] = v;
      d[k][i] = v;
    }
    size[i] = total;
    node[i] = n + merges.length - 1;
    active.splice(bj, 1);
  }
  return merges;
}

/** The order of the leaves in the dendrogram (depth-first, so that merged leaves are neighbours). */
export function leafOrder(n: number, merges: readonly Merge[]): number[] {
  if (n === 0) return [];
  if (merges.length === 0) return [0];
  const out: number[] = [];
  const visit = (id: number) => {
    if (id < n) { out.push(id); return; }
    const m = merges[id - n];
    visit(m.a);
    visit(m.b);
  };
  visit(n + merges.length - 1);
  return out;
}

/**
 * Classical multidimensional scaling to two dimensions: the first two eigenvectors of the double-centred squared
 * distance matrix, by power iteration with deflation. Deterministic (fixed start vector). Returns `null` below three items.
 */
export function classicalMds(dist: readonly (readonly number[])[]): [number, number][] | null {
  const n = dist.length;
  if (n < 3) return null;
  const sq = dist.map((row) => row.map((v) => v * v));
  const rowMean = sq.map((row) => row.reduce((s, v) => s + v, 0) / n);
  const grand = rowMean.reduce((s, v) => s + v, 0) / n;
  const b: number[][] = sq.map((row, i) => row.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + grand)));
  const axes: { vec: number[]; val: number }[] = [];
  for (let k = 0; k < 2; k++) {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1 + k * 7) + 0.5);
    let val = 0;
    for (let iter = 0; iter < 300; iter++) {
      const w = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) { let s = 0; const row = b[i]; for (let j = 0; j < n; j++) s += row[j] * v[j]; w[i] = s; }
      for (const prev of axes) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += w[i] * prev.vec[i];
        for (let i = 0; i < n; i++) w[i] -= dot * prev.vec[i];
      }
      const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
      if (norm < 1e-12) { val = 0; break; }
      v = w.map((x) => x / norm);
      const next = norm;
      if (Math.abs(next - val) < 1e-10 * Math.max(1, next)) { val = next; break; }
      val = next;
    }
    axes.push({ vec: v, val });
  }
  const scale = (a: { vec: number[]; val: number }) => Math.sqrt(Math.max(a.val, 0));
  return Array.from({ length: n }, (_, i) => [axes[0].vec[i] * scale(axes[0]), axes[1].vec[i] * scale(axes[1])] as [number, number]);
}
