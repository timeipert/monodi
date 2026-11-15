import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { burrowsDelta, cosineSparse, editDistance, entropy, jaccard, logDice, logLikelihood, logRatio, median, pmi, stdDev, tScore } from './stats.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

describe('keyness measures', () => {
  it('logLikelihood: 100 against 50 in two corpora of 1000', () => {
    // E1 = E2 = 75; G2 = 2 (100 ln(100/75) + 50 ln(50/75)) = 16.99
    near(logLikelihood(100, 50, 1000, 1000), 2 * (100 * Math.log(100 / 75) + 50 * Math.log(50 / 75)));
    near(logLikelihood(100, 50, 1000, 1000), 16.99, 0.01);
  });

  it('logLikelihood is 0 for equal relative frequencies and for empty input', () => {
    near(logLikelihood(10, 20, 100, 200), 0);
    assert.equal(logLikelihood(0, 0, 10, 10), 0);
  });

  it('logRatio: twice as frequent is +1, half is -1, zero counts stay finite', () => {
    near(logRatio(100, 50, 1000, 1000), 1);
    near(logRatio(50, 100, 1000, 1000), -1);
    assert.ok(Number.isFinite(logRatio(5, 0, 100, 100)));
  });
});

describe('collocation measures', () => {
  it('pmi in bits', () => near(pmi(10, 20, 20, 100), Math.log2(2.5)));
  it('logDice is 14 when the pair always occurs together', () => near(logDice(5, 5, 5), 14));
  it('logDice drops by one for every halving of the association', () => near(logDice(5, 10, 10), 13));
  it('tScore compares with the expected count', () => near(tScore(10, 20, 20, 100), (10 - 4) / Math.sqrt(10)));
});

describe('descriptive helpers', () => {
  it('entropy of a uniform distribution over 4 items is 2 bits, of a single item 0', () => {
    near(entropy([5, 5, 5, 5]), 2);
    near(entropy([9]), 0);
  });

  it('stdDev uses n - 1; median averages the middle pair', () => {
    near(stdDev([1, 2, 3, 4]), Math.sqrt(5 / 3));
    near(median([4, 1, 3, 2]), 2.5);
  });

  it('cosine of identical sparse vectors is 1, of disjoint ones 0', () => {
    const a = new Map([['x', 1], ['y', 2]]);
    near(cosineSparse(a, a), 1);
    near(cosineSparse(a, new Map([['z', 3]])), 0);
  });

  it('jaccard', () => {
    near(jaccard(new Set([1, 2, 3]), new Set([2, 3, 4])), 0.5);
    near(jaccard(new Set(), new Set()), 1);
  });
});

describe('burrowsDelta', () => {
  it('is symmetric with a zero diagonal and ranks the similar pair closer', () => {
    const freqs = [[0.5, 0.3, 0.2], [0.48, 0.32, 0.2], [0.1, 0.2, 0.7]];
    const d = burrowsDelta(freqs);
    for (let i = 0; i < 3; i++) { assert.equal(d[i][i], 0); for (let j = 0; j < 3; j++) near(d[i][j], d[j][i]); }
    assert.ok(d[0][1] < d[0][2]);
    assert.ok(d[0][1] < d[1][2]);
  });
});

describe('editDistance', () => {
  function naive(a: number[], b: number[]): number {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }

  it('agrees with the plain dynamic program whenever the distance is within the bound, and caps otherwise', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let t = 0; t < 400; t++) {
      const a = Array.from({ length: rnd() % 12 }, () => rnd() % 4);
      const b = Array.from({ length: rnd() % 12 }, () => rnd() % 4);
      const max = rnd() % 8;
      const full = naive(a, b);
      const got = editDistance(a, b, max);
      assert.equal(got, full <= max ? full : max + 1, `a=${a} b=${b} max=${max}`);
    }
  });

  it('handles empty sequences', () => {
    assert.equal(editDistance([], [], 3), 0);
    assert.equal(editDistance([], [1, 2], 3), 2);
    assert.equal(editDistance([1, 2, 3, 4], [], 3), 4);
  });
});
