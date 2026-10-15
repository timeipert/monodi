import { groupItems, safeFileName, volumeFileNames } from './groups';

const key = (s: string) => ({ key: s, label: s });

describe('volume groups', () => {
  it('groups by key, keeps the input order inside a group and sorts the groups naturally', () => {
    const g = groupItems(['b2', 'a10', 'a2', 'b1'], (s) => key(s[0]));
    expect(g.map((x) => x.key)).toEqual(['a', 'b']);
    expect(g[0].items).toEqual(['a10', 'a2']);
    const n = groupItems(['Ms 10', 'Ms 9', 'Ms 2'], (s) => key(s));
    expect(n.map((x) => x.key)).toEqual(['Ms 2', 'Ms 9', 'Ms 10']);
  });

  it('puts the documents without a value in the last group', () => {
    const g = groupItems(['x', '', 'a'], (s) => key(s));
    expect(g.map((x) => x.key)).toEqual(['a', 'x', '']);
  });

  it('nothing is lost: every item lands in exactly one group', () => {
    const items = Array.from({ length: 50 }, (_, i) => `i${i}`);
    const g = groupItems(items, (s) => key(String(Number(s.slice(1)) % 7)));
    expect(g.flatMap((x) => x.items).sort()).toEqual([...items].sort());
  });

  it('makes file names every system accepts', () => {
    expect(safeFileName('Aachen: Dom/Archiv?')).toBe('Aachen_ Dom_Archiv_');
    expect(safeFileName('   ')).toBe('ohne-Angabe');
    expect(safeFileName('.hidden')).toBe('hidden');
    expect(safeFileName('x'.repeat(200)).length).toBe(60);
  });

  it('gives every volume its own file name, also when labels clash or are empty', () => {
    expect(volumeFileNames('Edition', ['Aa 13', 'Ut 417', ''])).toEqual(['Edition_Aa 13.pdf', 'Edition_Ut 417.pdf', 'Edition_ohne-Angabe.pdf']);
    const same = volumeFileNames('E', ['A/B', 'A:B', 'a_b']);
    expect(new Set(same.map((s) => s.toLowerCase())).size).toBe(3);
  });
});
