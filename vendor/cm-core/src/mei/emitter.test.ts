// The helpers of the emitter that need no DOM. The emitted MEI itself is tested in the app
// (apps/monodi/src/app/mei/*.spec.ts), because the emitter needs a browser DOM (see README.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clefLine, resolveClefFields, resolveFormteilFields, resolveNoteFields } from './emitter.ts';
import type { Clef, FormteilContainer, Note } from '../document/model.ts';

const clef = (base: Clef['base'], octave: number, shape = 'C'): Clef => ({ kind: 'Clef', uuid: 'c', focus: false, base, octave, shape });

describe('emitter helpers', () => {
  it('puts a clef on the staff line that is an even number of steps above the bottom line (E of octave 4)', () => {
    assert.equal(clefLine(clef('E', 4)), 1);
    assert.equal(clefLine(clef('G', 4)), 2);
    assert.equal(clefLine(clef('B', 4)), 3);
    assert.equal(clefLine(clef('D', 5)), 4);
    assert.equal(clefLine(clef('F', 5)), 5);
  });

  it('puts a clef in a space on the line below it, and a clef outside the staff on the nearest line', () => {
    assert.equal(clefLine(clef('F', 4)), 1);
    assert.equal(clefLine(clef('C', 2)), 1);
    assert.equal(clefLine(clef('C', 7)), 5);
  });

  it('reads the shape and line of a clef, with C as the shape when none is set', () => {
    assert.deepEqual(resolveClefFields(clef('G', 4, 'f')), { uuid: 'c', shape: 'F', line: '2' });
    assert.equal(resolveClefFields(clef('G', 4, '')).shape, 'C');
  });

  it('reads the fields of a note: pitch name in lower case, octave, connection gap and flags', () => {
    const note: Note = { uuid: 'n', noteType: 'Normal', base: 'A', liquescent: false, octave: 3, focus: false, flags: ['V', 'W'] };
    assert.deepEqual(resolveNoteFields(note, false), { uuid: 'n', base: 'a', octave: '3', flags: 'V W' });
    assert.equal(resolveNoteFields(note, true, 'gap').connectionGap, 'gap');
  });

  it('reads signature, initium and status of a section', () => {
    const f: FormteilContainer = {
      kind: 'FormteilContainer', uuid: 'f', children: [],
      data: [{ name: 'Signatur', data: 'S1' }, { name: 'LemmatisiertesTextInitium', data: 'Ave' }, { name: 'Status', data: 'ok' }, { name: 'Verweis', data: 'x' }]
    };
    assert.deepEqual(resolveFormteilFields(f), { uuid: 'f', signature: 'S1', n: 'Ave', initium: 'Ave', status: 'ok' });
  });
});
