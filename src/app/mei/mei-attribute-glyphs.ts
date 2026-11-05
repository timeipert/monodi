/**
 * Small drawings for the MEI attributes of a note, shown in the staff on top of the note head. The notation itself is not changed:
 * the drawings are added next to the head, in the colour of the source of the attribute (set by hand, or written by a rule).
 *
 * The attributes are those that MEI neume notation (`<nc>`) defines for the shape of a neume component, and that Verovio, the
 * engraver of MEI neumes, takes into account (state 2026-11-05, MEI 5.0):
 *   - `tilt`: direction of the pen stroke (compass points n, ne, e, se, s, sw, w, nw) → a short line from the head in that direction.
 *   - `curve`: direction of the curvature, `a` anticlockwise, `c` clockwise → an arc beside the head.
 *   - `rellen`: length of the stroke relative to the previous component, `l` long, `s` short → a vertical bar below the head.
 *   - `con`: connection to the previous component, `g` gapped, `l` looped, `e` extended → a gap mark, a loop or a long line at the left.
 *   - `angled`: an angled stroke → a small angle above the head.
 *   - `hooked`: a stroke with an extension → a hook at the right.
 *   - `ligated`: takes part in a ligature → a bracket below the head.
 * Every other attribute (`name`, `type`, `lig`, ...) has no shape; the staff then marks the note with a dot.
 *
 * Coordinates: the origin is the centre of the note head; x grows to the right, y downwards (the unit is the unit of the staff).
 */
export interface AttrGlyph {
  /** The attribute this drawing stands for. */
  attr: string;
  /** SVG path data, relative to the centre of the note head. */
  d: string;
  /** Filled shape (a dot) instead of a line. */
  filled?: boolean;
  /** Text for the tooltip. */
  title: string;
}

/** The attributes that have a drawing. */
export const GLYPH_ATTRIBUTES = ['tilt', 'curve', 'rellen', 'con', 'angled', 'hooked', 'ligated'] as const;

const COMPASS: Record<string, [number, number]> = {
  n: [0, -1], ne: [Math.SQRT1_2, -Math.SQRT1_2], e: [1, 0], se: [Math.SQRT1_2, Math.SQRT1_2],
  s: [0, 1], sw: [-Math.SQRT1_2, Math.SQRT1_2], w: [-1, 0], nw: [-Math.SQRT1_2, -Math.SQRT1_2]
};

const r = (v: number) => Math.round(v * 100) / 100;

/** The drawing of one attribute, or null if it has none or the value is not one MEI defines. */
export function glyphFor(attr: string, value: string): AttrGlyph | null {
  const v = (value ?? '').trim();
  switch (attr) {
    case 'tilt': {
      const dir = COMPASS[v];
      if (!dir) return null;
      return { attr, d: `M${r(dir[0] * 3)} ${r(dir[1] * 3)} L${r(dir[0] * 12)} ${r(dir[1] * 12)}`, title: `tilt="${v}": direction of the pen stroke` };
    }
    case 'curve':
      if (v === 'c') return { attr, d: 'M8 -6 a7 7 0 0 1 0 12', title: 'curve="c": curved clockwise' };
      if (v === 'a') return { attr, d: 'M-8 -6 a7 7 0 0 0 0 12', title: 'curve="a": curved anticlockwise' };
      return null;
    case 'rellen':
      if (v === 'l') return { attr, d: 'M0 7 V19', title: 'rellen="l": long stroke' };
      if (v === 's') return { attr, d: 'M0 7 V12', title: 'rellen="s": short stroke' };
      return null;
    case 'con':
      if (v === 'g') return { attr, d: 'M-9 -4 V4 M-12 -4 V4', title: 'con="g": gapped connection' };
      if (v === 'l') return { attr, d: 'M-8 0 a3 3 0 1 1 -6 0 a3 3 0 1 1 6 0', title: 'con="l": looped connection' };
      if (v === 'e') return { attr, d: 'M-8 0 H-18', title: 'con="e": extended connection' };
      return null;
    case 'angled':
      return v === 'false' ? null : { attr, d: 'M-5 -8 L0 -13 L5 -8', title: 'angled: angled stroke' };
    case 'hooked':
      return v === 'false' ? null : { attr, d: 'M7 -6 q5 0 5 5', title: 'hooked: stroke with an extension' };
    case 'ligated':
      return v === 'false' ? null : { attr, d: 'M-7 9 V13 H7 V9', title: 'ligated: takes part in a ligature' };
    default:
      return null;
  }
}

/** The drawings for a set of attributes, and the names of the attributes that have none (they are marked with a dot). */
export function attributeGlyphs(attrs: Record<string, string> | undefined): { glyphs: AttrGlyph[]; withoutShape: string[] } {
  const glyphs: AttrGlyph[] = [];
  const withoutShape: string[] = [];
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === '' || value == null) continue;
    const g = glyphFor(name, value);
    if (g) glyphs.push(g);
    else withoutShape.push(name);
  }
  return { glyphs, withoutShape };
}
