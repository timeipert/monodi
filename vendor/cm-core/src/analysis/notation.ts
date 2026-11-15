/**
 * Notes for the result tables: building the cells and laying them out on a staff.
 *
 * The geometry is that of the Monodi editor: a five-line staff with the lines 10 units apart (y = 40, 50, 60, 70, 80, the
 * lowest line at 80), one diatonic step is 5 units. In the editor the staff is a treble staff: a note at octave `o` and
 * step `s` (C = 0 … B = 6) lies at y = 90 - 5 * (7 * (o - 4) + s), so E4 is on the lowest line, G4 on the second line from
 * the bottom (where the G clef sits), B4, D5 and F5 on the others, and C4 on the first ledger line below.
 *
 * - Pitches (absolute) are drawn on that staff with the fixed G clef, whatever their range; notes outside the staff get
 *   ledger lines and the drawing grows to hold them.
 * - Intervals and contours (relative) have no clef: the first note is placed so that the melody is centred.
 * The user interface draws the layout as SVG with the same note head and clef outline as the editor.
 */
import { intervalLabel, pitchLabel } from './corpus';
import type { NotationCell } from './result';

export const NOTATION_MAX = 16;

export function pitchNotation(pitches: readonly number[], max = NOTATION_MAX): NotationCell {
  const shown = pitches.slice(0, max);
  const more = pitches.length > max;
  return { notation: { mode: 'pitch', values: shown, more }, text: shown.map(pitchLabel).join(' ') + (more ? ' …' : '') };
}

export function intervalNotation(steps: readonly number[], max = NOTATION_MAX): NotationCell {
  const shown = steps.slice(0, max - 1);
  const more = steps.length > max - 1;
  return { notation: { mode: 'interval', values: shown, more }, text: shown.map(intervalLabel).join(' ') + (more ? ' …' : '') };
}

/** A contour (`u` up, `d` down, `r` repeat) as steps of one scale degree. */
export function contourNotation(contour: string, max = NOTATION_MAX): NotationCell {
  const chars = [...contour];
  const shown = chars.slice(0, max - 1);
  const more = chars.length > max - 1;
  return {
    notation: { mode: 'interval', values: shown.map((c) => (c === 'u' ? 1 : c === 'd' ? -1 : 0)), more },
    text: shown.join(' ') + (more ? ' …' : ''),
  };
}

export const STAFF_LINES = [40, 50, 60, 70, 80] as const;
const STEP = 5;
const NOTE_DX = 15;
const CLEF_W = 30;
const PAD = 6;

export interface NotationLayout {
  /** The drawing is `width` wide and spans `top` … `top + height` vertically (units of the editor staff). */
  width: number;
  top: number;
  height: number;
  /** True when the fixed G clef is drawn at the start of the staff (absolute pitches). */
  clef: boolean;
  /** Centres of the note heads. */
  heads: { x: number; y: number }[];
  /** Short lines through or beside heads that lie outside the staff. */
  ledgers: { x1: number; x2: number; y: number }[];
  more: boolean;
}

/** Diatonic index of the lowest line of the treble staff of the editor: E4 (octave 4, step 2). */
export const TREBLE_BOTTOM_LINE = 4 * 7 + 2;

/** Absolute positions (diatonic indexes) of the notes of a cell; an interval cell starts at 0. */
export function notePositions(n: NotationCell['notation']): number[] {
  if (n.mode === 'pitch') return [...n.values];
  const out = [0];
  for (const v of n.values) out.push(out[out.length - 1] + v);
  return out;
}

export function layoutNotation(n: NotationCell['notation']): NotationLayout {
  const pos = notePositions(n);
  const count = pos.length;
  const clef = n.mode === 'pitch';
  let bottom: number; // diatonic index of the lowest staff line
  if (clef) {
    bottom = TREBLE_BOTTOM_LINE;
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pos) { if (p < lo) lo = p; if (p > hi) hi = p; }
    bottom = count === 0 ? 0 : Math.round((lo + hi) / 2) - 4;
  }
  const left = clef ? CLEF_W : PAD;
  const yOf = (d: number) => 80 - STEP * (d - bottom);
  const heads = pos.map((d, i) => ({ x: left + i * NOTE_DX + NOTE_DX / 2, y: yOf(d) }));
  const ledgers: NotationLayout['ledgers'] = [];
  const topLine = bottom + 8;
  pos.forEach((d, i) => {
    const x = heads[i].x;
    for (let l = bottom - 2; l >= d - 1; l -= 2) ledgers.push({ x1: x - 9, x2: x + 9, y: yOf(l) });
    for (let l = topLine + 2; l <= d + 1; l += 2) ledgers.push({ x1: x - 9, x2: x + 9, y: yOf(l) });
  });
  const ys = heads.map((h) => h.y);
  const top = Math.min(32, ...(ys.length ? ys : [60]).map((y) => y - 10));
  const bot = Math.max(88, ...(ys.length ? ys : [60]).map((y) => y + 10));
  return { width: left + count * NOTE_DX + PAD + (n.more ? 12 : 0), top, height: bot - top, clef, heads, ledgers, more: !!n.more };
}
