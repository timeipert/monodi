/**
 * Volpiano import / export.
 *
 * Volpiano (developed by Fabian Weber, University of Regensburg) is the plain-text
 * chant-encoding used by the CANTUS Database. This module converts between the
 * Monodi note model and Volpiano strings, following the CANTUS "Volpiano Protocols".
 *
 * Pitch mapping (non-transposing treble clef `1`, which CANTUS always uses):
 *
 *   8 9 a b c d e f g h j k l m n o p q r s
 *   F G A B C D E F G A B C D E F G A B C D
 *   3 3 3 3 4 4 4 4 4 4 4 5 5 5 5 5 5 5 6 6   (scientific octave)
 *
 *   → `c` is middle C (C4); `b` is B3; the lowest letter `8` is F3.
 *
 * Uppercase letters ` ) A B C … S ` are the *liquescent* forms (small note-heads),
 * aligned one step up from `8` (`)` = liquescent G3, `A` = liquescent A3, …).
 *
 * Spacing (protocol §5):
 *   -    single hyphen — between neumes sung to the same syllable
 *   --   double hyphen — between syllables of the same word
 *   ---  triple hyphen — between words (and before/after a clef)
 *
 * B-flat / E-flat are written with a sign character placed before the affected
 * note (protocol §6). In Monodi a sign is a note of its own (`NoteType.Flat` / `Natural`)
 * that stands before the sounding note, so import creates that accidental note plus a
 * normal note, and export writes only the sign for it:
 *   y/Y = b-flat/natural in the B3 register   w/W = e-flat/natural in the E4 register
 *   i/I = b-flat/natural in the B4 register   x/X = e-flat/natural in the E5 register
 *   z/Z = b-flat/natural in the B5 register
 *
 * Structural tokens handled leniently: `1`/`2` clef, `3`/`4` barlines,
 * `7` line break, `77` page/folio break, `777` column break.
 *
 * Level mapping. Volpiano knows only "connected" (adjacent letters = one ligature)
 * vs. "separated" (`-`). The Monodi model has three levels (neume / connection-gap /
 * ligature). On export every Monodi ligature (`Grouped`) becomes one connected run
 * and every gap between ligatures — whether a within-neume connection gap or a neume
 * boundary — becomes a single `-`. This is musically faithful (same pitches, same
 * ligatures); only the distinction "which ligatures shared one neume" is not
 * expressible in Volpiano and is therefore not round-tripped.
 */
import {
  RootContainer,
  ContainerKind,
  LinePartKind,
  ZeileContainer,
  Syllable,
  Note,
  MiscContainer,
  NoteType,
  BaseNote,
  Spaced,
  SyllableType,
  DocumentType,
  emptySyllable,
  getAllLineContainers,
} from '../types/model';
import { v4 as UUID } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────
// Pitch table
// ─────────────────────────────────────────────────────────────────────────────

/** Diatonic step index within an octave (matches model.baseNoteIndexes: C starts the octave). */
const STEP_TO_INDEX: Record<BaseNote, number> = {
  [BaseNote.C]: 0,
  [BaseNote.D]: 1,
  [BaseNote.E]: 2,
  [BaseNote.F]: 3,
  [BaseNote.G]: 4,
  [BaseNote.A]: 5,
  [BaseNote.B]: 6,
};
const INDEX_TO_STEP: BaseNote[] = [
  BaseNote.C, BaseNote.D, BaseNote.E, BaseNote.F, BaseNote.G, BaseNote.A, BaseNote.B,
];

/** Volpiano pitch letters in ascending order, lowest = `8` (F3). */
const VP_NORMAL_ORDER = '89abcdefghjklmnopqrs';
/** Liquescent letters, aligned so index 0 (`)`) sits one step above `8`, i.e. G3. */
const VP_LIQ_ORDER = ')ABCDEFGHJKLMNOPQRS';
/** Diatonic index of `8` (F3) = 3*7 + STEP_TO_INDEX[F] = 24. */
const VP_LOW_DI = 24;
/** Diatonic index of the lowest liquescent glyph `)` (G3) = 25. */
const VP_LIQ_LOW_DI = VP_LOW_DI + 1;

