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
    expect(chapterize([], byMs)).toEqual({ items: [], chapterNo: [], chapterFirst: [], runningNo: [], labels: [], sections: [], see: [], keys: [], count: 0 });
    const input = [doc('B', 'b'), doc('A', 'a'), doc('B', 'b2')];
    chapterize(input, byMs);
    expect(input.map((d) => d.id)).toEqual(['b', 'a', 'b2']);
  });

  it('labels the items by their running number, or by what the arrangement of a chapter says', () => {
    expect(chapterize([doc('A', 'a1'), doc('A', 'a2')], byMs).labels).toEqual(['1', '2']);
    // the arrangement sees one chapter at a time, in the order of the input, and decides order and labels
    const seen: string[][] = [];
    const c = chapterize([doc('A', 'a1'), doc('B', 'b1'), doc('A', 'a2')], byMs, (items) => {
      seen.push(items.map((d) => d.id));
      return { items: [...items].reverse(), labels: items.map((_, i) => `${i + 1}x`) };
    });
    expect(seen).toEqual([['a1', 'a2'], ['b1']]);
    expect(c.items.map((d) => d.id)).toEqual(['a2', 'a1', 'b1']);
    expect(c.labels).toEqual(['1x', '2x', '1x']);
    expect(c.runningNo).toEqual([1, 2, 1]);
    expect(c.chapterFirst).toEqual([true, false, true]);
  });

  it('carries the sections and notes of an arrangement and the key of every chapter', () => {
    const c = chapterize([doc('A', 'a1'), doc('B', 'b1'), doc('A', 'a2')], byMs, (items) => ({
      items, labels: items.map((_, i) => String(i + 1)), sections: items.map((_, i) => (i === 1 ? 'Section' : null)), see: items.map((_, i) => (i === 0 ? [{ label: '2P', to: '1P' }] : [])),
    }));
    expect(c.sections).toEqual([null, 'Section', null]);
    expect(c.see).toEqual([[{ label: '2P', to: '1P' }], [], [{ label: '2P', to: '1P' }]]);
    expect(c.keys).toEqual(['A', 'A', 'B']);
    const plain = chapterize([doc('A', 'a1')], byMs);
    expect(plain.sections).toEqual([null]);
    expect(plain.see).toEqual([[]]);
  });
});
