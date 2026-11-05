import { attributeGlyphs, glyphFor, GLYPH_ATTRIBUTES, linkedPairs, linkPath, shownByNoteHead } from './mei-attribute-glyphs';

/** The drawings of MEI neume attributes in the staff (see mei-attribute-glyphs.ts; modelled on Verovio's neume glyphs). */
describe('MEI attribute glyphs', () => {
  it('draws tilt n and s as a short stem at the right of the head, as the ascending and descending note heads', () => {
    expect(glyphFor('tilt', 'n')!.d).toBe('M4.8 -2 V-9');
    expect(glyphFor('tilt', 's')!.d).toBe('M4.8 2 V9');
  });

  it('draws tilt se as a lozenge around the head (punctum inclinatum)', () => {
    expect(glyphFor('tilt', 'se')!.d).toBe('M0 -6.5 L7.5 0 L0 6.5 L-7.5 0 Z');
  });

  it('draws the other compass points as a short tick outside the head', () => {
    expect(glyphFor('tilt', 'e')!.d).toBe('M6.5 0 L10 0');
    expect(glyphFor('tilt', 'w')!.d).toBe('M-6.5 0 L-10 0');
    expect(glyphFor('tilt', 'ne')!.d).toBe('M4.6 -4.6 L7.07 -7.07');
    const paths = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(v => glyphFor('tilt', v)!.d);
    expect(new Set(paths).size).toBe(8);
  });

  it('keeps every drawing small: no point further than 11 units from the centre of the head', () => {
    const all = [
      ...['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(v => glyphFor('tilt', v)!),
      ...['a', 'c'].map(v => glyphFor('curve', v)!), ...['l', 's'].map(v => glyphFor('rellen', v)!),
      ...['g', 'l', 'e'].map(v => glyphFor('con', v)!), ...['angled', 'hooked', 'ligated'].map(a => glyphFor(a, 'true')!)
    ];
    for (const g of all) {
      // absolute coordinates only (arcs and relative curves stay near their start)
      const nums = (g.d.match(/[MLHVC][^MLHVCZaq]*/g) ?? []).flatMap(seg => seg.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number));
      for (const v of nums) expect(Math.abs(v)).toBeLessThanOrEqual(11);
    }
  });

  it('draws curve, rellen and con per value, and nothing for a value MEI does not define', () => {
    expect(glyphFor('curve', 'c')!.d).not.toBe(glyphFor('curve', 'a')!.d);
    expect(glyphFor('rellen', 'l')!.d).not.toBe(glyphFor('rellen', 's')!.d);
    expect(new Set(['g', 'l', 'e'].map(v => glyphFor('con', v)!.d)).size).toBe(3);
    expect(glyphFor('tilt', 'up')).toBeNull();
    expect(glyphFor('curve', 'x')).toBeNull();
    expect(glyphFor('con', '')).toBeNull();
  });

  it('draws the flags angled, hooked and ligated, but not when they are false; ligated and con="e" join a neighbour', () => {
    for (const a of ['angled', 'hooked', 'ligated']) {
      expect(glyphFor(a, 'true')).not.toBeNull();
      expect(glyphFor(a, 'false')).toBeNull();
    }
    expect(glyphFor('ligated', 'true')!.link).toBe('next');
    expect(glyphFor('con', 'e')!.link).toBe('previous');
    expect(glyphFor('tilt', 'n')!.link).toBeUndefined();
  });

  it('separates the attributes that have a drawing from those that only get a dot', () => {
    const r = attributeGlyphs({ tilt: 'n', name: 'virga', lig: 'conjunctura', curve: 'c', empty: '' });
    expect(r.glyphs.map(g => g.attr)).toEqual(['tilt', 'curve']);
    expect(r.withoutShape).toEqual(['name', 'lig']);
    expect(attributeGlyphs(undefined)).toEqual({ glyphs: [], withoutShape: [] });
  });

  it('draws nothing for a tilt the note head shows already (the stem of an ascending or descending head)', () => {
    expect(shownByNoteHead('tilt', 'n', { noteType: 'Ascending' })).toBeTrue();
    expect(shownByNoteHead('tilt', 's', { noteType: 'Descending' })).toBeTrue();
    expect(shownByNoteHead('tilt', 's', { noteType: 'Ascending' })).toBeFalse();
    expect(shownByNoteHead('tilt', 'n', { noteType: 'Normal' })).toBeFalse();
    const r = attributeGlyphs({ tilt: 'n', curve: 'a' }, { noteType: 'Ascending' });
    expect(r.glyphs.map(g => g.attr)).toEqual(['curve']);
    expect(r.withoutShape).toEqual([]);
  });

  it('joins two ligated components in a row, as Verovio does, and never across neumes', () => {
    type N = { id: string; neume: number; attrs: Record<string, string> };
    const n = (id: string, neume: number, attrs: Record<string, string> = {}): N => ({ id, neume, attrs });
    const pairs = (notes: N[]) => linkedPairs(notes, x => x.attrs, x => x.neume).map(([a, b]) => a.id + b.id);
    expect(pairs([n('a', 0, { ligated: 'true' }), n('b', 0, { ligated: 'true' }), n('c', 0, { ligated: 'true' }), n('d', 0, { ligated: 'true' })])).toEqual(['ab', 'cd']);
    expect(pairs([n('a', 0, { ligated: 'true' }), n('b', 1, { ligated: 'true' })])).toEqual([]);
    expect(pairs([n('a', 0, { ligated: 'true' }), n('b', 0), n('c', 0, { ligated: 'true' })])).toEqual([]);
    expect(pairs([n('a', 0), n('b', 0, { con: 'e' }), n('c', 1, { con: 'e' })])).toEqual(['ab']);
    expect(pairs([n('a', 0, { ligated: 'false' }), n('b', 0, { ligated: 'false' })])).toEqual([]);
    expect(pairs([n('a', 0, { ligated: 'true' }), n('b', 0, { ligated: 'true', con: 'e' })])).toEqual(['ab']);
  });

  it('draws the band of a ligature from the right of the first head to the left of the second', () => {
    expect(linkPath({ x: 0, y: 0 }, { x: 14, y: 10 })).toBe('M3 -1.5 L11 8.5 L11 11.5 L3 1.5 Z');
    // heads on top of each other: the band keeps a width
    expect(linkPath({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('M3 -1.5 L4 8.5 L4 11.5 L3 1.5 Z');
  });

  it('lists the attributes that have a drawing', () => {
    expect([...GLYPH_ATTRIBUTES]).toEqual(['tilt', 'curve', 'rellen', 'con', 'angled', 'hooked', 'ligated']);
  });
});
