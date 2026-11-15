/**
 * Searching a corpus for a melodic pattern: pitches, intervals or contour, exact or with a number of differences, or
 * with the notes spread inside a window (ChantDigger "d f a c' a g 10"). Used by the Analysis page to search the chants of
 * an analysis; independent of the search of the search page (which reads accidentals as notes).
 */
import { pitchLabel, stepOf } from './corpus';
import type { ChantFeatures, Corpus } from './corpus';
import { intervalsOf } from './features';
import { makeTable } from './result';
import type { Cell, TableView } from './result';
import { pitchNotation } from './notation';
import { windowMatches } from './segments';

export type PatternUnit = 'pitch' | 'interval' | 'contour';

export const PATTERN_UNIT_OPTIONS: { value: PatternUnit; label: string; example: string }[] = [
  { value: 'pitch', label: 'Pitches', example: 'd f g a   (or D4 F4 G4 A4 with octaves)' },
  { value: 'interval', label: 'Intervals (steps)', example: '+2 +1 -3' },
  { value: 'contour', label: 'Contour', example: 'u u d r   (up, up, down, repeat)' },
];

export interface Pattern {
  unit: PatternUnit;
  /** Pitch: diatonic indexes when `octave`, else steps 0–6. Interval: signed steps. Contour: 1, 0, -1. */
  values: number[];
  /** Pitch only: true when every token named an octave, so octaves must match. */
  octave: boolean;
}

export type ParsedPattern = { pattern: Pattern } | { error: string };

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

/** Read the text a user typed into a pattern. */
export function parsePattern(text: string, unit: PatternUnit): ParsedPattern {
  const t = text.trim();
  if (!t) return { error: 'Enter a pattern.' };
  if (unit === 'pitch') {
    let tokens: string[];
    if (/\s/.test(t) || /,/.test(t)) tokens = t.split(/[\s,]+/).filter(Boolean);
    else if (/^[a-gA-G]+$/.test(t)) tokens = [...t];
    else tokens = t.match(/[a-gA-G]\d?/g) ?? [];
    if (tokens.length === 0) return { error: 'No notes found. Use the letters a–g, optionally with an octave number (D4).' };
    const parsed: { step: number; octave: number | null }[] = [];
    for (const tok of tokens) {
      const m = /^([a-gA-G])(\d)?$/.exec(tok);
      if (!m) return { error: `"${tok}" is not a note. Use a letter a–g, optionally with an octave number (D4).` };
      parsed.push({ step: LETTERS.indexOf(m[1].toLowerCase()), octave: m[2] === undefined ? null : Number(m[2]) });
    }
    const octave = parsed.every((p) => p.octave !== null);
    return { pattern: { unit, octave, values: parsed.map((p) => (octave ? (p.octave as number) * 7 + p.step : p.step)) } };
  }
  if (unit === 'interval') {
    const tokens = t.split(/[\s,]+/).filter(Boolean);
    const values: number[] = [];
    for (const tok of tokens) {
      if (!/^[+-]?\d+$/.test(tok)) return { error: `"${tok}" is not an interval. Use signed numbers of steps such as +2 -1 0.` };
      values.push(Number(tok));
    }
    return { pattern: { unit, octave: false, values } };
  }
  const chars = [...t.replace(/[\s,]+/g, '')];
  const values: number[] = [];
  for (const c of chars) {
    if (c === 'u') values.push(1); else if (c === 'd') values.push(-1); else if (c === 'r') values.push(0);
    else return { error: `"${c}" is not a contour step. Use u (up), d (down) and r (repeat).` };
  }
  return { pattern: { unit, octave: false, values } };
}

export interface PatternMatch {
  /** Index of the first and last note of the matched passage (inclusive). */
  start: number;
  end: number;
  /** Number of differences from the pattern (0 = exact). */
  distance: number;
}

/** The sequence of a chant that a pattern is compared with, and how many notes one sequence element spans at its end. */
function sequenceOf(f: ChantFeatures, p: Pattern): number[] {
  if (p.unit === 'pitch') return p.octave ? f.pitches : f.pitches.map(stepOf);
  const iv = intervalsOf(f.pitches);
  return p.unit === 'interval' ? iv : iv.map((v) => Math.sign(v));
}

/**
 * Approximate substring matching (Sellers): all passages of `seq` within `maxDist` insertions, deletions or substitutions
 * of `pat`. Overlapping candidates are reduced to the best ones, fewest differences first.
 */
