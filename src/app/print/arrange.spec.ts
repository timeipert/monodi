import type { Document } from '../api.service';
import { UNIT_CHAPTER, arrangeChapter, chapterKeyFn } from './arrange';

interface D { id: string; to?: string; type?: string; unit?: string; pos?: string }
const item = (d: D) => d;
const doc = (d: D): Document => ({
  dokumenten_id: d.id,
  custom: { ...(d.to ? { relation_target: d.to } : {}), ...(d.type ? { relation_type: d.type } : {}), ...(d.unit ? { unit_id: d.unit } : {}), ...(d.pos ? { unit_position: d.pos } : {}) },
} as unknown as Document);
type Types = { relationTypes?: { name: string; suffix: string; heading?: string }[] };
const run = (items: D[], settings?: Types, at: 'block' | 'behind' = 'behind') => {
  const r = arrangeChapter(items.map(item), doc, settings, at);
  return r.items.map((d, i) => `${d.id}=${r.labels[i]}`).join(' ');
};

describe('arrange: numbers and order of one chapter, related documents directly behind', () => {
  it('leaves documents without relations and units where they are, numbered 1, 2, 3', () => {
    expect(run([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe('a=1 b=2 c=3');
    expect(arrangeChapter([], doc, undefined, 'behind').items).toEqual([]);
  });

  it('puts the antiphon directly behind its trope and numbers it 1P', () => {
    expect(run([{ id: 'T1', to: 'AN1' }, { id: 'X' }, { id: 'AN1' }])).toBe('T1=1 AN1=1P X=2');
    expect(run([{ id: 'AN1' }, { id: 'X' }, { id: 'T1', to: 'AN1' }])).toBe('X=1 T1=2 AN1=2P');
  });

  it('lets two trope complexes name the same antiphon: it stands once, behind the first', () => {
    expect(run([{ id: 'T1', to: 'AN1' }, { id: 'T2', to: 'AN1' }, { id: 'AN1' }])).toBe('T1=1 AN1=1P T2=2');
  });

  it('takes the suffix of the relation type, the first type when the document names none or an unknown one', () => {
    const settings = { relationTypes: [{ name: 'Primary chant', suffix: 'P' }, { name: 'Verse', suffix: 'V' }] };
    expect(run([{ id: 'T', to: 'A', type: 'verse' }, { id: 'A' }], settings)).toBe('T=1 A=1V');
    expect(run([{ id: 'T', to: 'A' }, { id: 'A' }], settings)).toBe('T=1 A=1P');
    expect(run([{ id: 'T', to: 'A', type: 'Gone' }, { id: 'A' }], settings)).toBe('T=1 A=1P');
    expect(run([{ id: 'T', to: 'A' }, { id: 'A' }], { relationTypes: [{ name: 'Verse', suffix: ' ' }] })).toBe('T=1 A=1V');
  });

  it('follows a chain, and moves a document together with what stands behind it', () => {
    expect(run([{ id: 'A', to: 'B' }, { id: 'X' }, { id: 'B', to: 'C' }, { id: 'C' }])).toBe('A=1 B=1P C=1PP X=2');
    expect(run([{ id: 'B', to: 'D' }, { id: 'X' }, { id: 'D' }, { id: 'A', to: 'B' }])).toBe('X=1 A=2 B=2P D=2PP');
  });

  it('survives a circle and a document that names itself', () => {
    expect(run([{ id: 'A', to: 'B' }, { id: 'B', to: 'A' }])).toBe('A=1 B=1P');
    expect(run([{ id: 'A', to: 'A' }, { id: 'B' }])).toBe('A=1 B=2');
  });

  it('leaves a relation alone whose target is missing or ambiguous', () => {
    expect(run([{ id: 'T', to: 'nope' }, { id: 'X' }])).toBe('T=1 X=2');
    expect(run([{ id: 'T', to: 'A' }, { id: 'A' }, { id: 'A' }])).toBe('T=1 A=2 A=3');
  });

  it('sets a unit as one block at the place of its first document, in the order of its positions', () => {
    expect(run([{ id: 'A' }, { id: 'P2', unit: 'u', pos: '2' }, { id: 'B' }, { id: 'P1', unit: 'u', pos: '1' }, { id: 'P3', unit: 'u' }]))
      .toBe('A=1 P1=2 P2=3 P3=4 B=5');
  });

  it('keeps the order of a unit without positions, and reads a decimal comma', () => {
    expect(run([{ id: 'P2', unit: 'u' }, { id: 'P1', unit: 'u' }])).toBe('P2=1 P1=2');
    expect(run([{ id: 'b', unit: 'u', pos: '1,5' }, { id: 'a', unit: 'u', pos: '1' }])).toBe('a=1 b=2');
  });

  it('puts the antiphon of a trope behind it inside a play, but does not break another play to fetch it', () => {
    expect(run([{ id: 'T', to: 'A', unit: 'u', pos: '1' }, { id: 'M', unit: 'u', pos: '2' }, { id: 'A' }])).toBe('T=1 A=1P M=2');
    expect(run([{ id: 'T', to: 'A', unit: 'u' }, { id: 'A', unit: 'v' }, { id: 'B', unit: 'v' }])).toBe('T=1 A=2 B=3');
  });

  it('loses nothing and numbers every document once', () => {
    const items: D[] = Array.from({ length: 40 }, (_, i) => ({ id: 'd' + i, ...(i % 4 === 0 ? { to: 'd' + ((i + 7) % 40) } : {}), ...(i % 5 === 0 ? { unit: 'u' + (i % 3), pos: String(40 - i) } : {}) }));
    const r = arrangeChapter(items, doc, undefined, 'behind');
    expect(r.items.map((d) => d.id).sort()).toEqual(items.map((d) => d.id).sort());
    expect(new Set(r.labels).size).toBe(40);
  });
});

const full = (items: D[], settings?: Types, at: 'block' | 'behind' = 'block') => arrangeChapter(items, doc, settings, at);
const shown = (r: ReturnType<typeof full>) => r.items.map((d, i) => `${d.id}=${r.labels[i]}`).join(' ');

describe('arrange: related documents in a section of their own, as in the printed volume', () => {
  it('sets the tropes first and the primary chants behind them under the heading, numbered like their trope', () => {
    const r = full([{ id: 'T1', to: 'A1' }, { id: 'X' }, { id: 'T2', to: 'A2' }, { id: 'A1' }, { id: 'A2' }]);
    expect(shown(r)).toBe('T1=1 X=2 T2=3 A1=1P A2=3P');
    expect(r.sections).toEqual([null, null, null, 'Primary chants', null]);
  });

  it('names no section when nothing is related', () => {
    const r = full([{ id: 'a' }, { id: 'b' }]);
    expect(r.sections).toEqual([null, null]);
    expect(r.see).toEqual([[], []]);
  });

  it('points from the second trope to the primary chant that stands once: "2P siehe 1P"', () => {
    const r = full([{ id: 'T1', to: 'A' }, { id: 'T2', to: 'A' }, { id: 'A' }, { id: 'X' }]);
    expect(shown(r)).toBe('T1=1 T2=2 X=3 A=1P');
    expect(r.see[3]).toEqual([{ label: '2P', to: '1P' }]);
    expect(r.see.slice(0, 3)).toEqual([[], [], []]);
  });

  it('puts the line "siehe" at the turn of the second trope between the primary chants', () => {
    const r = full([{ id: 'T1', to: 'A1' }, { id: 'T2', to: 'A1' }, { id: 'T3', to: 'A3' }, { id: 'A1' }, { id: 'A3' }]);
    expect(shown(r)).toBe('T1=1 T2=2 T3=3 A1=1P A3=3P');
    expect(r.see[3]).toEqual([{ label: '2P', to: '1P' }]);   // after 1P, before 3P
  });

  it('keeps the primary chant behind its trope when asked to, and still points from the second trope', () => {
    const r = full([{ id: 'T1', to: 'A' }, { id: 'T2', to: 'A' }, { id: 'A' }], undefined, 'behind');
    expect(shown(r)).toBe('T1=1 A=1P T2=2');
    expect(r.sections).toEqual([null, null, null]);
    expect(r.see[2]).toEqual([{ label: '2P', to: '1P' }]);
  });

  it('keeps a play whole: what belongs to a document of the play stands behind it, not in the section', () => {
    const r = full([{ id: 'T', to: 'A', unit: 'u', pos: '1' }, { id: 'A', unit: 'u', pos: '2' }, { id: 'M', unit: 'u', pos: '3' }, { id: 'X' }]);
    expect(shown(r)).toBe('T=1 A=1P M=2 X=3');
    expect(r.sections).toEqual([null, null, null, null]);
  });

  it('begins a new section when the heading of the relation type changes', () => {
    const settings = { relationTypes: [{ name: 'Primary chant', suffix: 'P', heading: 'Primary chants' }, { name: 'Verse', suffix: 'V', heading: 'Verses' }] };
    const r = full([{ id: 'T1', to: 'A1' }, { id: 'T2', to: 'V2', type: 'Verse' }, { id: 'A1' }, { id: 'V2' }], settings);
    expect(shown(r)).toBe('T1=1 T2=2 A1=1P V2=2V');
    expect(r.sections).toEqual([null, null, 'Primary chants', 'Verses']);
  });

  it('uses the name of the type when it has no heading', () => {
    expect(full([{ id: 'T', to: 'A' }, { id: 'A' }], { relationTypes: [{ name: 'Verse', suffix: 'V' }] }).sections).toEqual([null, 'Verse']);
  });
});

describe('arrange: chapters of a print', () => {
  const key = (items: D[]) => { const f = chapterKeyFn(items, doc, () => 'ms'); return items.map(f); };

  it('makes every unit a chapter of its own and leaves the rest to their manuscript', () => {
    expect(key([{ id: 'a' }, { id: 'p1', unit: 'play-1' }, { id: 'p2', unit: 'play-2' }, { id: 'p3', unit: 'play-1' }]))
      .toEqual(['ms', UNIT_CHAPTER + 'play-1', UNIT_CHAPTER + 'play-2', UNIT_CHAPTER + 'play-1']);
  });

  it('takes the related document of a document of the unit into the chapter of the play', () => {
    expect(key([{ id: 'T', to: 'A', unit: 'play-1' }, { id: 'A' }, { id: 'B' }])).toEqual([UNIT_CHAPTER + 'play-1', UNIT_CHAPTER + 'play-1', 'ms']);
  });
});