/** Sign characters keyed by the diatonic index of the note they affect. */
const FLAT_SIGN: Record<number, string> = { 27: 'y', 34: 'i', 41: 'z', 30: 'w', 37: 'x' };
const NAT_SIGN: Record<number, string> = { 27: 'Y', 34: 'I', 41: 'Z', 30: 'W', 37: 'X' };
/** Reverse lookups: sign char → diatonic index it toggles. */
const FLAT_CHAR_TO_DI: Record<string, number> = { y: 27, i: 34, z: 41, w: 30, x: 37 };
const NAT_CHAR_TO_DI: Record<string, number> = { Y: 27, I: 34, Z: 41, W: 30, X: 37 };

function diatonicIndex(base: BaseNote, octave: number): number {
  return octave * 7 + STEP_TO_INDEX[base];
}

/** Convert a diatonic index back to a (base, octave) pair. */
function fromDiatonicIndex(di: number): { base: BaseNote; octave: number } {
  return { base: INDEX_TO_STEP[((di % 7) + 7) % 7], octave: Math.floor(di / 7) };
}

/**
 * Pitch → Volpiano letter. Returns `null` (with a reason) when the pitch lies
 * outside the Volpiano range (below F3 or above D6).
 */
export function pitchToVolpianoChar(
  base: BaseNote,
  octave: number,
  liquescent: boolean
): { char: string } | { char: null; reason: string } {
  const di = diatonicIndex(base, octave);
  const normIdx = di - VP_LOW_DI;
  if (normIdx < 0 || normIdx >= VP_NORMAL_ORDER.length) {
    return { char: null, reason: `pitch ${base}${octave} is outside the Volpiano range (F3–D6)` };
  }
  if (liquescent) {
    const liqIdx = di - VP_LIQ_LOW_DI;
    if (liqIdx >= 0 && liqIdx < VP_LIQ_ORDER.length) {
      return { char: VP_LIQ_ORDER[liqIdx] };
    }
    // Only F3 (the lowest letter) has no liquescent glyph — fall back to normal.
    return { char: VP_NORMAL_ORDER[normIdx] };
  }
  return { char: VP_NORMAL_ORDER[normIdx] };
}

