import { Comment, Spaced, NonSpaced, Grouped, Note, NoteType, baseNotes } from '../types/model';
import { flatten, maxOf } from '../../utils';

export type Drawable = DNote | DTie | DCommentEnd | DCommentStart | DHelperLine
export type Ref = Note | Grouped

export class DNote {
  constructor(public x: number, public y: number, public ref: Note) { }

  addOffset(x: number): DNote { return new DNote(this.x + x, this.y, this.ref); }
}

export class DTie {
  constructor(public x: number, public y: number, public ref: Grouped, public width: number) { }

  addOffset(x: number): DTie { return new DTie(this.x + x, this.y, this.ref, this.width); }
  /** Right edge of the bracket (same coordinate space as `x`). */
  get right(): number { return this.x + Math.max(this.width - 5, 2 * DTie.R + 2); }

  /**
   * Neume bracket as in the printed edition: a flat horizontal stroke with short
   * legs at both ends and rounded corners (not an arc).
   */
  getPath(): string {
    const r = DTie.R, leg = DTie.LEG;
    const span = Math.max(this.width - 5, 2 * r + 2);
    return `M${this.x} ${this.y} v ${-(leg - r)} q 0 ${-r} ${r} ${-r} h ${span - 2 * r} q ${r} 0 ${r} ${r} v ${leg - r}`;
  }
  static readonly R = 3;
  static readonly LEG = 6;
}

export class DCommentStart {
  constructor(public x: number, public y: number, public ref: Note, public text: String) { }
  addOffset(x: number): DCommentStart { return new DCommentStart(this.x + x, this.y, this.ref, this.text); }
}

export class DCommentEnd {
  constructor(public x: number, public y: number, public ref: Note, public text: String) { }
  addOffset(x: number): DCommentEnd { return new DCommentEnd(this.x + x, this.y, this.ref, this.text); }
}

export class DHelperLine {
  constructor(public x: number, public y: number, public ref: Note) { }
  addOffset(x: number): DHelperLine { return new DHelperLine(this.x + x, this.y, this.ref); }
}

export function fromSpaced(sd: Spaced, comments: Comment[]): Drawable[] {
  const mapped = sd.spaced.map(x => fromNonSpaced(x, comments));
  return flatten(spacedWith(NEUME_SPACE, mapped));
}

export function fromSpaceds(sds: Spaced[], comments: Comment[]): Drawable[][] {
  const maxNeumes = maxOf(sds.map(s => s.spaced.length)) || 0;
  const mapped: Drawable[][][] = sds.map(s => s.spaced.map(x => fromNonSpaced(x, comments)));
  const aligned: Drawable[][][] = sds.map(() => []);

  let offset = 0;
  for (let i = 0; i < maxNeumes; i++) {
    let maxWidth = 0;
    
    for (let m = 0; m < sds.length; m++) {
      if (mapped[m][i]) {
        maxWidth = Math.max(maxWidth, getWidth(mapped[m][i]));
      }
    }
    
    for (let m = 0; m < sds.length; m++) {
      if (mapped[m][i]) {
        aligned[m].push(mapped[m][i].map(d => d.addOffset(offset)));
      }
    }
    
    const present = sds.map((_, m) => mapped[m][i]).filter(Boolean);
    offset += (present.length > 0 && present.every(isAccidentalOnly) ? ACCIDENTAL_SPACE : NEUME_SPACE) + maxWidth;
  }
  
  return aligned.map(a => flatten(a));
}

// --- Adiastematic (contour-only) layout ---------------------------------
// No staff, no clef, no interval scaling: only the *direction* between
// consecutive notes of a neume matters (Parsons-style patterns). Each note
// steps a fixed amount up/down/level from the previous one; every neume
// restarts at the baseline because the pitch relation between neumes is
// unknown ("unclear"). Neumes are separated by plain whitespace.
const ADIA_BASE_Y = 30;   // baseline (first note of every neume)
const ADIA_STEP = 8;      // uniform vertical step per direction
const ADIA_MIN_Y = 6;
const ADIA_MAX_Y = 58;
const ADIA_NOTE_DX = 13;  // uniform horizontal gap between heads within a neume
const ADIA_NEUME_GAP = 26; // whitespace gap between neumes

function diatonic(n: Note): number {
  return n.octave * 7 + baseNotes.indexOf(n.base);
}

export function adiastematicFromSpaceds(sds: Spaced[], comments: Comment[]): Drawable[][] {
  return sds.map(sd => {
    const out: Drawable[] = [];
    let x = 0;
    for (const ns of sd.spaced) {           // each neume
      let y = ADIA_BASE_Y;
      let prev: Note | undefined;
      for (const g of ns.nonSpaced) {       // each group (slurred run)
        const groupNotes: DNote[] = [];
        for (const n of g.grouped) {
          if (prev) {
            const d = diatonic(n) - diatonic(prev);
            if (d > 0) y -= ADIA_STEP;
            else if (d < 0) y += ADIA_STEP;
            // level (d === 0): keep y
          } else {
            y = ADIA_BASE_Y;                // neume start (unclear relation)
          }
          y = Math.max(ADIA_MIN_Y, Math.min(ADIA_MAX_Y, y));
          // A liquescent renders in a shorter (40px vs 60px) glyph box, whose
          // head sits ~10px higher — offset the draw y so it lands on the same
          // contour step as a normal note (mirrors the diastematic layout).
          const drawY = n.liquescent ? y + 10 : y;
          const dn = new DNote(x, drawY, n);
          out.push(dn);
          groupNotes.push(dn);
          const sc = comments.find(c => c.startUUID === n.uuid);
          const ec = comments.find(c => c.endUUID === n.uuid);
          if (sc) out.push(new DCommentStart(x - 4, drawY - 7, n, sc.text));
          if (ec) out.push(new DCommentEnd(x + 11, drawY - 7, n, ec.text));
          prev = n;
          x += ADIA_NOTE_DX;
        }
        // Slur connecting a multi-note group.
        if (groupNotes.length > 1) {
          const minY = Math.min(...groupNotes.map(d => d.y));
          const firstX = groupNotes[0].x;
          const lastX = groupNotes[groupNotes.length - 1].x;
          out.push(new DTie(firstX + 2, minY + 20, g, (lastX - firstX) + 12));
        }
        // No extra gap between groups: slurred and unslurred notes within a
        // neume are spaced identically — only the slur line differs.
      }
      x += ADIA_NEUME_GAP;                  // whitespace between neumes
    }
    return out;
  });
}

