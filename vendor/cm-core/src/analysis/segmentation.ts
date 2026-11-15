/**
 * How a chant is cut into segments for the segment methods (ChantDigger's "syllable segments" and their generalisations).
 *
 * ChantDigger cuts by syllable: a segment is the notes sung on one syllable. Other cuts are as natural in a neume
 * edition and answer other questions:
 *  - `syllable`: the notes on one syllable (the ChantDigger segment);
 *  - `neume`: the notes written without a gap (one `spaced` element of the editor), the unit of the neume tables;
 *  - `word`: the notes over one word (several syllables), for melismas and word-bound formulas;
 *  - `notes`: groups of n notes one after the other, independent of text and neumes (a fixed-size window that tiles the chant).
 * A cut is a list of spans of note indexes; spans do not overlap and follow each other.
 */
import type { ChantFeatures } from './corpus';

export type Segmentation = 'syllable' | 'neume' | 'word' | 'notes';

export const SEGMENTATION_OPTIONS: { value: Segmentation; label: string }[] = [
  { value: 'syllable', label: 'Syllable: the notes on one syllable (ChantDigger)' },
  { value: 'neume', label: 'Neume: notes written without a gap' },
  { value: 'word', label: 'Word: the notes over one word' },
  { value: 'notes', label: 'Groups of n notes, one after the other' },
];

/** Notes `start` … `end - 1` of a chant (`end` is exclusive). */
export interface Span { start: number; end: number }

/** The segments of a chant for a cut. `n` is the group size of the cut `notes`. */
export function segmentSpans(f: ChantFeatures, how: Segmentation, n = 3): Span[] {
  const total = f.pitches.length;
  switch (how) {
    case 'syllable': {
      const out: Span[] = [];
      for (let s = 0; s < f.sylLen.length; s++) if (f.sylLen[s] > 0) out.push({ start: f.sylStart[s], end: f.sylStart[s] + f.sylLen[s] });
      return out;
    }
    case 'neume':
      return f.neumeStart.map((start, i) => ({ start, end: i + 1 < f.neumeStart.length ? f.neumeStart[i + 1] : total }));
    case 'word':
      return f.wordStart.map((start, i) => ({ start, end: f.wordEnd[i] }));
    default: {
      const size = Math.max(1, Math.floor(n));
      const out: Span[] = [];
      for (let a = 0; a < total; a += size) out.push({ start: a, end: Math.min(total, a + size) });
      return out;
    }
  }
}

/** For every note, the index of the segment it lies in, or -1 for a note outside every segment. */
export function segmentOfNotes(f: ChantFeatures, how: Segmentation, n = 3): Int32Array {
  const out = new Int32Array(f.pitches.length).fill(-1);
  segmentSpans(f, how, n).forEach((sp, i) => { for (let k = sp.start; k < sp.end; k++) out[k] = i; });
  return out;
}

/** A short phrase for titles and notes: "syllable segments", "neumes", … */
export function describeSegmentation(how: Segmentation, n: number): string {
  switch (how) {
    case 'syllable': return 'syllable segments';
    case 'neume': return 'neumes';
    case 'word': return 'word segments';
    default: return `groups of ${n} notes`;
  }
}