/** Volpiano pitch letter → pitch. Returns `null` for non-pitch characters. */
export function volpianoCharToPitch(
  char: string
): { base: BaseNote; octave: number; liquescent: boolean } | null {
  const normIdx = VP_NORMAL_ORDER.indexOf(char);
  if (normIdx >= 0) {
    return { ...fromDiatonicIndex(VP_LOW_DI + normIdx), liquescent: false };
  }
  const liqIdx = VP_LIQ_ORDER.indexOf(char);
  if (liqIdx >= 0) {
    return { ...fromDiatonicIndex(VP_LIQ_LOW_DI + liqIdx), liquescent: true };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export: Monodi → Volpiano
// ─────────────────────────────────────────────────────────────────────────────

export interface VolpianoExportResult {
  volpiano: string;
  warnings: string[];
}

/** All notes of a syllable, flattened into ligature runs (one per `Grouped`). */
function syllableToRuns(syllable: Syllable): Note[][] {
  const runs: Note[][] = [];
  const spaced = syllable.notes;
  if (!spaced || !spaced.spaced) return runs;
  for (const neume of spaced.spaced) {
    if (!neume.nonSpaced) continue;
    for (const grouped of neume.nonSpaced) {
      if (grouped.grouped && grouped.grouped.length > 0) {
        runs.push(grouped.grouped);
      }
    }
  }
  return runs;
}

/** Accidental notes of Monodi (a flat, natural or sharp is a note of its own that stands before the note it applies to). */
const ACCIDENTAL_TYPES: NoteType[] = [NoteType.Flat, NoteType.Natural, NoteType.Sharp];

/**
 * Serialise a single note. An accidental note becomes only its Volpiano sign (`y i z w x`, natural `Y I Z W X`) and no
 * pitch letter; a sounding note becomes its pitch letter. Signs are returned apart (`sign`) so that the caller can put
 * them in front of the next pitch letter, also when the sign is a run of its own.
 */
function noteToVolpiano(note: Note, warnings: string[]): { sign: string; letter: string } {
  const di = diatonicIndex(note.base, note.octave);
  if (note.noteType !== undefined && ACCIDENTAL_TYPES.includes(note.noteType)) {
    const sign =
      note.noteType === NoteType.Flat ? FLAT_SIGN[di] : note.noteType === NoteType.Natural ? NAT_SIGN[di] : undefined;
    if (!sign) {
      warnings.push(`no Volpiano sign for ${note.noteType.toLowerCase()} at ${note.base}${note.octave}; left out`);
    }
    return { sign: sign || '', letter: '' };
  }
  const res = pitchToVolpianoChar(note.base, note.octave, !!note.liquescent);
  if (res.char === null) {
    warnings.push(res.reason);
    return { sign: '', letter: '' };
  }
  return { sign: '', letter: res.char };
}

/**
 * Serialise one ligature run into a connected Volpiano letter run. `pending` holds signs that wait for the next pitch
 * letter; a run that holds only signs returns '' and leaves them in `pending`.
 */
function runToVolpiano(run: Note[], pending: { signs: string }, warnings: string[]): string {
  let out = '';
  for (const note of run) {
    if (note.isLatent) continue;
    const { sign, letter } = noteToVolpiano(note, warnings);
    pending.signs += sign;
    if (letter) {
      out += pending.signs + letter;
      pending.signs = '';
    }
  }
  return out;
}

type ExportEvent =
  | { t: 'syllable'; text: string; content: string }
  | { t: 'linebreak' }
  | { t: 'foliochange' };

/** Export a document's notation as a Volpiano string. */
export function rootToVolpiano(root: RootContainer): VolpianoExportResult {
  const warnings: string[] = [];
  const pending = { signs: '' };
  const lines: ZeileContainer[] = getAllLineContainers(root);
  const events: ExportEvent[] = [];

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) events.push({ t: 'linebreak' });
    for (const part of line.children || []) {
      if (part.kind === LinePartKind.Syllable) {
        const syl = part as Syllable;
        let content = '';
        if (syl.syllableType !== SyllableType.WithoutNotes) {
          const runs = syllableToRuns(syl);
          content = runs
            .map((run) => runToVolpiano(run, pending, warnings))
            .filter((r) => r.length > 0)
            .join('-');
        }
        events.push({ t: 'syllable', text: syl.text || '', content });
      } else if (part.kind === LinePartKind.FolioChange) {
        events.push({ t: 'foliochange' });
      } else if (part.kind === LinePartKind.LineChange) {
        events.push({ t: 'linebreak' });
      }
      // Clef and Box parts carry no Volpiano meaning here; the leading `1` clef is
      // emitted unconditionally below (Volpiano always uses non-transposing treble).
    }
  });

  let out = '1---';
  let prevEndsWithDash: boolean | null = null;
  for (const ev of events) {
    if (ev.t === 'linebreak') {
      out += '7';
      continue;
    }
    if (ev.t === 'foliochange') {
      out += '77';
      continue;
    }
    if (prevEndsWithDash === null) {
      out += ev.content;
    } else {
      out += (prevEndsWithDash ? '--' : '---') + ev.content;
    }
    prevEndsWithDash = ev.text.trimEnd().endsWith('-');
  }
  out += '---';

  return { volpiano: out, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import: Volpiano → Monodi
// ─────────────────────────────────────────────────────────────────────────────

export interface VolpianoImportResult {
  root: RootContainer;
  warnings: string[];
}

function makeNote(base: BaseNote, octave: number, liquescent: boolean, flat: boolean): Note {
  return {
    uuid: UUID(),
    base,
    octave,
    liquescent,
    noteType: flat ? NoteType.Flat : NoteType.Normal,
    focus: false,
  };
}

/** The accidental note for a Volpiano sign character (`y i z w x` flat, `Y I Z W X` natural), or null. */
function accidentalFromSign(ch: string): Note | null {
  const flat = FLAT_CHAR_TO_DI[ch];
  const natural = NAT_CHAR_TO_DI[ch];
  const di = flat !== undefined ? flat : natural;
  if (di === undefined) return null;
  const { base, octave } = fromDiatonicIndex(di);
  const note = makeNote(base, octave, false, false);
  note.noteType = flat !== undefined ? NoteType.Flat : NoteType.Natural;
  return note;
}

function runsToSpaced(runs: Note[][]): Spaced {
  return { spaced: runs.map((run) => ({ nonSpaced: [{ grouped: run }] })) };
}

/** A syllable accumulated during parsing: a list of ligature runs. */
interface ParsedSyllable {
  runs: Note[][];
  /** True when the following separator was a word boundary (`---`), a line/doc end. */
  wordEnd: boolean;
}

/**
 * How the optional `text` passed to `volpianoToRoot` is interpreted:
 *  - `hyphenated`: Monodi text, e.g. "Quo-ni-am de-us" (words by space, syllables by `-`).
 *  - `syllables`:  one whitespace-separated token per melody syllable, e.g. "Quo ni am de us";
 *                  word-boundary hyphens are reconstructed from the melody itself.
 */
export type VolpianoTextMode = 'hyphenated' | 'syllables';

/**
 * Split an aligned text string into syllables using the Monodi convention:
 * words are separated by whitespace and syllables within a word by `-`; every
 * non-final syllable of a word keeps a trailing `-`.
 *   "Quo-ni-am de-us" → ["Quo-", "ni-", "am", "de-", "us"]
 */
export function splitTextIntoSyllables(text: string): string[] {
  const out: string[] = [];
  for (const word of text.trim().split(/\s+/).filter((w) => w.length > 0)) {
    const parts = word.split('-');
    parts.forEach((p, i) => {
      out.push(i < parts.length - 1 ? p + '-' : p);
    });
  }
  return out;
}

/**
 * Parse a Volpiano string into a document. Unknown characters are skipped and
 * reported in `warnings`. When `text` is supplied it is distributed over the
 * parsed syllables (in order), giving a faithful round-trip of word boundaries.
 */
export function volpianoToRoot(
  volpiano: string,
  text?: string,
  opts?: { textMode?: VolpianoTextMode }
): VolpianoImportResult {
  const warnings: string[] = [];
  const src = (volpiano || '').trim();
  const textMode: VolpianoTextMode = opts?.textMode || 'hyphenated';

  // Lines of syllables; a new line starts on 7 / 77 / 777 or a barline.
  const lines: ParsedSyllable[][] = [[]];
  let currentSyllable: ParsedSyllable = { runs: [], wordEnd: false };
  let currentRun: Note[] = [];
  let sawAnyPitchInSyllable = false;

  const pushRun = () => {
    if (currentRun.length > 0) {
      currentSyllable.runs.push(currentRun);
      currentRun = [];
    }
  };
  const pushSyllable = (wordEnd: boolean) => {
    pushRun();
    // Only emit a syllable once we've seen at least one pitch for it; this avoids a
    // spurious empty syllable from the leading `---` after the clef.
    if (sawAnyPitchInSyllable) {
      currentSyllable.wordEnd = wordEnd;
      lines[lines.length - 1].push(currentSyllable);
    }
    currentSyllable = { runs: [], wordEnd: false };
    sawAnyPitchInSyllable = false;
  };
  const newLine = () => {
    pushSyllable(true);
    lines.push([]);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Runs of hyphens: 1 = neume separator, 2 = syllable, 3+ = word (both end the syllable).
    if (ch === '-') {
      let n = 0;
      while (i < src.length && src[i] === '-') {
        n++;
        i++;
      }
      if (n === 1) {
        pushRun();
      } else {
        // `--` = syllable boundary within a word; `---`+ = word boundary.
        pushSyllable(n >= 3);
      }
      continue;
    }

    // Break markers: runs of 7 (7 line, 77 page, 777 column).
    if (ch === '7') {
      while (i < src.length && src[i] === '7') i++;
      newLine();
      continue;
    }

    // Clef (1, 2) and barlines (3 single, 4 double, 5 and 6 further barline forms). Barlines are not line breaks:
    // CANTUS puts them inside the melody of one chant, so they are skipped and do not split the text.
    if (ch >= '1' && ch <= '6') {
      i++;
      continue;
    }

    // Accidental signs become a note of their own before the note they apply to (as in the Monodi editor).
    const accidental = accidentalFromSign(ch);
    if (accidental) {
      currentRun.push(accidental);
      i++;
      continue;
    }

    // Pitches (normal and liquescent).
    const pitch = volpianoCharToPitch(ch);
    if (pitch) {
      currentRun.push(makeNote(pitch.base, pitch.octave, pitch.liquescent, false));
      sawAnyPitchInSyllable = true;
      i++;
      continue;
    }

    // Anything else (whitespace, `#` missing-text marker, `.`, custos, etc.) is ignored.
    if (!/\s/.test(ch)) {
      warnings.push(`ignored unrecognised character '${ch}' at position ${i}`);
    }
    i++;
  }
  pushSyllable(true);

  // Drop trailing empty lines.
  while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();

  // Optional aligned text → one final syllable string per parsed syllable.
  const flatSyllables: ParsedSyllable[] = lines.flat();
  let perSyllableText: string[] | null = null;
  if (text && text.trim().length > 0) {
    if (textMode === 'syllables') {
      // One whitespace-separated token per syllable; re-attach the word-boundary
      // hyphens from the melody so the text round-trips ("Quo ni am" → "Quo-","ni-","am").
      const tokens = text.trim().split(/\s+/);
      if (tokens.length !== flatSyllables.length) {
        warnings.push(
          `text has ${tokens.length} syllables but the melody has ${flatSyllables.length}; aligned by position`
        );
      }
      perSyllableText = flatSyllables.map((syl, idx) => {
        const tok = tokens[idx];
        // `_` marks a melody syllable without text (see `EMPTY_SYLLABLE`); the empty string cannot be a token of a list
        // split at white space.
        if (!tok || tok === '_') return '';
        return syl.wordEnd ? tok : tok + '-';
      });
    } else {
      perSyllableText = splitTextIntoSyllables(text);
      if (perSyllableText.length !== flatSyllables.length) {
        warnings.push(
          `text has ${perSyllableText.length} syllables but the melody has ${flatSyllables.length}; aligned by position`
        );
      }
    }
  }

  // Build the container tree: one MiscContainer holding one ZeileContainer per line.
  // A Volpiano line break (`7`) is represented purely as a new ZeileContainer, which
  // round-trips back to `7` on export (see rootToVolpiano).
  const zeilen: ZeileContainer[] = [];
  let textIdx = 0;
  lines.forEach((lineSyllables) => {
    const children: Syllable[] = [];
    for (const parsed of lineSyllables) {
      const syl = emptySyllable();
      if (parsed.runs.length > 0) {
        syl.notes = runsToSpaced(parsed.runs);
        syl.syllableType = SyllableType.Normal;
      } else {
        syl.syllableType = SyllableType.WithoutNotes;
      }
      if (perSyllableText) {
        syl.text = perSyllableText[textIdx] || '';
      }
      textIdx++;
      children.push(syl);
    }
    if (children.length === 0) {
      const syl = emptySyllable();
      syl.syllableType = SyllableType.WithoutNotes;
      children.push(syl);
    }
    zeilen.push({
      kind: ContainerKind.ZeileContainer,
      uuid: UUID(),
      children: children as ZeileContainer['children'],
    });
  });

  // No clef is written into the data: Volpiano's clef `1` is a treble clef, and the editor draws the automatic G clef at the
  // start of a document (see `clef-policy.ts`), so the pitches above are shown on the staff they were read for.

  const misc: MiscContainer = {
    kind: ContainerKind.MiscContainer,
    uuid: UUID(),
    children: zeilen as MiscContainer['children'],
  };

  const root: RootContainer = {
    kind: ContainerKind.RootContainer,
    uuid: UUID(),
    children: [misc],
    comments: [],
    documentType: DocumentType.Level1,
  };

  return { root, warnings };
}
