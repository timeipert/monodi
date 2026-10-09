import { adiastematicFromSpaceds, DHelperLine, DNote, DTie, fromSpaced, fromSpaceds } from './Drawables';
import { BaseNote, Note, NoteType, Spaced } from '../types/model';

let uid = 0;
const note = (base: BaseNote, octave: number, liquescent = false): Note => ({
  uuid: 'n' + uid++, base, octave, liquescent, noteType: NoteType.Normal, focus: false,
});
/** spaced = neumes; each neume = groups; each group = notes */
const sp = (...neumes: Note[][][]): Spaced => ({
  spaced: neumes.map(groups => ({ nonSpaced: groups.map(g => ({ grouped: g })) })),
});

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const notesOf = (ds: any[]) => ds.filter(d => d instanceof DNote) as DNote[];
const helpers = (ds: any[]) => ds.filter(d => d instanceof DHelperLine) as DHelperLine[];

describe('Drawables.fromSpaced', () => {
  it('returns nothing for an empty syllable', () => {
    expect(fromSpaced({ spaced: [] }, [])).toEqual([]);
  });

  it('places one note per diatonic step 5 units apart, 35 per octave', () => {
    const [c4, d4, c5] = notesOf(fromSpaced(sp([[note(BaseNote.C, 4)]], [[note(BaseNote.D, 4)]], [[note(BaseNote.C, 5)]]), []));
    expect(c4.y - d4.y).toBe(5);
    expect(c4.y - c5.y).toBe(35);
  });

  // Normal notes sit at x = -1, so the effective gap is the nominal 35/17/16 minus 1.
  it('spaces neumes by 35 units, groups by 17 and notes in a group by 16 (each minus the -1 note offset)', () => {
    const neumes = notesOf(fromSpaced(sp([[note(BaseNote.E, 4)]], [[note(BaseNote.E, 4)]]), []));
    expect(neumes[1].x - neumes[0].x).toBeGreaterThanOrEqual(34);
    const group = notesOf(fromSpaced(sp([[note(BaseNote.E, 4), note(BaseNote.F, 4)]]), []));
    expect(group[1].x - group[0].x).toBeGreaterThanOrEqual(15);
    const groups = notesOf(fromSpaced(sp([[note(BaseNote.E, 4)], [note(BaseNote.F, 4)]]), []));
    expect(groups[1].x - groups[0].x).toBeGreaterThanOrEqual(16);
  });

  it('adds a slur for multi-note groups only', () => {
    expect(fromSpaced(sp([[note(BaseNote.E, 4)]]), []).some(d => d instanceof DTie)).toBeFalse();
    const ties = fromSpaced(sp([[note(BaseNote.E, 4), note(BaseNote.G, 4)]]), []).filter(d => d instanceof DTie) as DTie[];
    expect(ties.length).toBe(1);
    expect(ties[0].width).toBeGreaterThan(0);
  });

  it('adds ledger lines below C4 / A3 / F3 and above A5 / C6', () => {
    const lines = (b: BaseNote, o: number) => helpers(fromSpaced(sp([[note(b, o)]]), [])).map(h => h.y).sort((a, b2) => a - b2);
    expect(lines(BaseNote.E, 4)).toEqual([]);
    expect(lines(BaseNote.C, 4)).toEqual([90]);
    expect(lines(BaseNote.A, 3)).toEqual([90, 100]);
    expect(lines(BaseNote.F, 3)).toEqual([90, 100, 110]);
    expect(lines(BaseNote.A, 5)).toEqual([30]);
    expect(lines(BaseNote.C, 6)).toEqual([20, 30]);
  });

  it('keeps liquescent notes on the same step (shifted +10 to match the shorter glyph)', () => {
    const n = notesOf(fromSpaced(sp([[note(BaseNote.G, 4, false)]], [[note(BaseNote.G, 4, true)]]), []));
    expect(n[1].y - n[0].y).toBe(10);
  });

  it('survives extreme input: 300 notes, octaves -3..+9', () => {
    const rand = rng(7);
    const bases = Object.values(BaseNote) as BaseNote[];
    const neumes: Note[][][] = [];
    for (let i = 0; i < 60; i++) {
      neumes.push([Array.from({ length: 5 }, () => note(bases[Math.floor(rand() * bases.length)], Math.floor(rand() * 13) - 3))]);
    }
    const ds = fromSpaced(sp(...neumes), []);
    expect(notesOf(ds).length).toBe(300);
    for (const d of ds) { expect(Number.isFinite(d.x)).toBeTrue(); expect(Number.isFinite(d.y)).toBeTrue(); }
  });

  it('fuzz: x is non-decreasing across neume boundaries', () => {
    const rand = rng(99);
    const bases = Object.values(BaseNote) as BaseNote[];
    for (let run = 0; run < 100; run++) {
      const neumes: Note[][][] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 8); i++) {
        const groups: Note[][] = [];
        for (let g = 0; g < 1 + Math.floor(rand() * 3); g++) {
          groups.push(Array.from({ length: 1 + Math.floor(rand() * 4) }, () => note(bases[Math.floor(rand() * bases.length)], 2 + Math.floor(rand() * 5))));
        }
        neumes.push(groups);
      }
      const n = notesOf(fromSpaced(sp(...neumes), []));
      for (let k = 1; k < n.length; k++) expect(n[k].x).toBeGreaterThanOrEqual(n[k - 1].x);
    }
  });
});

