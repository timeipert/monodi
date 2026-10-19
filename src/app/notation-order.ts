/**
 * The order of the neume table, as the Neumen-Editor (neume-docs) sets it, so that a manuscript's
 * documentation reads the same in both:
 *
 *   1. first by tones (the number of notes), then by how often the pattern occurs in the
 *      Corpus Monodicum. A direction (`*ud`) is counted over every way of writing it, brackets and
 *      signs ignored.
 *   2. the plain shapes come first, in the order of the standard table
 *        * | *d *u *e | *dd *ud *uu *du | *udd *uud *ddu
 *      then the special signs, each in a group of its own: L (liquescent), O (oriscus), Q (quilisma),
 *      S (strophicus), then other signs.
 *   3. a pattern with signs belongs to the group of its FIRST special sign.
 *
 * Vocabulary: a *code* is a pattern as written (`[*u]dL`); its *signature* has no brackets (`*udL`);
 * its *direction* has no signs either (`*ud`); *tones* is the number of notes.
 *
 * Pure functions on strings.
 */

import { CM_PATTERN_COUNTS } from './data/cm-pattern-counts';

/** The plain shapes of the standard table, in the order of the editorial brief. */
export const STANDARD_DIRECTIONS = ['*', '*d', '*u', '*e', '*dd', '*ud', '*uu', '*du', '*udd', '*uud', '*ddu'];

/** The special signs, in the order of their groups. `header` is how the table heads the group. */
export const SPECIAL_SIGNS = [
  { key: 'L', header: 'L', label: 'Liquescent' },
  { key: 'O', header: 'O', label: 'Oriscus' },
  { key: 'Q', header: 'Q', label: 'Quilisma' },
  { key: 'S', header: ',', label: 'Strophicus' },
];
const SPECIAL_KEYS = SPECIAL_SIGNS.map(s => s.key);

const NOTE_CHARS = new Set(['*', 'u', 'd', 'e']);

/** A pattern as typed: the first word (an old " b" variant letter is dropped). */
export const baseCode = (pattern: string | null | undefined): string => String(pattern ?? '').trim().split(/\s+/)[0] ?? '';

/** The code without ligature brackets and parentheses. */
export const signatureOf = (code: string): string => baseCode(code).replace(/[[\]{}()]/g, '');

/** The signature without sign letters: the movement only. */
export const directionOf = (code: string): string => signatureOf(code).replace(/[A-Z]/g, '');

/** Number of notes. */
export function toneCount(code: string): number {
  let n = 0;
  for (const ch of directionOf(code)) if (NOTE_CHARS.has(ch)) n++;
  return n;
}

export type CodeKind = 'direction' | 'special' | 'custom' | 'other';

export interface CodeClass {
  code: string;
  signature: string;
  direction: string;
  tones: number;
  kind: CodeKind;
  /** The special sign whose group the code is in (`kind` 'special'), else ''. */
  sign: string;
}

export function classify(code: string): CodeClass {
  const base = baseCode(code);
  const signature = signatureOf(base);
  const direction = directionOf(base);
  const tones = toneCount(base);
  if (!tones || !signature.includes('*')) return { code: base, signature, direction, tones: 0, kind: 'other', sign: '' };
  const first = [...signature].find(ch => SPECIAL_KEYS.includes(ch)) ?? '';
  if (first) return { code: base, signature, direction, tones, kind: 'special', sign: first };
  if (/[A-Z]/.test(signature)) return { code: base, signature, direction, tones, kind: 'custom', sign: '' };
  return { code: base, signature, direction, tones, kind: 'direction', sign: '' };
}

// ── Frequency ────────────────────────────────────────────────────────────────────────────────

export interface Frequency {
  code(c: string): number;
  signature(s: string): number;
  direction(d: string): number;
}

/** Index the number of occurrences of every code, so a code, a signature or a direction can be asked for its frequency. */
export function buildFrequency(counts: { readonly [code: string]: number }): Frequency {
  const byCode = new Map<string, number>();
  const bySignature = new Map<string, number>();
  const byDirection = new Map<string, number>();
  for (const [code, n] of Object.entries(counts)) {
    const cl = classify(code);
    if (!n || cl.kind === 'other') continue;
    byCode.set(cl.code, (byCode.get(cl.code) ?? 0) + n);
    bySignature.set(cl.signature, (bySignature.get(cl.signature) ?? 0) + n);
    byDirection.set(cl.direction, (byDirection.get(cl.direction) ?? 0) + n);
  }
  return {
    code: c => byCode.get(baseCode(c)) ?? 0,
    signature: s => bySignature.get(s) ?? 0,
    direction: d => byDirection.get(d) ?? 0,
  };
}

