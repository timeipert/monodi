import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffDigests, digestMelody, digestMeta, digestText, digestsOf, hashString, methodFingerprint, stableStringify, usedDigests } from './fingerprint.ts';
import type { DocDigests } from './fingerprint.ts';
import { chant, docInfo } from './test-helpers.ts';

describe('stableStringify', () => {
  it('does not depend on the order of object keys', () => {
    assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });

  it('keeps array order and drops undefined members', () => {
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
    assert.equal(stableStringify({ a: undefined, b: 1 }), stableStringify({ b: 1 }));
  });
});

describe('hashString', () => {
  it('is stable, differs for different text and for different seeds', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    assert.notEqual(hashString('abc'), hashString('abd'));
    assert.notEqual(hashString('abc', 7), hashString('abc'));
    assert.match(hashString('anything'), /^[0-9a-z]{1,11}$/);
  });
});

describe('digests', () => {
  const a = chant([{ text: 'Ky-', pitches: [30, 31] }, { text: 'rie', pitches: [32] }]);
  const info = docInfo(1, { 'doc:gattung1': 'Antiphon' });

  it('change with the melody only in the melody digest', () => {
    const b = { ...a, pitches: [30, 31, 33] };
    assert.notEqual(digestMelody(a), digestMelody(b));
    assert.equal(digestText(a), digestText(b));
  });

  it('change with the text only in the text digest', () => {
    const b = { ...a, sylText: ['Ky-', 'ries'] };
    assert.equal(digestMelody(a), digestMelody(b));
    assert.notEqual(digestText(a), digestText(b));
  });

  it('change with the metadata only in the meta digest', () => {
    const other = docInfo(1, { 'doc:gattung1': 'Responsory' });
    assert.notEqual(digestMeta(info), digestMeta(other));
    assert.equal(digestsOf(a, info).melody, digestsOf(a, other).melody);
  });

  it('move a syllable boundary changes the melody digest', () => {
    const b = chant([{ text: 'Ky-', pitches: [30] }, { text: 'rie', pitches: [31, 32] }]);
    assert.notEqual(digestMelody(a), digestMelody(b));
  });
});

describe('methodFingerprint', () => {
  const d = (m: string, t: string, meta: string): DocDigests => ({ melody: m, text: t, meta });
  const base = { methodId: 'ngrams', version: 1, params: { n: 3, unit: 'interval' }, uses: ['melody'] as const, digests: { x: d('m1', 't1', 'a'), y: d('m2', 't2', 'b') } };

  it('is equal for equal input whatever the key order', () => {
    const swapped = { ...base, params: { unit: 'interval', n: 3 }, digests: { y: d('m2', 't2', 'b'), x: d('m1', 't1', 'a') } };
    assert.equal(methodFingerprint(base), methodFingerprint(swapped));
  });

  it('changes with the method version, the parameters and the extra text', () => {
    assert.notEqual(methodFingerprint(base), methodFingerprint({ ...base, version: 2 }));
    assert.notEqual(methodFingerprint(base), methodFingerprint({ ...base, params: { n: 4, unit: 'interval' } }));
    assert.notEqual(methodFingerprint(base), methodFingerprint({ ...base, extra: 'flags' }));
  });

  it('ignores digests the method does not use', () => {
    const textChanged = { ...base, digests: { x: d('m1', 'OTHER', 'a'), y: d('m2', 't2', 'b') } };
    assert.equal(methodFingerprint(base), methodFingerprint(textChanged));
    assert.notEqual(methodFingerprint(base), methodFingerprint({ ...textChanged, uses: ['melody', 'text'] as const }));
  });

  it('changes when a document is added or removed', () => {
    assert.notEqual(methodFingerprint(base), methodFingerprint({ ...base, digests: { x: base.digests.x } }));
  });
});

describe('diffDigests', () => {
  const d = (m: string, t = 't', meta = 'm'): DocDigests => ({ melody: m, text: t, meta });
  const stored = (docs: Record<string, DocDigests>, uses: ('melody' | 'text' | 'meta')[]) => usedDigests(docs, uses);

  it('finds changed and removed documents for the parts a method uses', () => {
    const before = stored({ a: d('1'), b: d('2'), c: d('3') }, ['melody']);
    const diff = diffDigests(before, { a: d('1'), b: d('X'), c: undefined }, ['melody']);
    assert.deepEqual(diff.changed, ['b']);
    assert.deepEqual(diff.removed, ['c']);
    assert.equal(diff.same, false);
  });

  it('is the same when only an unused part differs', () => {
    const diff = diffDigests(stored({ a: d('1', 't1') }, ['melody']), { a: d('1', 't2') }, ['melody']);
    assert.equal(diff.same, true);
  });

  it('sees a change of a used text part', () => {
    const diff = diffDigests(stored({ a: d('1', 't1') }, ['melody', 'text']), { a: d('1', 't2') }, ['melody', 'text']);
    assert.deepEqual(diff.changed, ['a']);
  });

  it('reports documents present now but not stored', () => {
    const diff = diffDigests(stored({ a: d('1') }, ['melody']), { a: d('1'), z: d('9') }, ['melody']);
    assert.deepEqual(diff.added, ['z']);
  });
});
