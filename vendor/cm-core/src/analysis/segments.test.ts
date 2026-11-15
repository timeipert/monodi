import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { averageLinkage, classicalMds, leafOrder } from './cluster.ts';
import {
  buildSegmentIndex, criterionKey, findSegmentSequence, segmentIsomorphism, segmentPoints, segmentShapeCoarse, segmentShapeIntervals, windowMatches,
} from './segments.ts';
import { chant } from './test-helpers.ts';

// A segment of six notes: differences +2 -1 +2 0 -4.
const SEG = [10, 12, 11, 13, 13, 9];

describe('ChantDigger similarity criteria', () => {
  it('points: first, last, highest, lowest', () => assert.deepEqual(segmentPoints(SEG), [10, 9, 13, 9]));

  it('isomorphism: the steps between successive notes', () => assert.deepEqual(segmentIsomorphism(SEG), [2, -1, 2, 0, -4]));

  it('shape by intervals: the first step and every step at which the direction changes', () => {
    // +2 up; -1 turns down; +2 turns up; 0 keeps up; -4 turns down.
    assert.deepEqual(segmentShapeIntervals(SEG), [2, -1, 2, -4]);
  });

  it('shape by shape: odd values moved up to the next even value', () => {
    assert.deepEqual(segmentShapeCoarse(SEG), [2, 0, 2, -4]);
    assert.deepEqual(segmentShapeCoarse([10, 13, 11]), [4, -2]); // +3 -> 4, -2 stays
  });

  it('a repeated note keeps the direction of the movement before it', () => {
    assert.deepEqual(segmentShapeIntervals([5, 6, 6, 6, 4]), [1, -2]);
  });

  it('segments of one note have no steps', () => {
    assert.deepEqual(segmentIsomorphism([7]), []);
    assert.deepEqual(segmentShapeIntervals([7]), []);
    assert.deepEqual(segmentPoints([7]), [7, 7, 7, 7]);
  });

  it('two transposed segments are isomorphic but not equal in points', () => {
    const a = [10, 12, 11];
    const b = [12, 14, 13];
    assert.equal(criterionKey('isomorphism', a), criterionKey('isomorphism', b));
    assert.notEqual(criterionKey('points', a), criterionKey('points', b));
    assert.notEqual(criterionKey('exact', a), criterionKey('exact', b));
  });

  it('segments with the same first, last, highest and lowest note are similar by points', () => {
    assert.equal(criterionKey('points', [10, 12, 11, 9, 10]), criterionKey('points', [10, 9, 12, 10]));
  });
});

describe('buildSegmentIndex', () => {
  const a = chant([{ pitches: [1, 2] }, { pitches: [3] }, { pitches: [] }, { pitches: [1, 2] }]);
  const b = chant([{ pitches: [3] }, { pitches: [1, 2] }]);
  const idx = buildSegmentIndex([a, b]);

  it('numbers distinct segments in order of first occurrence and counts them', () => {
    assert.deepEqual(idx.segments.map((s) => s.pitches), [[1, 2], [3]]);
    assert.deepEqual(idx.segments.map((s) => s.count), [3, 2]);
    assert.deepEqual(idx.segments.map((s) => s.docs), [2, 2]);
  });

  it('gives each chant its sequence of ids and skips syllables without notes', () => {
    assert.deepEqual(idx.chantSegments, [[0, 1, 0], [1, 0]]);
    assert.deepEqual(idx.chantSpans[0], [{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 5 }]);
    assert.deepEqual(idx.chantSpans[1], [{ start: 0, end: 1 }, { start: 1, end: 3 }]);
  });

  it('finds a sequence of segment ids as consecutive segments', () => {
    assert.deepEqual(findSegmentSequence([0, 1, 0, 1, 0], [1, 0]), [1, 3]);
    assert.deepEqual(findSegmentSequence([0, 1], [1, 1]), []);
    assert.deepEqual(findSegmentSequence([0, 1], []), []);
  });
});

describe('windowMatches (ChantDigger "notes within a width")', () => {
  it('matches the notes in order, not adjacent, within the width', () => {
    const p = [1, 2, 3, 1, 3, 2, 3];
    assert.deepEqual(windowMatches(p, [1, 3], 3), [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
  });

  it('rejects a match whose first and last note are width or more apart', () => {
    const p = [1, 2, 3, 1, 3, 2, 3];
    assert.deepEqual(windowMatches(p, [1, 2, 3], 3), [{ start: 0, end: 2 }]);
    assert.deepEqual(windowMatches(p, [1, 2, 3], 4), [{ start: 0, end: 2 }, { start: 3, end: 6 }]);
  });

  it('a single note matches at every occurrence', () => {
    assert.deepEqual(windowMatches([5, 6, 5], [5], 1), [{ start: 0, end: 0 }, { start: 2, end: 2 }]);
  });

  it('works on text tokens such as pitch names', () => {
    assert.deepEqual(windowMatches(['c', 'd', 'e', 'g'], ['c', 'g'], 4), [{ start: 0, end: 3 }]);
    assert.deepEqual(windowMatches(['c', 'd', 'e', 'g'], ['c', 'g'], 3), []);
  });

  it('finds nothing for an empty query', () => assert.deepEqual(windowMatches([1, 2], [], 5), []));
});

describe('clustering', () => {
  const dist = [
    [0, 1, 5, 6],
    [1, 0, 5, 6],
    [5, 5, 0, 2],
    [6, 6, 2, 0],
  ];

  it('averageLinkage merges the closest pairs first and averages the distances', () => {
    const m = averageLinkage(dist);
    assert.equal(m.length, 3);
    assert.deepEqual([m[0].a, m[0].b, m[0].height], [0, 1, 1]);
    assert.deepEqual([m[1].a, m[1].b, m[1].height], [2, 3, 2]);
    assert.deepEqual([m[2].a, m[2].b, m[2].height], [4, 5, 5.5]);
    assert.equal(m[2].size, 4);
  });

  it('leafOrder keeps merged leaves together', () => {
    const order = leafOrder(4, averageLinkage(dist));
    assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
    assert.equal(Math.abs(order.indexOf(0) - order.indexOf(1)), 1);
    assert.equal(Math.abs(order.indexOf(2) - order.indexOf(3)), 1);
  });

  it('classicalMds reproduces the distances of points on a line', () => {
    const line = [0, 1, 3, 7];
    const d = line.map((a) => line.map((b) => Math.abs(a - b)));
    const xy = classicalMds(d)!;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const got = Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
        assert.ok(Math.abs(got - d[i][j]) < 1e-3, `${i},${j}: ${got} vs ${d[i][j]}`);
      }
    }
  });

  it('classicalMds needs three items', () => assert.equal(classicalMds([[0, 1], [1, 0]]), null));
});
