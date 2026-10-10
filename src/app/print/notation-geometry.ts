import * as VM from '../types/model';
import { adiastematicFromSpaceds, DHelperLine, DNote, DTie, Drawable, fromSpaceds } from '../notes/Drawables';

/**
 * Geometry of one syllable for printing, computed from the model alone (no DOM, no Angular).
 * Coordinates are the note component's "raw" units: staff lines at y = 40..80, note-head
 * glyph boxes 12 x 60 (8 x 40 for liquescents) with the head around y + 30.
 */
export interface SyllableGeometry {
  /** Syllable type Normal: notes are drawn (otherwise a placeholder box). */
  isNormal: boolean;
  showClef: boolean;
  /** Drawables per voice, in note-group coordinates (the group starts at `shiftUnits`). */
  voices: Drawable[][];
  /** x of the note group in the cell: 12, or 44 after the clef; -1 when there are no notes. */
  shiftUnits: number;
  /** Width of the cell's notation in raw units. */
  widthUnits: number;
  /** Highest raw y that must stay visible (stems, neume brackets, ledger lines above). */
  minTop: number;
  /** Lowest ledger line (raw y), 0 when there is none. */
  lowestLedger: number;
  /** Lowest raw y per voice (note glyphs, ledger lines), for the bottom padding. */
  lowest: number[];
}

/** Room the clef takes before the note group (same as the note component). */
export const CLEF_SHIFT = 32;
const NOTE_GROUP_X = 12;

export function syllableGeometry(s: VM.Syllable, opts: { showClef: boolean; adiastematic: boolean }): SyllableGeometry {
  const isNormal = s.syllableType === VM.SyllableType.Normal;
  const showClef = opts.showClef && !opts.adiastematic;
  const spaceds = [s.notes, ...(s.additionalMelodies || [])];
  const voices = isNormal ? (opts.adiastematic ? adiastematicFromSpaceds(spaceds, []) : fromSpaceds(spaceds, [])) : spaceds.map(() => []);
  const shiftUnits = isNormal ? NOTE_GROUP_X + (showClef ? CLEF_SHIFT : 0) : -1;

  let svgW = 0;          // like NotesComponent.calculateWidth: last drawable x + 12
  let contentRight = 0;  // rightmost glyph / bracket
  let minTop = 40;
  let lowestLedger = 0;
  const lowest: number[] = [];
  for (const ds of voices) {
    let low = 0;
    let maxX = 0;
    for (const d of ds) {
      maxX = Math.max(maxX, d.x);
      if (d instanceof DNote) {
        const w = d.ref.liquescent ? 8 : 12;
        contentRight = Math.max(contentRight, d.x + w);
        minTop = Math.min(minTop, d.y + 18);                                  // stem top of an ascending note
        low = Math.max(low, d.y + (d.ref.noteType === VM.NoteType.Descending ? 43 : 36));
      } else if (d instanceof DTie) {
        contentRight = Math.max(contentRight, d.right);
        minTop = Math.min(minTop, d.y - DTie.LEG - 1);
      } else if (d instanceof DHelperLine) {
        minTop = Math.min(minTop, d.y);
        lowestLedger = Math.max(lowestLedger, d.y);
        low = Math.max(low, d.y + 1);
      }
    }
    svgW = Math.max(svgW, maxX + 12);
    lowest.push(low);
  }
  const base = 12 + Math.max(30, svgW) + (showClef ? CLEF_SHIFT : 0);
  const widthUnits = isNormal ? Math.max(base, shiftUnits + contentRight + 8) : 12 + 30 + (showClef ? CLEF_SHIFT : 0);
  return { isNormal, showClef, voices, shiftUnits, widthUnits, minTop, lowestLedger, lowest };
}
