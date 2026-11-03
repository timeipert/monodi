import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flagForShortcutKey, flagShortcutKey, parseSvgToGlyph, sanitizeNoteFlags, validateFlagKey } from './note-flags.ts';

describe('note flags', () => {
  it('maps flags to the digit keys 1-9 then 0 by position, without any modifier', () => {
    const defs = 'BCEFGHIJKM'.split('').concat('P').map(k => ({ key: k, label: k, abbrev: k }));
    assert.equal(flagShortcutKey(defs, 'B'), '1');
    assert.equal(flagShortcutKey(defs, 'K'), '9');
    assert.equal(flagShortcutKey(defs, 'M'), '0'); // 10th flag
    assert.equal(flagShortcutKey(defs, 'P'), null); // 11th flag
    assert.equal(flagForShortcutKey(defs, '1')?.key, 'B');
    assert.equal(flagForShortcutKey(defs, '0')?.key, 'M');
    assert.equal(flagForShortcutKey(defs.slice(0, 3), '5'), undefined);
    assert.equal(flagForShortcutKey(defs, 'a'), undefined);
  });

  it('rejects reserved, duplicate and non-uppercase keys', () => {
    const defs = [{ key: 'V', label: 'Virga', abbrev: 'V' }];
    assert.match(validateFlagKey('S', defs) ?? '', /reserved/);
    assert.match(validateFlagKey('V', defs) ?? '', /already used/);
    assert.match(validateFlagKey('v', defs) ?? '', /uppercase/);
    assert.equal(validateFlagKey('P', defs), null);
  });

  it('drops malformed definitions when loading settings', () => {
    const out = sanitizeNoteFlags([{ key: 'V', label: 'Virga' }, { key: 'v' }, { key: 'S' }, { key: 'V' }, null]);
    assert.deepEqual(out.map(d => d.key), ['V']);
  });

  it('reads path data and viewBox from an SVG', () => {
    const g = parseSvgToGlyph('<svg viewBox="0 0 10 20"><path d="M0 0 L5 5"/><path fill="x" d="M1 1"/></svg>');
    assert.deepEqual(g, { viewBox: '0 0 10 20', d: 'M0 0 L5 5 M1 1' });
    assert.equal(parseSvgToGlyph('<svg><rect/></svg>'), null);
  });
});
