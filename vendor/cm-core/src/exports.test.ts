// Every module of the package must load in Node (no enums, no parameter properties, type-only imports marked), and
// the entry points must offer what the apps import from them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as document from './document/index.ts';
import * as mei from './mei/index.ts';

describe('entry points', () => {
  it('@monodi/core/mei offers the emitter, the profile and the header mapping', () => {
    for (const name of ['emitMei', 'defaultMeiProfile', 'upgradeMeiProfile', 'buildAnnotationIndex', 'METADATA_MAPPING', 'buildMeiHead']) {
      assert.equal(typeof (mei as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('@monodi/core/document offers the pattern code, the note flags and the kinds of the document model', () => {
    for (const name of ['extractPattern', 'analyzeDocument', 'flagDefsOf', 'findFlagMatches', 'ContainerKind', 'LinePartKind', 'NoteType']) {
      assert.equal(typeof (document as Record<string, unknown>)[name] === 'undefined', false, name);
    }
  });

  it('the kinds are the strings that the app stores in its documents', () => {
    assert.equal(document.ContainerKind.ZeileContainer, 'ZeileContainer');
    assert.equal(document.LinePartKind.Syllable, 'Syllable');
    assert.equal(document.NoteType.Quilisma, 'Quilisma');
  });
});
