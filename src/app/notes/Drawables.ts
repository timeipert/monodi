import { Comment, Spaced, NonSpaced, Grouped, Note, BaseNote, baseNotes, comparePositions } from '../types/model';
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
  getPath(): string {
    return "M" + this.x + " " + this.y + " c -2 -8, " + (this.width - 3) + " -8, " + (this.width - 5) + " 0 ";
  }
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
  return flatten(spacedWith(35, mapped));
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
    
    offset += 35 + maxWidth;
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

function fromNote(n: Note, comments: Comment[]): Drawable[] {
  let ret: Drawable[] = [];
  let xOffset = 0;

  if (comparePositions(n.octave, n.base, 4, BaseNote.C) <= 0) {
    ret.push(new DHelperLine(0, 90, n));
  }

  if (comparePositions(n.octave, n.base, 3, BaseNote.A) <= 0) {
    ret.push(new DHelperLine(0, 100, n));
  }

  if (comparePositions(n.octave, n.base, 3, BaseNote.F) <= 0) {
    ret.push(new DHelperLine(0, 110, n));
  }

  if (comparePositions(n.octave, n.base, 5, BaseNote.A) >= 0) {
    ret.push(new DHelperLine(0, 30, n));
  }

  if (comparePositions(n.octave, n.base, 6, BaseNote.C) >= 0) {
    ret.push(new DHelperLine(0, 20, n));
  }

  //ret.push(new DNote(xOffset + 5, 92 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5, n));
  if (n.liquescent) {
    ret.push(new DNote(0, 60 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5 + 10, n));
  } else {
    ret.push(new DNote(-1, 60 - ((n.octave - 4) * 35) - baseNotes.indexOf(n.base) * 5, n));
  }
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

function spacedWith(space: number, dss: Drawable[][]): Drawable[][] {
  const ret: Drawable[][] = [];

  let offset = 0;
  for (const ds of dss) {
    const width = getWidth(ds);
    ret.push(ds.map(d => d.addOffset(offset)));
    offset += space + width;
  }

  return ret;
}

function getWidth(ds: Drawable[]): number {
  let max = maxOf(ds.map(d => d.x));

  return max || 0;
}
