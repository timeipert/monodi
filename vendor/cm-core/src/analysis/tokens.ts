/**
 * Units a chant can be cut into (pitch, interval, contour, word) and the counting of n-grams over them.
 *
 * Pitches and intervals are written as one character each (the number plus an offset), so an n-gram is a short string
 * that is cheap to hash; `labelOfKey` turns it back into text for tables.
 */
import { intervalLabel, pitchLabel } from './corpus';
import type { ChantFeatures } from './corpus';
import { contourNotation, intervalNotation, pitchNotation } from './notation';
import type { Cell, NotationCell } from './result';

export type Unit = 'pitch' | 'interval' | 'contour' | 'word';

export const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'interval', label: 'Intervals (signed steps between notes)' },
  { value: 'pitch', label: 'Pitches (with octave)' },
  { value: 'contour', label: 'Contour (up, repeat, down)' },
  { value: 'word', label: 'Text words' },
];

const OFFSET = 1000;

/** The tokens of a chant for a unit, each as a string. Interval and contour tokens are one note shorter than pitches. */
export function tokenize(f: ChantFeatures, unit: Unit): string[] {
  switch (unit) {
    case 'pitch':
      return f.pitches.map((p) => String.fromCharCode(OFFSET + p));
    case 'interval': {
      const out: string[] = [];
      for (let i = 1; i < f.pitches.length; i++) out.push(String.fromCharCode(OFFSET + f.pitches[i] - f.pitches[i - 1]));
      return out;
    }
    case 'contour': {
      const out: string[] = [];
      for (let i = 1; i < f.pitches.length; i++) {
        const d = f.pitches[i] - f.pitches[i - 1];
        out.push(d > 0 ? 'u' : d < 0 ? 'd' : 'r');
      }
      return out;
    }
    default:
      return f.words;
  }
}

/** The separator between the tokens of an n-gram key: none for one-character units, a space for words. */
export function joinerOf(unit: Unit): string {
  return unit === 'word' ? ' ' : '';
}

/** Readable text of an n-gram key: `D4 F4 G4`, `+2 -1`, `u d`, `et in`. */
export function labelOfKey(unit: Unit, key: string): string {
  if (unit === 'word') return key;
  const chars = [...key];
  if (unit === 'contour') return chars.join(' ');
  return chars
    .map((c) => {
      const v = c.charCodeAt(0) - OFFSET;
      return unit === 'pitch' ? pitchLabel(v) : intervalLabel(v);
    })
    .join(' ');
}

/** Visit every window of `n` tokens as a key. */
export function forEachWindow(tokens: readonly string[], n: number, joiner: string, visit: (key: string, start: number) => void): void {
  for (let i = 0; i + n <= tokens.length; i++) {
    let key = tokens[i];
    for (let k = 1; k < n; k++) key += joiner + tokens[i + k];
    visit(key, i);
  }
}

/** Upper bound on distinct keys held in memory by the counting methods. */
export const MAX_DISTINCT = 1_500_000;

/** The n-gram of a key as a cell: notes for pitch, interval and contour units, text for words. */
export function cellOfKey(unit: Unit, key: string): Cell {
  if (unit === 'word') return key;
  const chars = [...key];
  if (unit === 'contour') return contourNotation(key, 64);
  const values = chars.map((c) => c.charCodeAt(0) - OFFSET);
  return unit === 'pitch' ? pitchNotation(values, 64) : intervalNotation(values, 64);
}

/** The notes of an n-gram key for a bar label, or `undefined` for words. */
export function notationOfKey(unit: Unit, key: string): NotationCell['notation'] | undefined {
  const c = cellOfKey(unit, key);
  return typeof c === 'object' && c !== null && 'notation' in c ? c.notation : undefined;
}
