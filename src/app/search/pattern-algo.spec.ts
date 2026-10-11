import {
  levenshteinDistance,
  arrayLevenshtein,
  getStringSimilarity,
  getSequenceSimilarity,
  buildShingleSet,
  jaccardSimilarity,
  toPitchNames,
  toContour,
  toIntervals,
  nestedPairs,
  dropNestedOccurrences
} from './pattern-algo';
import * as VM from '../types/model';

describe('PatternAlgo Characterization Tests', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('should return string length when compared with an empty string', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('abc', '')).toBe(3);
    });

    it('should return correct edit distance for standard strings', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });

    it('should return value > maxDist (early exit) when actual distance exceeds maxDist', () => {
      // With maxDist = 1, since the actual distance is 3, it should exit early and return maxDist + 1 = 2
      expect(levenshteinDistance('kitten', 'sitting', 1)).toBe(2);
    });
  });

  describe('arrayLevenshtein', () => {
    it('should return 0 for identical arrays', () => {
      expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    });

    it('should return 1 for a single substitution', () => {
      expect(arrayLevenshtein(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
    });

    it('should calculate correct distance for length-difference-only cases', () => {
      expect(arrayLevenshtein(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
      
      // SURPRISE: arrayLevenshtein(['a'], ['a', 'b', 'c']) returns 0 instead of 2.
      // This is because the function restricts the calculation band using the length of the shorter string,
      // which causes the loop to skip later iterations when length differences are larger, resulting in stale DP array values.
      // We lock in this actual behavior.
      expect(arrayLevenshtein(['a'], ['a', 'b', 'c'])).toBe(0);
    });
  });

  describe('getStringSimilarity and getSequenceSimilarity', () => {
    it('should return 1.0 for identical inputs', () => {
      expect(getStringSimilarity('abc', 'abc')).toBe(1.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1.0);
    });

    it('should return 0 for completely different inputs of same length', () => {
      expect(getStringSimilarity('abc', 'xyz')).toBe(0.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['x', 'y', 'z'])).toBe(0.0);
    });

    it('should return 0 if the threshold parameter short-circuits due to length mismatch or low similarity', () => {
      // getStringSimilarity with high threshold should yield 0 for dissimilar strings
      expect(getStringSimilarity('abc', 'xyz', 0.5)).toBe(0.0);
      expect(getSequenceSimilarity(['a', 'b', 'c'], ['x', 'y', 'z'], 0.5)).toBe(0.0);
    });
  });

  describe('buildShingleSet', () => {
    it('should build correct shingles for string inputs', () => {
      const result = buildShingleSet('abcde', 3);
      expect(result.has('abc')).toBeTrue();
      expect(result.has('bcd')).toBeTrue();
      expect(result.has('cde')).toBeTrue();
      expect(result.size).toBe(3);
    });

    it('should return a set containing the input itself if string is shorter than k', () => {
      const result = buildShingleSet('ab', 3);
      expect(result.has('ab')).toBeTrue();
      expect(result.size).toBe(1);
    });

    it('should return a set containing the joined input if array is shorter than k', () => {
      const result = buildShingleSet(['a', 'b'], 3);
      expect(result.has('a|b')).toBeTrue();
      expect(result.size).toBe(1);
    });
  });

  describe('jaccardSimilarity', () => {
    it('should return 1.0 for identical sets', () => {
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1.0);
    });

    it('should return 0.0 for disjoint sets', () => {
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0.0);
    });

    it('should return the correct ratio for half-overlapping sets', () => {
      // intersection is {'b'} (size 1), union is {'a', 'b', 'c'} (size 3) => 1/3
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(0.3333, 4);
    });
  });

  describe('toPitchNames, toContour, and toIntervals', () => {
    const mockNotes: VM.Note[] = [
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Normal } as any as VM.Note,
      { base: VM.BaseNote.D, octave: 4, noteType: VM.NoteType.Normal } as any as VM.Note,
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Flat } as any as VM.Note,
      { base: VM.BaseNote.C, octave: 4, noteType: VM.NoteType.Sharp } as any as VM.Note
    ];

    it('should format pitch names with and without octave', () => {
      expect(toPitchNames(mockNotes, true)).toEqual(['c4', 'd4', 'cb4', 'c#4']);
      expect(toPitchNames(mockNotes, false)).toEqual(['c', 'd', 'cb', 'c#']);
    });

    it('should calculate pitch contour steps', () => {
      // notes: C4 (28) -> D4 (29) (up 'u') -> Cb4 (28) (down 'd') -> C#4 (28) (repeat/same index 'r')
      expect(toContour(mockNotes)).toEqual(['u', 'd', 'r']);
    });

    it('should calculate interval diff numbers', () => {
      // notes: C4 (28) -> D4 (29) (+1) -> Cb4 (28) (-1) -> C#4 (28) (0)
      expect(toIntervals(mockNotes)).toEqual(['+1', '-1', '0']);
    });
  });

  describe('nesting of occurrences', () => {
    // The plain pairwise versions the fast ones replaced: slow, but obviously right.
    const oraclePairs = (nodes: { d: number; start: number; end: number }[]): [number, number][] => {
      const pairs: [number, number][] = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          if (a.d !== b.d) continue;
          if ((a.start >= b.start && a.end <= b.end) || (b.start >= a.start && b.end <= a.end)) pairs.push([i, j]);
        }
      }
      return pairs;
    };
    const oracleDrop = <T extends { doc: { id: string }; startNoteIdx: number; endNoteIdx: number }>(occs: T[]): T[] => {
      const kept: T[] = [];
      for (const occ of occs) {
        let redundant = false;
        for (const other of occs) {
          if (occ === other || occ.doc.id !== other.doc.id) continue;
          if (occ.startNoteIdx >= other.startNoteIdx && occ.endNoteIdx <= other.endNoteIdx) {
            if (occ.startNoteIdx === other.startNoteIdx && occ.endNoteIdx === other.endNoteIdx) {
              if (occs.indexOf(occ) > occs.indexOf(other)) { redundant = true; break; }
            } else { redundant = true; break; }
          }
        }
        if (!redundant) kept.push(occ);
      }
      return kept;
    };
    const random = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    it('finds the same nested pairs as comparing every pair', () => {
      const rnd = random(42);
      for (let round = 0; round < 200; round++) {
        const seen = new Set<string>();
        const nodes: { d: number; start: number; end: number }[] = [];
        for (let k = 0, n = 1 + Math.floor(rnd() * 40); k < n; k++) {
          const d = Math.floor(rnd() * 4), start = Math.floor(rnd() * 20), end = start + Math.floor(rnd() * 8);
          if (!seen.has(`${d}_${start}_${end}`)) { seen.add(`${d}_${start}_${end}`); nodes.push({ d, start, end }); }   // ids are unique per range
        }
        expect(nestedPairs(nodes)).toEqual(oraclePairs(nodes));
      }
    });

    it('drops the same occurrences as comparing every pair, in the same order', () => {
      const rnd = random(7);
      for (let round = 0; round < 200; round++) {
        const occs = Array.from({ length: 1 + Math.floor(rnd() * 40) }, (_, k) => {
          const start = Math.floor(rnd() * 15);
          return { doc: { id: `d${Math.floor(rnd() * 3)}` }, startNoteIdx: start, endNoteIdx: start + Math.floor(rnd() * 6), k };
        });
        expect(dropNestedOccurrences(occs)).toEqual(oracleDrop(occs));
      }
    });

    it('keeps the first of identical ranges and everything that is not inside another', () => {
      const a = { doc: { id: 'x' }, startNoteIdx: 2, endNoteIdx: 5 };
      const b = { doc: { id: 'x' }, startNoteIdx: 2, endNoteIdx: 5 };
      const inside = { doc: { id: 'x' }, startNoteIdx: 3, endNoteIdx: 4 };
      const other = { doc: { id: 'y' }, startNoteIdx: 3, endNoteIdx: 4 };
      const overlapping = { doc: { id: 'x' }, startNoteIdx: 4, endNoteIdx: 8 };
      const kept = dropNestedOccurrences([a, inside, b, other, overlapping]);
      expect(kept).toEqual([a, other, overlapping]);
      expect(kept[0]).toBe(a);
    });

    it('copes with nothing to compare', () => {
      expect(nestedPairs([])).toEqual([]);
      expect(dropNestedOccurrences([])).toEqual([]);
    });
  });
});
