import { flagForShortcutKey, flagShortcutKey, parseSvgToGlyph, sanitizeNoteFlags, validateFlagKey } from './note-flags';

describe('note flags', () => {
  it('maps flags to the digit keys 1-9 then 0 by position, without any modifier', () => {
    const defs = 'BCEFGHIJKM'.split('').concat('P').map(k => ({ key: k, label: k, abbrev: k }));
    expect(flagShortcutKey(defs, 'B')).toBe('1');
    expect(flagShortcutKey(defs, 'K')).toBe('9');
    expect(flagShortcutKey(defs, 'M')).toBe('0'); // 10th flag
    expect(flagShortcutKey(defs, 'P')).toBeNull(); // 11th flag
    expect(flagForShortcutKey(defs, '1')?.key).toBe('B');
    expect(flagForShortcutKey(defs, '0')?.key).toBe('M');
    expect(flagForShortcutKey(defs.slice(0, 3), '5')).toBeUndefined();
    expect(flagForShortcutKey(defs, 'a')).toBeUndefined();
  });

  it('rejects reserved, duplicate and non-uppercase keys', () => {
    const defs = [{ key: 'V', label: 'Virga', abbrev: 'V' }];
    expect(validateFlagKey('S', defs)).toContain('reserved');
    expect(validateFlagKey('V', defs)).toContain('already used');
    expect(validateFlagKey('v', defs)).toContain('uppercase');
    expect(validateFlagKey('P', defs)).toBeNull();
  });

  it('drops malformed definitions when loading settings', () => {
    const out = sanitizeNoteFlags([{ key: 'V', label: 'Virga' }, { key: 'v' }, { key: 'S' }, { key: 'V' }, null]);
    expect(out.map(d => d.key)).toEqual(['V']);
  });

  it('reads path data and viewBox from an SVG', () => {
    const g = parseSvgToGlyph('<svg viewBox="0 0 10 20"><path d="M0 0 L5 5"/><path fill="x" d="M1 1"/></svg>');
    expect(g).toEqual({ viewBox: '0 0 10 20', d: 'M0 0 L5 5 M1 1' });
    expect(parseSvgToGlyph('<svg><rect/></svg>')).toBeNull();
  });
});
