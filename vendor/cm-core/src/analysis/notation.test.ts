import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contourNotation, intervalNotation, layoutNotation, notePositions, NOTATION_MAX, pitchNotation } from './notation.ts';
import { tableToCsv } from './csv.ts';
import { cellOfKey, notationOfKey } from './tokens.ts';
import { isNotationCell } from './result.ts';

describe('notation cells', () => {
  it('pitch cells keep the pitches and carry their names as text', () => {
    const c = pitchNotation([29, 31, 32]);
    assert.deepEqual(c.notation, { mode: 'pitch', values: [29, 31, 32], more: false });
    assert.equal(c.text, 'D4 F4 G4');
  });

  it('interval cells carry the signed steps', () => {
    const c = intervalNotation([2, -1, 0]);
    assert.equal(c.text, '+2 -1 0');
    assert.equal(c.notation.mode, 'interval');
  });

  it('contour cells become steps of one scale degree', () => {
    const c = contourNotation('udr');
    assert.deepEqual(c.notation.values, [1, -1, 0]);
    assert.equal(c.text, 'u d r');
  });

  it('long sequences are cut and marked', () => {
    const c = pitchNotation(Array.from({ length: 40 }, (_, i) => 20 + (i % 5)));
    assert.equal(c.notation.values.length, NOTATION_MAX);
    assert.equal(c.notation.more, true);
    assert.ok(c.text.endsWith('…'));
    assert.equal(intervalNotation(Array.from({ length: 40 }, () => 1)).notation.values.length, NOTATION_MAX - 1);
  });

  it('the key of an n-gram becomes a cell, words stay text', () => {
    const iv = cellOfKey('interval', String.fromCharCode(1002, 999));
    assert.ok(isNotationCell(iv));
    assert.equal((iv as { text: string }).text, '+2 -1');
    assert.equal(cellOfKey('word', 'et in'), 'et in');
    assert.equal(notationOfKey('word', 'et'), undefined);
    assert.equal(notationOfKey('pitch', String.fromCharCode(1029))!.values[0], 29);
  });

  it('a table with notes exports the text of the notes to CSV', () => {
    const csv = tableToCsv({ columns: [{ key: 'a', label: 'Gram' }], rows: [[pitchNotation([29, 31])], [intervalNotation([2, -1])]] });
    assert.equal(csv, 'Gram\nD4 F4\n+2 -1\n');
  });
});

describe('layoutNotation', () => {
  it('lays pitches on the treble staff of the editor: E4 on the lowest line, G4 on the second, C4 on a ledger line', () => {
    const l = layoutNotation(pitchNotation([30, 32, 35, 28]).notation); // E4 G4 C5 C4
    assert.equal(l.clef, true);
    assert.deepEqual(l.heads.map((h) => h.y), [80, 70, 55, 90]);
    assert.ok(l.ledgers.some((x) => x.y === 90)); // the ledger line of C4
    assert.equal(l.heads[1].y - l.heads[2].y, 15);
  });

  it('the staff is the same for every melody: the same pitch is always at the same height', () => {
    const high = layoutNotation(pitchNotation([32, 40, 41]).notation);
    const low = layoutNotation(pitchNotation([32, 25]).notation);
    assert.equal(high.heads[0].y, 70);
    assert.equal(low.heads[0].y, 70);
  });

  it('heads are one step (5 units) apart and advance to the right', () => {
    const l = layoutNotation(pitchNotation([30, 31, 32]).notation);
    assert.equal(l.heads[0].y - l.heads[1].y, 5);
    assert.equal(l.heads[1].y - l.heads[2].y, 5);
    assert.ok(l.heads[1].x > l.heads[0].x && l.heads[0].x > 24);
    assert.equal(l.ledgers.length, 0);
  });

  it('notes far from the staff get ledger lines and the drawing grows to hold them', () => {
    const l = layoutNotation(pitchNotation([30, 41]).notation); // E4 and a note two octaves up
    assert.ok(l.ledgers.length > 0);
    assert.ok(l.top < 32);
    const inside = layoutNotation(pitchNotation([30, 34]).notation);
    assert.equal(inside.ledgers.length, 0);
    assert.equal(inside.top, 32);
  });

  it('intervals get no clef and are centred', () => {
    const l = layoutNotation(intervalNotation([2, 2, -4]).notation);
    assert.equal(l.clef, false);
    assert.equal(l.heads.length, 4);
    const ys = l.heads.map((h) => h.y);
    assert.equal(ys[0] - ys[1], 5 * 2);
    assert.ok(Math.min(...ys) >= 40 && Math.max(...ys) <= 80);
  });

  it('a wide interval gets ledger lines', () => {
    assert.ok(layoutNotation(intervalNotation([12]).notation).ledgers.length > 0);
    assert.equal(layoutNotation(intervalNotation([1]).notation).ledgers.length, 0);
  });

  it('positions of an interval cell are cumulative from 0', () => {
    assert.deepEqual(notePositions(intervalNotation([2, -1, 3]).notation), [0, 2, 1, 4]);
    assert.deepEqual(notePositions(pitchNotation([7, 9]).notation), [7, 9]);
  });

  it('handles an empty cell', () => {
    const l = layoutNotation({ mode: 'pitch', values: [] });
    assert.equal(l.heads.length, 0);
    assert.ok(l.width > 0);
  });
});
