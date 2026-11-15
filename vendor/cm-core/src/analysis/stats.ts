/**
 * Statistics used by several methods. Each function states its source, so a result can be cited.
 */

const LN2 = Math.LN2;

/**
 * Log-likelihood ratio G2 for one item that occurs `a` times in a corpus of `n1` units and `b` times in a corpus of
 * `n2` units (Dunning 1993; Rayson and Garside 2000). Larger means a stronger difference in relative frequency;
 * with one degree of freedom, 3.84 corresponds to p < 0.05 and 6.63 to p < 0.01 for a single test (no correction for
 * the many items tested at once).
 */
export function logLikelihood(a: number, b: number, n1: number, n2: number): number {
  const total = n1 + n2;
  if (total === 0 || a + b === 0) return 0;
  const e1 = (n1 * (a + b)) / total;
  const e2 = (n2 * (a + b)) / total;
  let g2 = 0;
  if (a > 0 && e1 > 0) g2 += a * Math.log(a / e1);
  if (b > 0 && e2 > 0) g2 += b * Math.log(b / e2);
  return 2 * g2;
}

/**
 * Log ratio (Hardie 2014): the binary logarithm of the ratio of the relative frequencies. +1 means twice as frequent
 * in the first corpus. A frequency of 0 is replaced by 0.5 so the ratio stays finite.
 */
export function logRatio(a: number, b: number, n1: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const r1 = (a > 0 ? a : 0.5) / n1;
  const r2 = (b > 0 ? b : 0.5) / n2;
  return Math.log(r1 / r2) / LN2;
}

/** Pointwise mutual information in bits of a pair seen `fxy` times, from items seen `fx` and `fy` times in `n` pairs. */
export function pmi(fxy: number, fx: number, fy: number, n: number): number {
  if (fxy <= 0 || fx <= 0 || fy <= 0 || n <= 0) return 0;
  return Math.log((fxy * n) / (fx * fy)) / LN2;
}

/** Log-Dice (Rychly 2008): 14 + log2(2 fxy / (fx + fy)); at most 14, independent of the corpus size. */
export function logDice(fxy: number, fx: number, fy: number): number {
  if (fxy <= 0 || fx + fy <= 0) return 0;
  return 14 + Math.log((2 * fxy) / (fx + fy)) / LN2;
}

/** t-score of a pair: (observed - expected) / sqrt(observed). */
export function tScore(fxy: number, fx: number, fy: number, n: number): number {
  if (fxy <= 0 || n <= 0) return 0;
  return (fxy - (fx * fy) / n) / Math.sqrt(fxy);
}

/** Shannon entropy in bits of a distribution given as counts. */
export function entropy(counts: Iterable<number>): number {
  let total = 0;
  const list: number[] = [];
  for (const c of counts) { if (c > 0) { list.push(c); total += c; } }
  if (total === 0) return 0;
  let h = 0;
  for (const c of list) { const p = c / total; h -= p * Math.log(p); }
  return h / LN2;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n - 1); 0 for fewer than two values. */
export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Cosine similarity of two sparse vectors given as maps. */
export function cosineSparse(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Jaccard index of two sets: size of the intersection over size of the union (1 for two empty sets). */
export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Burrows' Delta between rows of a relative-frequency matrix (Burrows 2002): the mean absolute difference of the
 * z-scored frequencies. `freqs[i][j]` is the relative frequency of item `j` in text `i`.
 */
export function burrowsDelta(freqs: readonly (readonly number[])[]): number[][] {
  const n = freqs.length;
  const dim = n > 0 ? freqs[0].length : 0;
  const z: number[][] = freqs.map(() => new Array<number>(dim));
  for (let j = 0; j < dim; j++) {
    const col: number[] = [];
    for (let i = 0; i < n; i++) col.push(freqs[i][j]);
    const m = mean(col);
    const sd = stdDev(col) || 1;
    for (let i = 0; i < n; i++) z[i][j] = (freqs[i][j] - m) / sd;
  }
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      let s = 0;
      for (let j = 0; j < dim; j++) s += Math.abs(z[a][j] - z[b][j]);
      const d = dim ? s / dim : 0;
      out[a][b] = d;
      out[b][a] = d;
    }
  }
  return out;
}

/**
 * Banded edit distance (Levenshtein) of two integer sequences, stopping early once the distance must exceed `max`.
 * Returns `max + 1` in that case. Cost O(max * min(len a, len b)).
 */
export function editDistance(a: ArrayLike<number>, b: ArrayLike<number>, max: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (n === 0) return m <= max ? m : max + 1;
  if (m === 0) return n <= max ? n : max + 1;
  const INF = max + 1;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : INF;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - max);
    const hi = Math.min(m, i + max);
    cur[lo - 1] = lo === 1 ? (i <= max ? i : INF) : INF;
    let rowMin = cur[lo - 1];
    for (let j = lo; j <= hi; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const v = Math.min(sub, del, ins, INF);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < m) cur[hi + 1] = INF;
    if (rowMin >= INF) return INF;
    const t = prev; prev = cur; cur = t;
  }
  return Math.min(prev[m], INF);
}
