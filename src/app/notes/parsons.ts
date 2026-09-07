import { v4 as UUID } from 'uuid';
import * as M from '../types/model';

/**
 * Parsons-style code for adiastematic lines. Each neume is a run of direction
 * tokens; neumes are separated by a '.' (the "unclear" marker) in the text.
 *
 *   *  first note of a neume (neutral start, relation to the previous neume
 *      is unknown)
 *   u  a second higher than the previous note
 *   d  a second lower
 *   e  equal (same height)
 *
 * Within a neume, direction tokens written together (e.g. `*ud`) form one
 * slurred group (drawn with a connecting slur); a space starts a new group
 * (`*u d`). Directions are always relative to the immediately preceding note,
 * regardless of group boundaries.
 *
 * The stored model still holds real Notes (so comments, alignment, MEI export
 * etc. keep working). We map directions onto single diatonic steps around a
 * neutral pitch — magnitude is irrelevant to the adiastematic drawing, which
 * only reads the sign of the step.
 */

const INDEX_TO_BASE: M.BaseNote[] = [
  M.BaseNote.C, M.BaseNote.D, M.BaseNote.E, M.BaseNote.F,
  M.BaseNote.G, M.BaseNote.A, M.BaseNote.B,
];

// Neutral middle-ish start pitch for each neume (G4).
const START_DI = 4 * 7 + M.baseNoteIndexes[M.BaseNote.G];

function noteFromDi(di: number): M.Note {
  return {
    uuid: UUID(),
    base: INDEX_TO_BASE[((di % 7) + 7) % 7],
    octave: Math.floor(di / 7),
    noteType: M.NoteType.Normal,
    liquescent: false,
    focus: false,
  };
}

function di(n: M.Note): number {
  return n.octave * 7 + M.baseNoteIndexes[n.base];
}

/** Serialize a melody to Parsons code (neumes joined by ' . ', slurred groups
 *  written together, separate groups space-separated). */
export function spacedToParsons(spaced: M.Spaced): string {
  const neumes = spaced.spaced.map(ns => {
    // Flatten for direction (always relative to the previous note), but keep
    // group boundaries so we can insert spaces between groups.
    let prev: M.Note | undefined;
    const groupStrs = ns.nonSpaced.map(g => {
      let s = '';
      for (const n of g.grouped) {
        s += prev === undefined ? '*' : (di(n) > di(prev) ? 'u' : di(n) < di(prev) ? 'd' : 'e');
        prev = n;
      }
      return s;
    }).filter(s => s.length > 0);
    return groupStrs.join(' ');
  }).filter(s => s.length > 0);
  return neumes.join(' . ');
}

/** Parse Parsons code back into a melody model (staircase pitches). */
export function parsonsToSpaced(text: string): M.Spaced {
  // Neumes are separated by '.' (optionally spaced) or by 2+ spaces.
  const neumeStrs = text
    .split(/\s*\.\s*|\s{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const spaced: M.NonSpaced[] = [];
  for (const neume of neumeStrs) {
    // Groups within a neume are separated by whitespace; tokens within a group
    // are written together and become one slurred Grouped.
    const groupStrs = neume.split(/\s+/).map(s => s.replace(/[^*udeUDE]/g, '')).filter(s => s.length > 0);
    if (groupStrs.length === 0) continue;
    const groups: M.Grouped[] = [];
    let d = START_DI;
    let first = true;
    for (const gs of groupStrs) {
      const groupNotes: M.Note[] = [];
      for (const ch of gs) {
        const c = ch.toLowerCase();
        if (first) { d = START_DI; first = false; }
        else if (c === 'u') d += 1;
        else if (c === 'd') d -= 1;
        // 'e' or a stray '*' mid-neume => same height
        groupNotes.push(noteFromDi(d));
      }
      groups.push({ grouped: groupNotes });
    }
    spaced.push({ nonSpaced: groups });
  }

  return { spaced };
}