function fromNonSpaced(ns: NonSpaced, comments: Comment[]): Drawable[] {
  const mapped = ns.nonSpaced.map(x => fromGrouped(x, comments));
  return flatten(spacedWith(17, mapped));
}

function fromGrouped(g: Grouped, comments: Comment[]): Drawable[] {
  const mapped = g.grouped.map(x => fromNote(x, comments));
  const notes: Drawable[] = flatten(spacedWith(16, mapped));
  if (g.grouped.length > 1) {
    notes.push(new DTie(
      2,
      -(maxOf(notes.map(n => -n.y - 20)) || 0),
      g,
      getWidth(notes) + 12
    ));
  }
  return notes;
}

/** Vertical position of a note's glyph box (staff lines are at y = 40..80, 5 units per step). */
export function noteY(n: Note): number {
  return 60 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 + (n.liquescent ? 10 : 0);
}

/** Top padding (units) the read-only SVG needs so that a note at `minNoteY`, with its
 *  neume bracket, is not cut off. The visible area starts at y = 20 - padTop. */
export function requiredPadTop(minNoteY: number): number {
  return Math.max(0, Math.ceil(8 - minNoteY));
}

/** Bottom padding (units) a read-only SVG needs so that a note whose glyph ends at `maxNoteBottom`
 *  (and its ledger lines) is not cut off; the SVG's own area ends at y = 85. */
export function requiredPadBottom(maxNoteBottom: number): number {
  return Math.max(0, Math.ceil(maxNoteBottom + 2 - 85));
}

/** Lowest glyph bottom (largest y) of a voice, or -Infinity without notes. */
export function maxNoteBottomOf(sd: Spaced | undefined): number {
  let m = -Infinity;
  for (const ns of sd?.spaced || []) for (const g of ns.nonSpaced) for (const n of g.grouped) m = Math.max(m, noteY(n) + (n.noteType === NoteType.Descending ? 43 : 36));
  return m;
}

/** Highest (smallest-y) note of a voice, or +Infinity without notes. */
export function minNoteYOf(sd: Spaced | undefined): number {
  let m = Infinity;
  for (const ns of sd?.spaced || []) for (const g of ns.nonSpaced) for (const n of g.grouped) m = Math.min(m, noteY(n));
  return m;
}

function fromNote(n: Note, comments: Comment[]): Drawable[] {
  let ret: Drawable[] = [];
  let xOffset = 0;

  // Ledger lines every third step outside the staff: C4, A3, F3, D3, ... below (y = 90, 100, ...)
  // and A5, C6, E6, ... above (y = 30, 20, ...), however far the note lies from the staff.
  const step = (n.octave - 4) * 7 + baseNotes.indexOf(n.base); // C4 = 0
  if (Number.isFinite(step)) {
    for (let k = 0; step <= -2 * k && k < 40; k++) ret.push(new DHelperLine(0, 90 + 10 * k, n));
    for (let k = 0; step >= 12 + 2 * k && k < 40; k++) ret.push(new DHelperLine(0, 30 - 10 * k, n));
  }

  //ret.push(new DNote(xOffset + 5, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5, n));
  ret.push(new DNote(n.liquescent ? 0 : -1, noteY(n), n));
  const startComment = comments.find(c => c.startUUID === n.uuid);
  const endComment = comments.find(c => c.endUUID === n.uuid);

  if (startComment) {
    ret.push(new DCommentStart(xOffset - 5, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 - 7, n, startComment.text));
  }
  if (endComment) {
    ret.push(new DCommentEnd(xOffset + 11, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 - 7, n, endComment.text));
  }
  return ret;
}

/** Gap after a neume that is only an accidental (flat, natural, sharp): in the printed
 *  edition it stands close before the note it applies to. */
const NEUME_SPACE = 35;
const ACCIDENTAL_SPACE = 15;
const ACCIDENTALS: NoteType[] = [NoteType.Flat, NoteType.Natural, NoteType.Sharp];

function isAccidentalOnly(ds: Drawable[]): boolean {
  const notes = ds.filter((d): d is DNote => d instanceof DNote);
  return notes.length > 0 && notes.every(n => ACCIDENTALS.includes(n.ref.noteType));
}

function spacedWith(space: number, dss: Drawable[][]): Drawable[][] {
  const ret: Drawable[][] = [];

  let offset = 0;
  for (const ds of dss) {
    const width = getWidth(ds);
    ret.push(ds.map(d => d.addOffset(offset)));
    offset += (space === NEUME_SPACE && isAccidentalOnly(ds) ? ACCIDENTAL_SPACE : space) + width;
  }

  return ret;
}

function getWidth(ds: Drawable[]): number {
  let max = maxOf(ds.map(d => d.x));

  return max || 0;
}
