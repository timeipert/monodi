import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractFeatures, intervalsOf, noteBearingSyllables, noteSyllableIndex, wordsFromSyllables } from './features.ts';
import { noteAt, rootOf, syllableOf } from './test-helpers.ts';

describe('extractFeatures', () => {
  it('reads diatonic indexes in reading order and keeps the syllable boundaries', () => {
    const root = rootOf([
      syllableOf('Ky-', [noteAt(29), noteAt(30)]),
      syllableOf('ri-', [noteAt(32)]),
      syllableOf('e', [noteAt(31), noteAt(29), noteAt(28)]),
    ]);
    const f = extractFeatures(root);
    assert.deepEqual(f.pitches, [29, 30, 32, 31, 29, 28]);
    assert.deepEqual(f.sylStart, [0, 2, 3]);
    assert.deepEqual(f.sylLen, [2, 1, 3]);
    assert.deepEqual(f.sylText, ['Ky-', 'ri-', 'e']);
    assert.deepEqual(f.words, ['kyrie']);
  });

  it('does not count accidentals or latent notes as notes of the melody', () => {
    const root = rootOf([
      syllableOf('a', [noteAt(34, { noteType: 'Flat' }), noteAt(34), noteAt(33, { isLatent: true })]),
      syllableOf('b', [noteAt(32, { noteType: 'Sharp' })]),
    ]);
    const f = extractFeatures(root);
    assert.deepEqual(f.pitches, [34]);
    assert.deepEqual(f.sylLen, [1, 0]);
    assert.equal(f.accidentals, 2);
  });

  it('keeps syllables without notes and ignores a second voice', () => {
    const second = { spaced: [{ nonSpaced: [{ grouped: [noteAt(40)] }] }] };
    const root = rootOf([
      syllableOf('et', [], { syllableType: 'WithoutNotes' }),
      syllableOf('in', [noteAt(30)], { additionalMelodies: [second] }),
    ]);
    const f = extractFeatures(root);
    assert.deepEqual(f.sylLen, [0, 1]);
    assert.deepEqual(f.pitches, [30]);
    assert.deepEqual(noteBearingSyllables(f), [1]);
    assert.deepEqual(noteSyllableIndex(f), [1]);
  });

  it('gives an empty chant for an empty document', () => {
    const f = extractFeatures(rootOf([]));
    assert.deepEqual(f.pitches, []);
    assert.deepEqual(f.words, []);
  });
});

describe('wordsFromSyllables', () => {
  it('joins syllables across a trailing hyphen and across a leading hyphen', () => {
    assert.deepEqual(wordsFromSyllables(['Quo-', 'ni-', 'am', 'do-', 'mi-', 'nus']), ['quoniam', 'dominus']);
    assert.deepEqual(wordsFromSyllables(['Quo', '-ni', '-am', 'est']), ['quoniam', 'est']);
  });

  it('drops punctuation and lower-cases', () => {
    assert.deepEqual(wordsFromSyllables(['Ky-', 'ri-', 'e,', 'e-', 'le-', 'i-', 'son.']), ['kyrie', 'eleison']);
  });
});

describe('intervalsOf', () => {
  it('gives signed steps', () => {
    assert.deepEqual(intervalsOf([30, 32, 31, 31, 28]), [2, -1, 0, -3]);
    assert.deepEqual(intervalsOf([5]), []);
  });
});
