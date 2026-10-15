import { layoutSignature } from './signature';

// every character 5 wide at size 10 (scales with the size)
const measure = (t: string, size: number) => Array.from(t).length * size * 0.5;

describe('signature layout', () => {
  it('leaves a short signature as it is', () => {
    expect(layoutSignature('A', 40, 10, measure)).toEqual({ lines: ['A'], size: 10 });
    expect(layoutSignature('2a b', 40, 10, measure)).toEqual({ lines: ['2a b'], size: 10 });
  });

  it('sets a slightly too long signature smaller on one line', () => {
    const r = layoutSignature('Fragment', 36, 10, measure);   // 40 wide at 10, 32 at 8
    expect(r.lines).toEqual(['Fragment']);
    expect(r.size).toBeLessThan(10);
  });

  it('breaks a long signature into lines that fit', () => {
    const r = layoutSignature('Duplikat-Datei, zu löschen', 40, 10, measure);
    expect(r.lines.length).toBeGreaterThan(1);
    for (const l of r.lines) expect(measure(l, r.size)).toBeLessThanOrEqual(40);
    expect(r.lines.join(' ').replace(/\s+/g, '')).toBe('Duplikat-Datei,zulöschen');
  });

  it('breaks a single overlong word by characters and loses nothing', () => {
    const r = layoutSignature('Pneumatologie-und-andere-sehr-lange-Wörter', 30, 10, measure);
    for (const l of r.lines) expect(measure(l, r.size)).toBeLessThanOrEqual(30);
    expect(r.lines.join('')).toBe('Pneumatologie-und-andere-sehr-lange-Wörter');
  });

  it('copes with empty text, a width smaller than a character and astral characters', () => {
    expect(layoutSignature('  ', 40, 10, measure).lines).toEqual([]);
    const tiny = layoutSignature('abc', 1, 10, measure);
    expect(tiny.lines.join('')).toBe('abc');
    const astral = layoutSignature('𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞', 20, 10, measure);
    expect(astral.lines.join('')).toBe('𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞');
  });

  it('fuzz: nothing is lost and every line fits (unless a character is wider than the room)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const alphabet = 'ab c-,^D2 ';
    for (let run = 0; run < 500; run++) {
      const text = Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      const maxW = 8 + rnd() * 60;
      const r = layoutSignature(text, maxW, 10, measure);
      expect(r.lines.join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
      for (const l of r.lines) expect(measure(l, r.size)).toBeLessThanOrEqual(Math.max(maxW, r.size * 0.5) + 1e-9);
    }
  });
});
