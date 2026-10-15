import { atPageTop, needsBreak, systemsToKeep, PageBox } from './keep';

const page: PageBox = { top: 70, bottom: 785 };

describe('page break rules', () => {
  it('never breaks on a fresh page', () => {
    expect(atPageTop(70, page)).toBeTrue();
    expect(needsBreak(70, 5000, page)).toBeFalse();
    expect(needsBreak(70.5, 700, page)).toBeFalse();
  });

  it('breaks when the lead and what follows do not fit in the rest of the page', () => {
    expect(needsBreak(700, 80, page)).toBeFalse();   // 780 <= 785
    expect(needsBreak(700, 90, page)).toBeTrue();
  });

  it('does not break for something higher than a page (it would never fit)', () => {
    expect(needsBreak(400, 900, page)).toBeFalse();
  });

  it('systemsToKeep: a short line stays together, a long line keeps first two and last two', () => {
    expect([1, 2, 3].map((n) => systemsToKeep(0, n))).toEqual([1, 2, 3]);
    expect(systemsToKeep(0, 4)).toBe(2);
    expect(systemsToKeep(0, 10)).toBe(2);
    // placing the penultimate system also needs the last one
    expect(systemsToKeep(8, 10)).toBe(2);
    expect(systemsToKeep(2, 10)).toBe(1);
    expect(systemsToKeep(9, 10)).toBe(1);
  });

  /**
   * Simulation of the real loop: heights per system, page content height; systems are placed one
   * after the other and a break is made before system k when `systemsToKeep` systems do not fit.
   * Invariant: when a line with at least 2 systems is split, both sides get at least 2 systems —
   * unless the line is so tall that it could not stay together anyway.
   */
  const simulate = (heights: number[], start: number): number[] => {
    const n = heights.length;
    const pages: number[] = [];
    let y = start, pg = 0;
    for (let k = 0; k < n; k++) {
      const keep = systemsToKeep(k, n);
      const need = heights.slice(k, k + keep).reduce((a, b) => a + b, 0);
      if (needsBreak(y, need, page)) { pg++; y = page.top; }
      pages.push(pg);
      y += heights[k];
    }
    return pages;
  };

  it('fuzz: a split line leaves at least two systems on each page', () => {
    let seed = 20261015;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let run = 0; run < 2000; run++) {
      const n = 2 + Math.floor(rnd() * 9);
      const heights = Array.from({ length: n }, () => 40 + rnd() * 50);
      const start = page.top + rnd() * (page.bottom - page.top);
      const pages = simulate(heights, start);
      const counts = new Map<number, number>();
      for (const p of pages) counts.set(p, (counts.get(p) || 0) + 1);
      if (counts.size > 1) for (const c of counts.values()) expect(c).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < n; k++) expect(pages[k]).toBeGreaterThanOrEqual(pages[k - 1]);
    }
  });

  it('an extremely tall line is still placed (no endless breaking)', () => {
    const pages = simulate([500, 500, 500], page.top);
    expect(pages.length).toBe(3);
    expect(Math.max(...pages)).toBeLessThanOrEqual(3);
  });
});
