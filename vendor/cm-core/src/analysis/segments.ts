/**
 * Syllable segments, after ChantDigger (Max Haas, 2014).
 *
 * A *segment* is the sequence of notes over one syllable. Every distinct segment of the corpus gets an id (in order of
 * first occurrence, so ids depend on the corpus and its order), and a chant becomes the sequence of its segment ids.
 * Syllables without notes carry no segment.
 *
 * ChantDigger finds *similar* segments with four criteria. They are reproduced here from its source
 * (`bildePunkte`, `bildeIsomorphien`, `bildeGenaueKontur`, `bildeKontur`), with the pitch of a note given as the
 * diatonic index:
 *  - `points`: the first, the last, the highest and the lowest note;
 *  - `isomorphism`: the differences of successive notes (the same shape, transposed);
 *  - `shape-intervals`: the first difference and every difference at which the direction changes;
 *  - `shape-coarse`: as `shape-intervals`, every odd value moved up to the next even one (coarser steps).
 * Two segments are similar when the vectors of the chosen criterion are equal.
 */
import { segmentSpans } from './segmentation';
import type { Segmentation, Span } from './segmentation';
import type { ChantFeatures } from './corpus';

export type Criterion = 'exact' | 'points' | 'isomorphism' | 'shape-intervals' | 'shape-coarse';

export const CRITERION_OPTIONS: { value: Criterion; label: string }[] = [
  { value: 'exact', label: 'Identical notes (no similarity)' },
  { value: 'points', label: 'Points: same first, last, highest and lowest note' },
  { value: 'isomorphism', label: 'Isomorphism: same steps between notes (transposed)' },
  { value: 'shape-intervals', label: 'Shape by intervals: same steps at the turning points' },
  { value: 'shape-coarse', label: 'Shape by shape: as above, in coarse steps' },
];

/** First, last, highest, lowest. */
export function segmentPoints(p: readonly number[]): number[] {
  if (p.length === 0) return [];
  let lo = p[0];
  let hi = p[0];
  for (const v of p) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [p[0], p[p.length - 1], hi, lo];
}

/** Differences of successive notes, `next - previous` read as ChantDigger does (`previous - next`) negated. */
export function segmentDifferences(p: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < p.length; i++) out.push(p[i] - p[i - 1]);
  return out;
}

/** ChantDigger's `bildeIsomorphien`: successive differences. (It subtracts next from previous; the sign is global.) */
export function segmentIsomorphism(p: readonly number[]): number[] {
  return segmentDifferences(p);
}

/**
 * ChantDigger's `bildeGenaueKontur`: the first difference, then each difference at which the direction changes.
 * A repeated note (difference 0) keeps the direction of the movement before it. (One deliberate deviation from the
 * original: see the comment on `now` below.)
 */
export function segmentShapeIntervals(p: readonly number[]): number[] {
  const d = segmentDifferences(p);
  if (d.length === 0) return [];
  const out = [d[0]];
  let before = d[0] > 0 ? 1 : 0;
  // ChantDigger starts the running direction at "down", so a repeated note after an ascending first step registers a
  // turn that is not one (and hides the next real turn). Here it starts as the direction of the first step.
  let now = before;
  for (let k = 1; k < d.length; k++) {
    if (d[k] > 0) now = 1;
    else if (d[k] < 0) now = 0;
    if (before !== now) { out.push(d[k]); before = now; }
  }
  return out;
}

/** ChantDigger's `bildeKontur`: `segmentShapeIntervals` with every odd value moved up to the next even value. */
export function segmentShapeCoarse(p: readonly number[]): number[] {
  return segmentShapeIntervals(p).map((v) => (v % 2 === 0 ? v : v + 1));
}

/** The vector of a segment under a criterion, as a text key (equal keys = similar segments). */
export function criterionKey(c: Criterion, p: readonly number[]): string {
  switch (c) {
    case 'points': return segmentPoints(p).join(',');
    case 'isomorphism': return segmentIsomorphism(p).join(',');
    case 'shape-intervals': return segmentShapeIntervals(p).join(',');
    case 'shape-coarse': return segmentShapeCoarse(p).join(',');
    default: return p.join(',');
  }
}

export interface SegmentInfo {
  id: number;
  pitches: number[];
  /** Total number of occurrences in the corpus. */
  count: number;
  /** Number of chants that contain it. */
  docs: number;
}

export interface SegmentIndex {
  segments: SegmentInfo[];
  /** For each chant, the segment ids in reading order. */
  chantSegments: number[][];
  /** For each chant, the notes (`start` … `end - 1`) of each entry of `chantSegments`. */
  chantSpans: Span[][];
}

/**
 * Build the segment index of a corpus for a cut (`how`, default: by syllable as in ChantDigger; `n` is the group size
 * of the cut `notes`). Equal note sequences are one segment, whatever the cut that produced them.
 */
export function buildSegmentIndex(chants: readonly ChantFeatures[], how: Segmentation = 'syllable', n = 3): SegmentIndex {
  const byKey = new Map<string, number>();
  const segments: SegmentInfo[] = [];
  const lastDoc: number[] = [];
  const chantSegments: number[][] = [];
  const chantSpans: Span[][] = [];
  chants.forEach((c, d) => {
    const ids: number[] = [];
    const spans = segmentSpans(c, how, n);
    for (const sp of spans) {
      const p = c.pitches.slice(sp.start, sp.end);
      const key = p.join(',');
      let id = byKey.get(key);
      if (id === undefined) {
        id = segments.length;
        byKey.set(key, id);
        segments.push({ id, pitches: p, count: 0, docs: 0 });
        lastDoc.push(-1);
      }
      segments[id].count++;
      if (lastDoc[id] !== d) { lastDoc[id] = d; segments[id].docs++; }
      ids.push(id);
    }
    chantSegments.push(ids);
    chantSpans.push(spans);
  });
  return { segments, chantSegments, chantSpans };
}

/** Positions at which a sequence of segment ids occurs as consecutive segments of a chant. */
export function findSegmentSequence(ids: readonly number[], query: readonly number[]): number[] {
  const out: number[] = [];
  if (query.length === 0) return out;
  for (let i = 0; i + query.length <= ids.length; i++) {
    let ok = true;
    for (let k = 0; k < query.length; k++) if (ids[i + k] !== query[k]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * Positions at which notes `query` occur in order within a window: ChantDigger's search "d f a c' a g 10". The first
 * and the last matched note must lie less than `width` positions apart; the notes between need not be adjacent.
 * Matching is greedy (each next note is the first occurrence after the previous one), as in ChantDigger, and one match
 * is reported per starting position that succeeds.
 */
export function windowMatches<T = number>(pitches: readonly T[], query: readonly T[], width: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (query.length === 0) return out;
  for (let i = 0; i < pitches.length; i++) {
    if (pitches[i] !== query[0]) continue;
    let at = i;
    let ok = true;
    for (let k = 1; k < query.length; k++) {
      let j = at + 1;
      while (j < pitches.length && pitches[j] !== query[k] && j - i < width) j++;
      if (j >= pitches.length || pitches[j] !== query[k]) { ok = false; break; }
      at = j;
    }
    if (ok && at - i < width) out.push({ start: i, end: at });
  }
  return out;
}
