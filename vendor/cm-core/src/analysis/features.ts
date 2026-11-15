/**
 * Reading a document tree into `ChantFeatures`.
 *
 * Reading rule (one place, documented in `apps/monodi/documentation/ANALYSIS-WORKBENCH.md`):
 *  - only the first voice (`syllable.notes`) is read, a second voice (`additionalMelodies`) is ignored;
 *  - latent notes (`isLatent`, notes that are implied but not written) are skipped;
 *  - an accidental (flat, sharp, natural) is not a note of the melody: it is skipped and counted in `accidentals`
 *    (the MEI export treats it the same way; Monodi does not say which note it affects, so B and B-flat are not told apart);
 *  - every syllable is kept, also one without notes, so that syllable counts and words are those of the text.
 *
 * The search of Monodi-Zero reads notes in its own way (it counts accidentals as notes); results of the analysis
 * methods therefore differ slightly from the melody search on chants that contain accidentals.
 */
import { allNotes, baseNoteIndexes, getSyllables, NoteType } from '../document/model';
import type { Container, Note } from '../document/model';
import type { ChantFeatures } from './corpus';

const ACCIDENTALS = new Set<string>([NoteType.Flat, NoteType.Sharp, NoteType.Natural]);

const LEAD_DASH = /^[-­‐‑]+/;
const TRAIL_DASH = /[-­‐‑]+$/;

/** Diatonic index of a note: `octave * 7 + step`. */
export function diatonicIndex(note: Pick<Note, 'base' | 'octave'>): number {
  return note.octave * 7 + (baseNoteIndexes[note.base] ?? 0);
}

/** True for a flat, sharp or natural sign. */
export function isAccidental(note: Pick<Note, 'noteType'>): boolean {
  return ACCIDENTALS.has(note.noteType);
}

/** A word rebuilt from syllables: its text and the first and last syllable (indexes into the syllable list) it spans. */
export interface WordRange { word: string; first: number; last: number }

/**
 * Whole words from syllable texts. Two consecutive syllables belong to one word when the left one ends with a hyphen
 * or the right one starts with one (both conventions of the editor are handled). Words are lower case, letters only;
 * syllables without text are skipped.
 */
export function wordRanges(texts: readonly string[]): WordRange[] {
  const out: WordRange[] = [];
  let cur = '';
  let first = -1;
  let last = -1;
  let prevTrail = false;
  const flush = () => {
    const clean = cur.replace(/[^A-Za-z\u00c0-\u00ff]/g, '').toLowerCase();
    if (clean) out.push({ word: clean, first, last });
    cur = ''; first = -1; last = -1;
  };
  texts.forEach((raw, i) => {
    const t = (raw || '').trim();
    if (!t) return;
    const lead = LEAD_DASH.test(t);
    const trail = TRAIL_DASH.test(t);
    const core = t.replace(LEAD_DASH, '').replace(TRAIL_DASH, '');
    const sameWord = prevTrail || lead;
    if (!sameWord && cur) flush();
    if (first < 0) first = i;
    last = i;
    cur += core;
    prevTrail = trail;
  });
  flush();
  return out;
}

/** The words of syllable texts (see `wordRanges`). */
export function wordsFromSyllables(texts: readonly string[]): string[] {
  return wordRanges(texts).map((w) => w.word);
}

/** Reduce a document tree (the notes of one document) to its features. */
export function extractFeatures(root: Container): ChantFeatures {
  const pitches: number[] = [];
  const sylStart: number[] = [];
  const sylLen: number[] = [];
  const sylText: string[] = [];
  const neumeStart: number[] = [];
  let accidentals = 0;
  for (const syl of getSyllables(root)) {
    sylStart.push(pitches.length);
    let n = 0;
    // A neume is everything written without a gap: one element of `spaced`.
    for (const neume of syl.notes.spaced) {
      const before = pitches.length;
      for (const ligature of neume.nonSpaced) {
        for (const note of ligature.grouped) {
          if (isAccidental(note)) { accidentals++; continue; }
          if (note.isLatent) continue;
          pitches.push(diatonicIndex(note));
          n++;
        }
      }
      if (pitches.length > before) neumeStart.push(before);
    }
    sylLen.push(n);
    sylText.push(syl.text ?? '');
  }
  const ranges = wordRanges(sylText);
  const wordStart: number[] = [];
  const wordEnd: number[] = [];
  for (const w of ranges) {
    const a = sylStart[w.first];
    const b = sylStart[w.last] + sylLen[w.last];
    if (b > a) { wordStart.push(a); wordEnd.push(b); }
  }
  return { pitches, sylStart, sylLen, sylText, words: ranges.map((w) => w.word), neumeStart, wordStart, wordEnd, accidentals };
}

/** For every note, the index of the syllable that carries it. */
export function noteSyllableIndex(f: ChantFeatures): number[] {
  const out = new Array<number>(f.pitches.length);
  for (let s = 0; s < f.sylStart.length; s++) {
    for (let k = 0; k < f.sylLen[s]; k++) out[f.sylStart[s] + k] = s;
  }
  return out;
}

/** Indexes of the syllables that carry at least one note. */
export function noteBearingSyllables(f: ChantFeatures): number[] {
  const out: number[] = [];
  for (let s = 0; s < f.sylLen.length; s++) if (f.sylLen[s] > 0) out.push(s);
  return out;
}

/** The pitches of syllable `s`. */
export function syllablePitches(f: ChantFeatures, s: number): number[] {
  return f.pitches.slice(f.sylStart[s], f.sylStart[s] + f.sylLen[s]);
}

/** Signed steps between consecutive notes. */
export function intervalsOf(pitches: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pitches.length; i++) out.push(pitches[i] - pitches[i - 1]);
  return out;
}
