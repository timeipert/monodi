/**
 * Small drawings for the MEI attributes of a note, shown in the staff on the note head. The note head of Monodi stays as it is (an oval
 * head, see notes/glyph-paths.ts); the drawings add to it what the attribute changes in the shape of the neume component.
 *
 * Model: Verovio, the engraver of MEI neumes (rism-digital/verovio, branch develop, state 2026-11-05). Verovio draws square chant
 * glyphs; it changes the glyph of an `<nc>` only for a few attributes (src/calcligatureorneumeposfunctor.cpp, VisitNeume):
 *   - `tilt="s"`  → punctum with a stem down at the right (virga, SMuFL U+E996); here: a short stroke down at the right of the head.
 *   - `tilt="n"`  → Verovio: reversed virga (U+E997). MEI defines `tilt` as the direction of the pen stroke, and Monodi's ascending note
 *                   head (a stem up at the right) is exported as `tilt="n"`; here: a short stroke up at the right of the head.
 *   - `tilt="se"` → punctum inclinatum, a lozenge (U+E991); here: a thin lozenge around the head.
 *   - `curve` (with a liquescent) → auctum descendens (`c`, U+E995) or ascendens (`a`, U+E994): a head with a tail that bends down or up;
 *                   here: a small tail at the right of the head, bending down (`c`) or up (`a`).
 *   - `ligated="true"` → two components in a row form an oblique ligature (U+E9B4 entry line and U+E9B9–E9BC); here: an oblique band
 *                   from the head to the head of the next ligated component of the same neume.
 *   - `con="e"` (Hufnagel notation) → joined to the previous component as in a ligature; here: a band from the previous head.
 * Verovio draws nothing for the other tilts, for `con="g"`/`con="l"`, `rellen`, `angled` and `hooked`; they get small marks of their own
 * so that every attribute of the shape can be seen and checked. Every other attribute (`name`, `type`, `lig`, ...) has no shape; the staff
 * then marks the note with a dot.
 *
 * An attribute the note head already shows gets no drawing: `tilt="n"` on an ascending and `tilt="s"` on a descending note head.
 *
 * Coordinates: the origin is the centre of the note head; x grows to the right, y downwards (the unit is the unit of the staff, a staff
 * space is 10 units; the head is about 11 units wide and 10 high).
 */
export interface AttrGlyph {
  /** The attribute this drawing stands for. */
  attr: string;
  /** SVG path data, relative to the centre of the note head (for a link: the part drawn when the note has no partner). */
  d: string;
  /** The drawing joins the head to a neighbour: the next ligated component, or the previous component. */
  link?: 'next' | 'previous';
  /** Text for the tooltip. */
  title: string;
}

/** What the note head itself shows (the note type of Monodi). */
export interface GlyphContext {
  noteType?: string;
}

/** The attributes that have a drawing. */
export const GLYPH_ATTRIBUTES = ['tilt', 'curve', 'rellen', 'con', 'angled', 'hooked', 'ligated'] as const;

/** The x of a stem at the right of the head (as the stem of the ascending and descending heads in glyph-paths.ts). */
const STEM_X = 4.8;

const COMPASS: Record<string, [number, number]> = {
  n: [0, -1], ne: [Math.SQRT1_2, -Math.SQRT1_2], e: [1, 0], se: [Math.SQRT1_2, Math.SQRT1_2],
  s: [0, 1], sw: [-Math.SQRT1_2, Math.SQRT1_2], w: [-1, 0], nw: [-Math.SQRT1_2, -Math.SQRT1_2]
};

const r = (v: number) => Math.round(v * 100) / 100;

/** True when the note head already shows the attribute (no drawing, no dot). */
export function shownByNoteHead(attr: string, value: string, ctx: GlyphContext = {}): boolean {
  if (attr !== 'tilt') return false;
  return (value === 'n' && ctx.noteType === 'Ascending') || (value === 's' && ctx.noteType === 'Descending');
}

