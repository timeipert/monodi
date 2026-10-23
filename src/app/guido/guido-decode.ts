import { GuidoGlyphTable, NOTE_CLASSES } from './guido-glyphs';
import { GuidoShape } from './guido-template';

export type Accidental = '' | 'flat' | 'sharp' | 'natural';

export interface GuidoNote {
  /** Diatonic steps above C4 (step 0 = C4, 7 = C5, -1 = B3). */
  step: number;
  shape: GuidoShape;
  plica: boolean;
  accidental: Accidental;
}

/** What one cell (one syllable) of GUIDO code says. */
export interface GuidoCell {
  /** neume > ligature group > notes: a full gap starts a neume, a short gap a group inside it. */
  neumes: GuidoNote[][][];
  /** Phrasing marks (, . : ;) found in the cell. */
  punct: string;
  /** Clef found in the cell ('G'), '' when none. */
  clef: string;
  /** Characters that are not in the glyph table. */
  unhandled: string[];
  warnings: string[];
}

export interface GuidoSymbols {
  join: string;
  shortGap: string;
}

/**
 * Reads the code of one syllable. Signs of the font (see guido-glyphs.ts): a note starts a note; a plica
 * belongs to the note before it on the same step; a sign of alteration waits for the next note on its
 * step; connecting strokes carry no pitch; an empty glyph is a join (same ligature) or a short gap (new
 * ligature group in the same neume); empty staff is a full gap (new neume), trailing ones are padding.
 */
export function decodeCell(code: string, table: GuidoGlyphTable, symbols: GuidoSymbols): GuidoCell {
  const cell: GuidoCell = { neumes: [], punct: '', clef: '', unhandled: [], warnings: [] };
  const neumes: GuidoNote[][][] = [];
  let groups: GuidoNote[][] = [];
  let notes: GuidoNote[] = [];
  const pending = new Map<number, Accidental>();
  let last: GuidoNote | null = null;

  const closeGroup = () => {
    if (notes.length) { groups.push(notes); notes = []; }
  };
  const closeNeume = () => {
    closeGroup();
    if (groups.length) { neumes.push(groups); groups = []; }
  };

  for (const ch of code) {
    if (ch === symbols.join || /\s/.test(ch)) continue;
    if (ch === symbols.shortGap) { closeGroup(); continue; }
    const g = table[ch];
    if (!g) { cell.unhandled.push(ch); continue; }
    if (g.cls === 'gap') closeNeume();
    else if ((NOTE_CLASSES as readonly string[]).includes(g.cls)) {
      const note: GuidoNote = {
        step: g.step as number, shape: g.cls as GuidoShape, plica: false,
        accidental: pending.get(g.step as number) ?? '',
      };
      pending.delete(g.step as number);
      notes.push(note);
      last = note;
    } else if (g.cls === 'plica') {
      if (last && last.step === g.step) last.plica = true;
      else cell.warnings.push(`plica ${JSON.stringify(ch)} (step ${g.step}) does not follow a note on its step`);
    } else if (g.cls === 'sharp' || g.cls === 'flat' || g.cls === 'natural') {
      pending.set(g.step as number, g.cls);
    } else if (g.cls === 'bar') cell.punct += ch;
    else if (g.cls === 'clef') cell.clef = g.clef ?? '';
    // connector: no pitch of its own
  }
  closeNeume();
  pending.forEach((acc, step) => cell.warnings.push(`${acc} sign on step ${step} found no note to apply to`));
  cell.neumes = neumes;
  return cell;
}

const BASES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Step above C4 -> note name and octave (step 0 = C4). */
export function stepToPitch(step: number): { base: typeof BASES[number]; octave: number } {
  const di = 28 + step;
  return { base: BASES[((di % 7) + 7) % 7], octave: Math.floor(di / 7) };
}