function approximate(seq: readonly number[], pat: readonly number[], maxDist: number): PatternMatch[] {
  const n = seq.length;
  const m = pat.length;
  if (m === 0 || n === 0) return [];
  let prev = new Array<number>(m + 1);
  let prevStart = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  let curStart = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) { prev[i] = i; prevStart[i] = 0; }
  const found: PatternMatch[] = [];
  for (let j = 0; j < n; j++) {
    cur[0] = 0; curStart[0] = j + 1;
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1] + (seq[j] === pat[i - 1] ? 0 : 1);
      const ins = cur[i - 1] + 1; // a pattern element missing from the chant
      const del = prev[i] + 1;    // a chant element not in the pattern
      let best = sub; let from = prevStart[i - 1];
      if (ins < best) { best = ins; from = curStart[i - 1]; }
      if (del < best) { best = del; from = prevStart[i]; }
      cur[i] = best; curStart[i] = from;
    }
    if (cur[m] <= maxDist) found.push({ start: curStart[m], end: j, distance: cur[m] });
    const t = prev; prev = cur; cur = t;
    const ts = prevStart; prevStart = curStart; curStart = ts;
  }
  found.sort((a, b) => a.distance - b.distance || a.start - b.start);
  const taken: PatternMatch[] = [];
  for (const c of found) if (!taken.some((t) => c.start <= t.end && t.start <= c.end)) taken.push(c);
  return taken.sort((a, b) => a.start - b.start);
}

export interface SearchOptions {
  /** Differences allowed (0 = exact). */
  maxDistance: number;
  /** When set (exact search only): the notes must occur in order within this many notes, not adjacent. */
  window?: number;
}

/** Passages of one chant that match the pattern. For intervals and contour the passage includes the note before the first step. */
export function searchChant(f: ChantFeatures, p: Pattern, opts: SearchOptions): PatternMatch[] {
  if (p.values.length === 0) return [];
  const seq = sequenceOf(f, p);
  let raw: PatternMatch[];
  if (opts.window && opts.window > 0 && opts.maxDistance === 0) {
    raw = windowMatches(seq, p.values, opts.window).map((m) => ({ start: m.start, end: m.end, distance: 0 }));
  } else {
    raw = approximate(seq, p.values, Math.max(0, opts.maxDistance));
  }
  return p.unit === 'pitch' ? raw : raw.map((m) => ({ ...m, end: m.end + 1 }));
}

export interface CorpusSearchResult {
  table: TableView;
  chants: number;
  matches: number;
}

/**
 * Search every chant of a corpus. The table has one row per chant with a match: the chant, its source, the number of
 * passages, the fewest differences, where the first passage starts, and the first passage as notes.
 */
export function searchCorpus(corpus: Corpus, p: Pattern, opts: SearchOptions, rowCap = 2000): CorpusSearchResult {
  const rows: Cell[][] = [];
  const docs: string[][] = [];
  let matches = 0;
  corpus.chants.forEach((c, d) => {
    const found = searchChant(c, p, opts);
    if (found.length === 0) return;
    matches += found.length;
    const best = Math.min(...found.map((m) => m.distance));
    const first = found[0];
    rows.push([
      corpus.docs[d].label, corpus.docs[d].sigle, found.length, best, first.start + 1,
      pitchNotation(c.pitches.slice(first.start, first.end + 1)),
    ]);
    docs.push([corpus.docs[d].id]);
  });
  const table = makeTable({
    title: 'Chants with the pattern',
    columns: [
      { key: 'chant', label: 'Chant' }, { key: 'source', label: 'Source' },
      { key: 'times', label: 'Passages', numeric: true }, { key: 'dist', label: 'Differences', numeric: true, help: 'Fewest differences of a passage from the pattern; 0 is exact.' },
      { key: 'at', label: 'First at note', numeric: true }, { key: 'excerpt', label: 'First passage' },
    ],
    rows, rowDocs: docs, cap: rowCap,
    note: p.unit === 'pitch' && !p.octave ? 'Octaves are ignored: the pattern named no octave.' : undefined,
  });
  return { table, chants: rows.length, matches };
}

/** The pattern as text, for titles. */
export function describePattern(p: Pattern): string {
  if (p.unit === 'pitch') return p.values.map((v) => (p.octave ? pitchLabel(v) : LETTERS[v].toUpperCase())).join(' ');
  if (p.unit === 'interval') return p.values.map((v) => (v > 0 ? `+${v}` : String(v))).join(' ');
  return p.values.map((v) => (v > 0 ? 'u' : v < 0 ? 'd' : 'r')).join(' ');
}
