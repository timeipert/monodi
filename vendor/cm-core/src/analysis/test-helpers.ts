/**
 * Builders for tests of the analysis library: small chants and corpora, and a document tree with a given melody.
 * Not part of the public entry point.
 */
import { wordRanges } from './features';
import type { ChantFeatures, Corpus, DocInfo } from './corpus';
import type { RootContainer, Note, Syllable } from '../document/model';

/** A chant from syllables given as pitch lists (diatonic indexes) with optional text. */
export function chant(syllables: { text?: string; pitches: number[] }[]): ChantFeatures {
  const pitches: number[] = [];
  const sylStart: number[] = [];
  const sylLen: number[] = [];
  const sylText: string[] = [];
  for (const s of syllables) {
    sylStart.push(pitches.length);
    sylLen.push(s.pitches.length);
    sylText.push(s.text ?? '');
    pitches.push(...s.pitches);
  }
  const ranges = wordRanges(sylText);
  const wordStart: number[] = [];
  const wordEnd: number[] = [];
  for (const w of ranges) {
    const a = sylStart[w.first]; const b = sylStart[w.last] + sylLen[w.last];
    if (b > a) { wordStart.push(a); wordEnd.push(b); }
  }
  // One neume per syllable that has notes (the tests that care about neumes build their own).
  const neumeStart = sylStart.filter((_, i) => sylLen[i] > 0);
  return { pitches, sylStart, sylLen, sylText, words: ranges.map((w) => w.word), neumeStart, wordStart, wordEnd, accidentals: 0 };
}

/** A chant where every syllable carries one note. */
export function plain(pitches: number[], texts?: string[]): ChantFeatures {
  return chant(pitches.map((p, i) => ({ text: texts?.[i] ?? `s${i}`, pitches: [p] })));
}

export function docInfo(i: number, fields: Record<string, string> = {}): DocInfo {
  return { id: `d${i}`, sourceId: fields['src:quellensigle'] ?? 'S', sigle: fields['src:quellensigle'] ?? 'S', label: `chant ${i}`, fields };
}

export function corpusOf(chants: ChantFeatures[], fields: (i: number) => Record<string, string> = () => ({})): Corpus {
  return { docs: chants.map((_, i) => docInfo(i, fields(i))), chants };
}

let counter = 0;
function note(base: Note['base'], octave: number, extra: Partial<Note> = {}): Note {
  return { uuid: `n${counter++}`, noteType: 'Normal', base, octave, liquescent: false, focus: false, ...extra };
}

/** A note of the document model at a diatonic index (C = 0 … B = 6 inside the octave). */
export function noteAt(index: number, extra: Partial<Note> = {}): Note {
  const bases: Note['base'][] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  return note(bases[((index % 7) + 7) % 7], Math.floor(index / 7), extra);
}

export function syllableOf(text: string, notes: Note[], extra: Partial<Syllable> = {}): Syllable {
  return {
    kind: 'Syllable', uuid: `y${counter++}`, text, syllableType: 'Normal',
    notes: { spaced: notes.length ? [{ nonSpaced: [{ grouped: notes }] }] : [] },
    ...extra,
  };
}

/** A document tree with one line that holds the given syllables. */
export function rootOf(syllables: Syllable[]): RootContainer {
  return {
    kind: 'RootContainer', uuid: 'r', comments: [], documentType: 'Neumes',
    children: [{ kind: 'ZeileContainer', uuid: 'z', children: syllables }],
  };
}
