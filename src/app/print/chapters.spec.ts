import { chapterize } from './chapters';

const doc = (ms: string, id: string) => ({ ms, id });
const byMs = (d: { ms: string }) => d.ms;

describe('chapterize', () => {
  it('numbers the documents of one manuscript 1, 2, 3 and counts one chapter', () => {
    const c = chapterize([doc('A', 'a1'), doc('A', 'a2'), doc('A', 'a3')], byMs);
    expect(c.count).toBe(1);
    expect(c.runningNo).toEqual([1, 2, 3]);
    expect(c.chapterFirst).toEqual([true, false, false]);
    expect(c.chapterNo).toEqual([1, 1, 1]);
  });

  it('groups interleaved manuscripts and keeps the order of first appearance', () => {
    const c = chapterize([doc('B', 'b1'), doc('A', 'a1'), doc('B', 'b2'), doc('A', 'a2'), doc('C', 'c1')], byMs);
    expect(c.items.map((d) => d.id)).toEqual(['b1', 'b2', 'a1', 'a2', 'c1']);
    expect(c.chapterNo).toEqual([1, 1, 2, 2, 3]);
    expect(c.runningNo).toEqual([1, 2, 1, 2, 1]);
    expect(c.chapterFirst).toEqual([true, false, true, false, true]);
    expect(c.count).toBe(3);
  });

  it('is stable inside a manuscript', () => {
    const c = chapterize([doc('A', '3'), doc('B', 'x'), doc('A', '1'), doc('A', '2')], byMs);
    expect(c.items.filter((d) => d.ms === 'A').map((d) => d.id)).toEqual(['3', '1', '2']);
  });

  it('handles an empty list and does not change the input', () => {
    expect(chapterize([], byMs)).toEqual({ items: [], chapterNo: [], chapterFirst: [], runningNo: [], count: 0 });
    const input = [doc('B', 'b'), doc('A', 'a'), doc('B', 'b2')];
    chapterize(input, byMs);
    expect(input.map((d) => d.id)).toEqual(['b', 'a', 'b2']);
  });
});