describe('DTie bracket', () => {
  it('is a flat bracket: short legs, horizontal stroke, rounded corners (no curve apex)', () => {
    const t = new DTie(10, 40, { grouped: [] }, 45);
    const d = t.getPath();
    expect(d).toMatch(/^M10 40 v -3 q 0 -3 3 -3 h \d+ q 3 0 3 3 v 3$/);
    // the horizontal stroke is as long as the (width - 5) span minus both corner radii
    expect(d).toContain(`h ${45 - 5 - 6}`);
    expect(t.right).toBe(10 + 40);
  });

  it('never collapses for tiny widths', () => {
    const t = new DTie(0, 0, { grouped: [] }, 1);
    expect(t.getPath()).toMatch(/h \d+/);
    expect(t.right).toBeGreaterThan(0);
  });
});

describe('Drawables.fromSpaceds (two voices)', () => {
  it('aligns neume i of both voices at the same x', () => {
    const v1 = sp([[note(BaseNote.C, 4), note(BaseNote.D, 4), note(BaseNote.E, 4)]], [[note(BaseNote.F, 4)]]);
    const v2 = sp([[note(BaseNote.C, 4)]], [[note(BaseNote.F, 4)]]);
    const [a, b] = fromSpaceds([v1, v2], []);
    const na = notesOf(a), nb = notesOf(b);
    expect(nb[1].x).toBe(na[3].x);
  });

  it('handles voices with different neume counts', () => {
    const [a, b] = fromSpaceds([sp([[note(BaseNote.C, 4)]], [[note(BaseNote.D, 4)]]), { spaced: [] }], []);
    expect(notesOf(a).length).toBe(2);
    expect(b.length).toBe(0);
  });
});

describe('Drawables.adiastematicFromSpaceds', () => {
  it('draws only direction steps and clamps to the staff box', () => {
    const ascending = Array.from({ length: 30 }, (_, i) => note(BaseNote.C, 2 + Math.floor(i / 7)));
    const [ds] = adiastematicFromSpaceds([sp([ascending])], []);
    for (const d of notesOf(ds)) { expect(d.y).toBeGreaterThanOrEqual(6); expect(d.y).toBeLessThanOrEqual(58); }
  });

  it('restarts each neume at the baseline', () => {
    const [ds] = adiastematicFromSpaceds([sp([[note(BaseNote.C, 4), note(BaseNote.G, 4)]], [[note(BaseNote.A, 2)]])], []);
    const n = notesOf(ds);
    expect(n[2].y).toBe(30);
    expect(n[1].y).toBeLessThan(n[0].y);
  });
});