/** The frequencies of the Corpus Monodicum. */
export const CM_FREQUENCY: Frequency = buildFrequency(CM_PATTERN_COUNTS);

// ── Order ────────────────────────────────────────────────────────────────────────────────────

const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/** Directions: fewer tones first, then by frequency; ties keep the order of the standard table. */
export function compareDirections(a: string, b: string, freq: Frequency = CM_FREQUENCY): number {
  const ta = toneCount(a), tb = toneCount(b);
  if (ta !== tb) return ta - tb;
  const fa = freq.direction(a), fb = freq.direction(b);
  if (fa !== fb) return fb - fa;
  const ia = STANDARD_DIRECTIONS.indexOf(a), ib = STANDARD_DIRECTIONS.indexOf(b);
  if (ia !== ib) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  return natural(a, b);
}

/** Signatures: fewer tones first, then by the frequency of the signature. */
export function compareSignatures(a: string, b: string, freq: Frequency = CM_FREQUENCY): number {
  const ta = toneCount(a), tb = toneCount(b);
  if (ta !== tb) return ta - tb;
  const fa = freq.signature(a), fb = freq.signature(b);
  if (fa !== fb) return fb - fa;
  return natural(a, b);
}

/** Codes: fewer tones first, then by the frequency of the code itself. */
export function compareCodes(a: string, b: string, freq: Frequency = CM_FREQUENCY): number {
  const ta = toneCount(a), tb = toneCount(b);
  if (ta !== tb) return ta - tb;
  const fa = freq.code(a), fb = freq.code(b);
  if (fa !== fb) return fb - fa;
  return natural(baseCode(a), baseCode(b));
}

const GROUP_RANK = (cl: CodeClass): number =>
  cl.kind === 'direction' ? 0 : cl.kind === 'special' ? 1 + SPECIAL_KEYS.indexOf(cl.sign) : cl.kind === 'custom' ? 1 + SPECIAL_KEYS.length : 2 + SPECIAL_KEYS.length;

/**
 * The order of the neume table: plain shapes (by tones, then frequency), then the group of each special sign
 * (L, O, Q, S), then other signs; inside one shape or signature the ways of writing it, most frequent first.
 */
export function compareForTable(a: string, b: string, freq: Frequency = CM_FREQUENCY): number {
  const ca = classify(a), cb = classify(b);
  const ga = GROUP_RANK(ca), gb = GROUP_RANK(cb);
  if (ga !== gb) return ga - gb;
  const shape = ca.kind === 'direction' ? compareDirections(ca.direction, cb.direction, freq) : compareSignatures(ca.signature, cb.signature, freq);
  return shape || compareCodes(a, b, freq);
}

/** Sort codes in the order of the table. Does not modify the input. */
export const sortForTable = (codes: readonly string[], freq: Frequency = CM_FREQUENCY): string[] =>
  [...codes].sort((a, b) => compareForTable(a, b, freq));

/**
 * Patterns of the library that match a query, in table order. A query without brackets matches the
 * signature (`*udL` finds `[*u]dL`, `*[ud]L` and `[*ud]L`); one with brackets matches the code as written.
 */
export function searchPatterns(query: string, exclude: ReadonlySet<string> = new Set(), limit = 40,
                               counts: { readonly [code: string]: number } = CM_PATTERN_COUNTS): string[] {
  const q = query.trim();
  if (!q) return [];
  const withBrackets = /[[\]{}]/.test(q);
  const needle = withBrackets ? q : q.replace(/[()]/g, '');
  const hits: string[] = [];
  for (const code of Object.keys(counts)) {
    if (exclude.has(code)) continue;
    const cl = classify(code);
    if (cl.kind === 'other') continue;
    if ((withBrackets ? code : cl.signature).includes(needle)) hits.push(code);
  }
  return sortForTable(hits).slice(0, limit);
}

/** The most frequent way of writing each plain shape of the standard table (`*d` → `[*d]`). */
export function mostFrequentForms(directions: readonly string[] = STANDARD_DIRECTIONS, counts: { readonly [code: string]: number } = CM_PATTERN_COUNTS): string[] {
  return directions.map(dir => {
    let best = '', bestN = -1;
    for (const [code, n] of Object.entries(counts)) {
      const cl = classify(code);
      if (cl.kind === 'direction' && cl.direction === dir && n > bestN) { best = code; bestN = n; }
    }
    return best || dir;
  });
}
