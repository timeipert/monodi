import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describePattern, parsePattern, searchChant, searchCorpus } from './search.ts';
import type { ParsedPattern, Pattern } from './search.ts';
import { cellText } from './result.ts';
import { corpusOf, plain } from './test-helpers.ts';

const pat = (r: ParsedPattern): Pattern => {
  assert.ok('pattern' in r, 'error' in r ? r.error : '');
  return r.pattern;
};

describe('parsePattern', () => {
  it('reads letters with and without spaces; without octaves the octave is ignored', () => {
    assert.deepEqual(pat(parsePattern('d f g', 'pitch')), { unit: 'pitch', octave: false, values: [1, 3, 4] });
    assert.deepEqual(pat(parsePattern('DFG', 'pitch')).values, [1, 3, 4]);
  });

  it('reads octave numbers: when every note has one, octaves must match', () => {
    const p = pat(parsePattern('D4 F4 G4', 'pitch'));
    assert.equal(p.octave, true);
    assert.deepEqual(p.values, [29, 31, 32]);
    assert.equal(pat(parsePattern('D4 F G', 'pitch')).octave, false);
  });

  it('reads intervals and contours', () => {
    assert.deepEqual(pat(parsePattern('+2 -1, 0', 'interval')).values, [2, -1, 0]);
    assert.deepEqual(pat(parsePattern('u u d r', 'contour')).values, [1, 1, -1, 0]);
    assert.deepEqual(pat(parsePattern('uudr', 'contour')).values, [1, 1, -1, 0]);
  });

  it('says what is wrong', () => {
    assert.match((parsePattern('', 'pitch') as { error: string }).error, /Enter a pattern/);
    assert.match((parsePattern('d x', 'pitch') as { error: string }).error, /not a note/);
    assert.match((parsePattern('+2 a', 'interval') as { error: string }).error, /not an interval/);
    assert.match((parsePattern('udx', 'contour') as { error: string }).error, /not a contour step/);
  });

  it('describes a pattern', () => {
    assert.equal(describePattern(pat(parsePattern('d4 f4', 'pitch'))), 'D4 F4');
    assert.equal(describePattern(pat(parsePattern('d f', 'pitch'))), 'D F');
    assert.equal(describePattern(pat(parsePattern('+2 -1', 'interval'))), '+2 -1');
  });
});

describe('searchChant', () => {
  const chant = plain([29, 31, 32, 31, 29, 31, 32, 33]); // D4 F4 G4 F4 D4 F4 G4 A4

  it('finds exact pitch passages, with octaves or without', () => {
    const m = searchChant(chant, pat(parsePattern('d f g', 'pitch')), { maxDistance: 0 });
    assert.deepEqual(m.map((x) => [x.start, x.end, x.distance]), [[0, 2, 0], [4, 6, 0]]);
    assert.equal(searchChant(chant, pat(parsePattern('D5 F5', 'pitch')), { maxDistance: 0 }).length, 0);
  });

  it('finds an interval passage as the notes it spans (one more than the steps)', () => {
    const m = searchChant(chant, pat(parsePattern('+2 +1', 'interval')), { maxDistance: 0 });
    assert.deepEqual(m.map((x) => [x.start, x.end]), [[0, 2], [4, 6]]);
  });

  it('finds a contour', () => {
    const m = searchChant(chant, pat(parsePattern('u u d d', 'contour')), { maxDistance: 0 });
    assert.deepEqual(m.map((x) => [x.start, x.end]), [[0, 4]]);
  });

  it('allows differences: a missing, an extra and a wrong note', () => {
    const p = pat(parsePattern('d f g b', 'pitch')); // the chant has d f g a: one wrong note
    assert.equal(searchChant(chant, p, { maxDistance: 0 }).length, 0);
    const near = searchChant(chant, p, { maxDistance: 1 });
    assert.ok(near.length >= 1);
    assert.ok(near.every((x) => x.distance === 1));
    assert.ok(near.some((x) => x.start === 4));
    assert.equal(searchChant(chant, pat(parsePattern('d f g a', 'pitch')), { maxDistance: 0 }).length, 1);
    const extra = searchChant(plain([29, 31, 40, 32]), pat(parsePattern('d f g', 'pitch')), { maxDistance: 1 });
    assert.ok(extra.some((x) => x.distance === 1));
  });

  it('does not return overlapping passages', () => {
    const m = searchChant(plain([1, 1, 1, 1, 1]), pat(parsePattern('d d', 'pitch')), { maxDistance: 0 });
    for (let i = 1; i < m.length; i++) assert.ok(m[i].start > m[i - 1].end);
  });

  it('the window finds notes in order that are not adjacent (ChantDigger)', () => {
    const p = pat(parsePattern('d g', 'pitch'));
    assert.equal(searchChant(chant, p, { maxDistance: 0 }).length, 0);
    const spread = searchChant(chant, p, { maxDistance: 0, window: 3 });
    assert.deepEqual(spread.map((x) => [x.start, x.end]), [[0, 2], [4, 6]]);
    assert.equal(searchChant(chant, p, { maxDistance: 0, window: 2 }).length, 0);
  });

  it('finds nothing in an empty chant or for an empty pattern', () => {
    assert.deepEqual(searchChant(plain([]), pat(parsePattern('d', 'pitch')), { maxDistance: 1 }), []);
    assert.deepEqual(searchChant(chant, { unit: 'pitch', octave: false, values: [] }, { maxDistance: 0 }), []);
  });
});

describe('searchCorpus', () => {
  it('lists the chants with the pattern, the number of passages and the first passage as notes', () => {
    const c = corpusOf([plain([29, 31, 32, 31, 29, 31, 32]), plain([40, 41]), plain([29, 31, 32])]);
    const r = searchCorpus(c, pat(parsePattern('d f g', 'pitch')), { maxDistance: 0 });
    assert.equal(r.chants, 2);
    assert.equal(r.matches, 3);
    const t = r.table;
    assert.deepEqual(t.rows.map((x) => x[0]), ['chant 0', 'chant 2']);
    assert.equal(t.rows[0][2], 2);
    assert.equal(t.rows[0][4], 1);
    assert.equal(cellText(t.rows[0][5]), 'D4 F4 G4');
    assert.deepEqual(t.rowDocs, [['d0'], ['d2']]);
    assert.match(t.note ?? '', /Octaves are ignored/);
  });
});
