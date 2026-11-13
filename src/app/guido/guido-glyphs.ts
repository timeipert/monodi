import { GUIDO_GLYPHS_HU } from './guido-glyphs.hu';

/**
 * What a character of the GUIDO font is. The table is measured out of the font by
 * scripts/guido-import/build_glyph_table.py (every note glyph carries its own piece of staff, so its
 * pitch is drawn into it), calibrated on the digits 0..9 = the steps C4..E5 of a G clef.
 */
export type GlyphClass =
  | 'punctum' | 'virga' | 'quilisma' | 'tenor'      // notes; `step` = diatonic steps above C4
  | 'plica'                                          // hook after a note on its step
  | 'sharp' | 'flat' | 'natural'                     // sign of alteration on `step`
  | 'connector'                                      // stroke between two notes, no pitch of its own
  | 'bar'                                            // phrasing mark
  | 'gap'                                            // empty staff, one notehead wide
  | 'clef';

export interface Glyph {
  cls: GlyphClass;
  step?: number;
  clef?: string;
}

export type GuidoGlyphTable = { [char: string]: Glyph };

/** Glyph tables by id; a template names the one that matches its font and keyboard layout. */
export const GLYPH_TABLES: { [id: string]: GuidoGlyphTable } = {
  'guido6-hu': GUIDO_GLYPHS_HU,
};

export const NOTE_CLASSES: readonly GlyphClass[] = ['punctum', 'virga', 'quilisma', 'tenor'];