/** The drawing of one attribute, or null if it has none or the value is not one MEI defines. */
export function glyphFor(attr: string, value: string): AttrGlyph | null {
  const v = (value ?? '').trim();
  switch (attr) {
    case 'tilt': {
      if (v === 'n') return { attr, d: `M${STEM_X} -2 V-9`, title: 'tilt="n": stroke upward (the stem of an ascending note head)' };
      if (v === 's') return { attr, d: `M${STEM_X} 2 V9`, title: 'tilt="s": stroke downward (virga, stem down at the right)' };
      if (v === 'se') return { attr, d: 'M0 -6.5 L7.5 0 L0 6.5 L-7.5 0 Z', title: 'tilt="se": inclined stroke (punctum inclinatum, a lozenge)' };
      const dir = COMPASS[v];
      if (!dir) return null;
      return { attr, d: `M${r(dir[0] * 6.5)} ${r(dir[1] * 6.5)} L${r(dir[0] * 10)} ${r(dir[1] * 10)}`, title: `tilt="${v}": direction of the pen stroke` };
    }
    case 'curve':
      if (v === 'c') return { attr, d: 'M5 0 C7.5 1 8.2 3.5 7.6 7', title: 'curve="c": curved clockwise (tail bending down, auctum descendens)' };
      if (v === 'a') return { attr, d: 'M5 0 C7.5 -1 8.2 -3.5 7.6 -7', title: 'curve="a": curved anticlockwise (tail bending up, auctum ascendens)' };
      return null;
    case 'rellen':
      if (v === 'l') return { attr, d: 'M-5 7.5 H5', title: 'rellen="l": longer than the previous component' };
      if (v === 's') return { attr, d: 'M-2.5 7.5 H2.5', title: 'rellen="s": shorter than the previous component' };
      return null;
    case 'con':
      if (v === 'g') return { attr, d: 'M-8 -2.5 V2.5 M-10.5 -2.5 V2.5', title: 'con="g": gap before this component' };
      if (v === 'l') return { attr, d: 'M-6 0 a2.25 2.25 0 1 1 -4.5 0 a2.25 2.25 0 1 1 4.5 0', title: 'con="l": looped connection to the previous component' };
      if (v === 'e') return { attr, d: 'M-6 0 H-11', link: 'previous', title: 'con="e": extended connection to the previous component' };
      return null;
    case 'angled':
      return v === 'false' ? null : { attr, d: 'M-3 -7.5 L0 -10.5 L3 -7.5', title: 'angled: angled stroke' };
    case 'hooked':
      return v === 'false' ? null : { attr, d: 'M5 -3 q3 0 3 3', title: 'hooked: stroke with an extension (hook)' };
    case 'ligated':
      return v === 'false' ? null : { attr, d: 'M5 1 L9 3', link: 'next', title: 'ligated: oblique ligature with the next component' };
    default:
      return null;
  }
}

/**
 * The drawings for a set of attributes, and the names of the attributes that have none (they are marked with a dot). An attribute the
 * note head shows already (see shownByNoteHead) is in neither list.
 */
export function attributeGlyphs(attrs: Record<string, string> | undefined, ctx: GlyphContext = {}): { glyphs: AttrGlyph[]; withoutShape: string[] } {
  const glyphs: AttrGlyph[] = [];
  const withoutShape: string[] = [];
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === '' || value == null) continue;
    if (shownByNoteHead(name, value, ctx)) continue;
    const g = glyphFor(name, value);
    if (g) glyphs.push(g);
    else withoutShape.push(name);
  }
  return { glyphs, withoutShape };
}

/** A centre of a note head in the staff. */
export interface HeadPoint { x: number; y: number }

/**
 * The oblique band of a ligature or an extended connection between two note heads (centres `a` and `b`), as SVG path data in staff
 * units: a parallelogram 3 units thick from the right side of the first head to the left side of the second, like the oblique stroke of
 * a square-notation ligature.
 */
export function linkPath(a: HeadPoint, b: HeadPoint): string {
  const x1 = a.x + 3, x2 = Math.max(b.x - 3, x1 + 1);
  const h = 1.5;
  return `M${r(x1)} ${r(a.y - h)} L${r(x2)} ${r(b.y - h)} L${r(x2)} ${r(b.y + h)} L${r(x1)} ${r(a.y + h)} Z`;
}

/**
 * The pairs of note heads joined by a band, for the notes of one voice of a syllable in their order. `neumeOf` gives the neume of a note
 * (a band never leaves its neume). As in Verovio, two ligated components in a row form one ligature (the first and the second, the third
 * and the fourth, ...); a component with `con="e"` is joined to the component before it.
 */
export function linkedPairs<T>(notes: T[], attrsOf: (n: T) => Record<string, string>, neumeOf: (n: T) => number): [T, T][] {
  const pairs: [T, T][] = [];
  let open: T | null = null;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const prev = i > 0 ? notes[i - 1] : null;
    const a = attrsOf(n);
    if (prev && neumeOf(prev) !== neumeOf(n)) open = null;
    if (a['con'] === 'e' && prev && neumeOf(prev) === neumeOf(n)) pairs.push([prev, n]);
    const ligated = a['ligated'] !== undefined && a['ligated'] !== '' && a['ligated'] !== 'false';
    if (!ligated) { open = null; continue; }
    if (open === null) open = n;
    else {
      // a pair joined by con="e" and by a ligature at once is drawn once
      const last = pairs[pairs.length - 1];
      if (!(last && last[0] === open && last[1] === n)) pairs.push([open, n]);
      open = null;
    }
  }
  return pairs;
}
