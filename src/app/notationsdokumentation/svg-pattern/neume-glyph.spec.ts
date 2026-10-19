import { glyphOf, layoutPattern, tokenizePattern } from './neume-glyph';

describe('neume glyph layout', () => {
  it('reads the notes of a pattern with their signs and groups', () => {
    const t = tokenizePattern('[*u]dd');
    expect(t.map(x => x.type)).toEqual(['*', 'u', 'd', 'd']);
    expect(t.map(x => x.group)).toEqual([true, true, false, false]);
    expect(tokenizePattern('*SeS').map(x => x.special)).toEqual(['S', 'S']);   // two notes, both strophic
    expect(tokenizePattern('[*dL]').map(x => x.special)).toEqual(['', 'L']);
    expect(tokenizePattern('[*Qu]').map(x => x.special)).toEqual(['Q', '']);
  });

  it('gives a pattern that starts with a step an implicit first note', () => {
    expect(tokenizePattern('ud').map(x => x.type)).toEqual(['start', 'u', 'd']);
    expect(tokenizePattern('')).toEqual([]);
  });

  it('puts higher notes higher (smaller y) and one bracket over each connected group', () => {
    const lay = layoutPattern(tokenizePattern('[*u]dd'), 10, 8);
    expect(lay.points.map(p => p.y)).toEqual([0, -8, 0, 8]);
    expect(lay.minY).toBe(-1);
    expect(lay.maxY).toBe(1);
    expect(lay.brackets.length).toBe(1);
    expect(lay.brackets[0].startX).toBe(10);
    expect(lay.brackets[0].endX).toBe(20);
    expect(layoutPattern(tokenizePattern('[*d][ud]'), 10, 8).brackets.length).toBe(2);
    expect(layoutPattern(tokenizePattern('*dd'), 10, 8).brackets.length).toBe(0);
  });

  it('chooses the shape of a note from its sign', () => {
    expect(glyphOf('O').glyph.viewBox).not.toBe(glyphOf('').glyph.viewBox);
    expect(glyphOf('').scale).toBe(0.85);
    expect(glyphOf('L').scale).toBeLessThan(glyphOf('').scale);       // a liquescent is drawn smaller
    expect(glyphOf('LA').glyph.viewBox).not.toBe(glyphOf('').glyph.viewBox);
    expect(glyphOf('Q').glyph.viewBox).not.toBe(glyphOf('').glyph.viewBox);
    expect(glyphOf('S').glyph.viewBox).not.toBe(glyphOf('Q').glyph.viewBox);
  });
});
