import { attributeGlyphs, glyphFor, GLYPH_ATTRIBUTES } from './mei-attribute-glyphs';

/** The drawings of MEI neume attributes in the staff (see mei-attribute-glyphs.ts). */
describe('MEI attribute glyphs', () => {
  it('draws tilt as a short line from the note head in the compass direction', () => {
    expect(glyphFor('tilt', 'n')!.d).toBe('M0 -3 L0 -12');
    expect(glyphFor('tilt', 'e')!.d).toBe('M3 0 L12 0');
    expect(glyphFor('tilt', 's')!.d).toBe('M0 3 L0 12');
    expect(glyphFor('tilt', 'w')!.d).toBe('M-3 0 L-12 0');
    const ne = glyphFor('tilt', 'ne')!.d;
    expect(ne).toBe('M2.12 -2.12 L8.49 -8.49');
  });

  it('draws the eight compass points differently', () => {
    const paths = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(v => glyphFor('tilt', v)!.d);
    expect(new Set(paths).size).toBe(8);
  });

  it('draws curve, rellen and con per value, and nothing for a value MEI does not define', () => {
    expect(glyphFor('curve', 'c')!.d).not.toBe(glyphFor('curve', 'a')!.d);
    expect(glyphFor('rellen', 'l')!.d).not.toBe(glyphFor('rellen', 's')!.d);
    expect(new Set(['g', 'l', 'e'].map(v => glyphFor('con', v)!.d)).size).toBe(3);
    expect(glyphFor('tilt', 'up')).toBeNull();
    expect(glyphFor('curve', 'x')).toBeNull();
    expect(glyphFor('con', '')).toBeNull();
  });

  it('draws the flags angled, hooked and ligated, but not when they are false', () => {
    for (const a of ['angled', 'hooked', 'ligated']) {
      expect(glyphFor(a, 'true')).not.toBeNull();
      expect(glyphFor(a, 'false')).toBeNull();
    }
  });

  it('separates the attributes that have a drawing from those that only get a dot', () => {
    const r = attributeGlyphs({ tilt: 'n', name: 'virga', lig: 'conjunctura', curve: 'c', empty: '' });
    expect(r.glyphs.map(g => g.attr)).toEqual(['tilt', 'curve']);
    expect(r.withoutShape).toEqual(['name', 'lig']);
    expect(attributeGlyphs(undefined)).toEqual({ glyphs: [], withoutShape: [] });
  });

  it('lists the attributes that have a drawing', () => {
    expect([...GLYPH_ATTRIBUTES]).toEqual(['tilt', 'curve', 'rellen', 'con', 'angled', 'hooked', 'ligated']);
  });
});
