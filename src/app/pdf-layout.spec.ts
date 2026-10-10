import { layoutPdfLine, PdfLayoutItem, PdfLayoutOptions } from './pdf-layout';
import { ClefDisplayMode } from './clef-policy';

const opts = (over: Partial<PdfLayoutOptions> = {}): PdfLayoutOptions => ({
  startX: 100, maxX: 500, continuationIndent: 20, clefWidth: 12, clefMode: 'document-start', ...over,
});
const syl = (width: number, extra: Partial<PdfLayoutItem> = {}): PdfLayoutItem => ({ kind: 'syllable', width, ...extra });
const marker = (width = 8): PdfLayoutItem => ({ kind: 'marker', width });

/** mulberry32: small deterministic PRNG so fuzz failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('layoutPdfLine', () => {
  it('handles an empty line', () => {
    expect(layoutPdfLine([], opts())).toEqual({ placed: [], systems: [] });
  });

  it('keeps a short line on one system, starting at startX, content-width only', () => {
    const r = layoutPdfLine([syl(50), syl(60)], opts());
    expect(r.systems.length).toBe(1);
    expect(r.placed.map(p => p.x)).toEqual([100, 150]);
    expect(r.systems[0].endX).toBe(210);
  });

  it('wraps with indent and no clef in document-start mode', () => {
    const r = layoutPdfLine([syl(150), syl(150), syl(150), syl(150)], opts());
    // 100 -> 250 -> 400; the third (150) would end at 550 > 500
    expect(r.systems.length).toBe(2);
    expect(r.systems[0].last).toBe(1);
    expect(r.placed[2].system).toBe(1);
    expect(r.placed[2].x).toBe(120);
    expect(r.placed[2].injectClef).toBeFalse();
  });

  it('injects a clef on wrapped systems in every-break mode only', () => {
    const items = [syl(150), syl(150), syl(150), syl(150)];
    const eb = layoutPdfLine(items, opts({ clefMode: 'every-break' }));
    const f = eb.placed.find(p => p.system === 1)!;
    expect(f.injectClef).toBeTrue();
    expect(f.clefX).toBe(120);
    expect(f.x).toBe(132);
    for (const m of ['document-start', 'every-line'] as ClefDisplayMode[]) {
      expect(layoutPdfLine(items, opts({ clefMode: m })).placed.some(p => p.system > 0 && p.injectClef)).toBeFalse();
    }
  });

  it('does not inject a clef into an item that already has one', () => {
    const r = layoutPdfLine([syl(300), syl(300, { hasClef: true })], opts({ clefMode: 'every-break' }));
    expect(r.placed[1].injectClef).toBeFalse();
  });

  it('never wraps on a marker, even one crossing the margin', () => {
    const r = layoutPdfLine([syl(380), marker(50)], opts());
    expect(r.systems.length).toBe(1);
    expect(r.placed[1].system).toBe(0);
  });

  it('prefers breaking after a caesura when one is near the end of the system', () => {
    const items = [syl(100), syl(100), syl(90, { breakAfterPreferred: true }), syl(60), syl(60)];
    const r = layoutPdfLine(items, opts());
    // 100+100+90+60 = 350 fits (to x=450); +60 = 510 > 500 -> wrap. Caesura is after item 2.
    expect(r.systems[1].first).toBe(3);
  });

  it('keeps markers that follow the caesura at the end of the previous system', () => {
    const items = [syl(100), syl(100), syl(90, { breakAfterPreferred: true }), marker(10), syl(60), syl(60)];
    const r = layoutPdfLine(items, opts());
    expect(r.systems[0].last).toBe(3);
    expect(r.systems[1].first).toBe(4);
    expect(r.placed[4].x).toBe(120);
  });

  it('ignores a caesura that is too early in the system', () => {
    const items = [syl(20, { breakAfterPreferred: true }), syl(150), syl(150), syl(150)];
    const r = layoutPdfLine(items, opts());
    expect(r.systems[0].last).toBe(2);
  });

  it('always makes progress with an item wider than the page', () => {
    const r = layoutPdfLine([syl(2000), syl(2000), syl(5)], opts());
    expect(r.placed.length).toBe(3);
    expect(r.systems.length).toBe(3);
  });

  it('keeps a lone last syllable on the previous system when it fits within the slack', () => {
    // 100 -> 250 -> 400, a third item of 150 would end at 550 (> 500) and wrap alone
    const items = [syl(150), syl(150), syl(150)];
    expect(layoutPdfLine(items, opts()).systems.length).toBe(2);
    expect(layoutPdfLine(items, opts({ widowSlack: 30 })).systems.length).toBe(2);   // overshoot 50 > 30
    const near = [syl(150), syl(150), syl(110)];                                     // ends at 510: overshoot 10
    expect(layoutPdfLine(near, opts()).systems.length).toBe(2);
    const r = layoutPdfLine(near, opts({ widowSlack: 30 }));
    expect(r.systems.length).toBe(1);
    expect(r.placed.map(p => p.x)).toEqual([100, 250, 400]);
  });

  it('only a single trailing syllable is pulled back, never a longer tail', () => {
    const items = [syl(150), syl(150), syl(100), syl(60), syl(60)];                  // 400 + 100 fits; the last two wrap together
    expect(layoutPdfLine(items, opts({ widowSlack: 200 })).systems.length).toBe(2);
  });

  it('handles 5000 syllables quickly', () => {
    const items = Array.from({ length: 5000 }, (_, k) => syl(20 + (k % 7) * 9, { breakAfterPreferred: k % 11 === 0 }));
    const t = performance.now();
    const r = layoutPdfLine(items, opts({ clefMode: 'every-break' }));
    expect(performance.now() - t).toBeLessThan(500);
    expect(r.placed.length).toBe(5000);
  });

  it('fuzz: invariants hold for random lines in all clef modes', () => {
    const rand = rng(20261009);
    const modes: ClefDisplayMode[] = ['document-start', 'every-line', 'every-break'];
    for (let run = 0; run < 400; run++) {
      const n = Math.floor(rand() * 80);
      const items: PdfLayoutItem[] = [];
      for (let k = 0; k < n; k++) {
        const r = rand();
        if (r < 0.1) items.push(marker(Math.floor(rand() * 30)));
        else items.push(syl(Math.floor(rand() * (r < 0.05 ? 700 : 120)), {
          breakAfterPreferred: rand() < 0.15, hasClef: rand() < 0.03,
        }));
      }
      const o = opts({ clefMode: modes[run % 3], continuationIndent: Math.floor(rand() * 60), clefWidth: Math.floor(rand() * 30) });
      const res = layoutPdfLine(items, o);

      // order preserved, every item placed exactly once
      expect(res.placed.map(p => p.index)).toEqual(items.map((_, k) => k));
      // systems partition the items contiguously
      let next = 0;
      for (const s of res.systems) { expect(s.first).toBe(next); next = s.last + 1; }
      expect(next).toBe(n);
      expect(res.systems.length).toBeLessThanOrEqual(Math.max(n, 0));
      for (let s = 0; s < res.systems.length; s++) {
        const sys = res.systems[s];
        expect(sys.startX).toBe(s === 0 ? o.startX : o.startX + o.continuationIndent);
        const inSys = res.placed.filter(p => p.system === s);
        // no overlap, monotonic
        for (let k = 1; k < inSys.length; k++) {
          expect(inSys[k].x).toBeGreaterThanOrEqual(inSys[k - 1].x + items[inSys[k - 1].index].width - 1e-9);
        }
        // nothing crosses the right margin unless it is alone-wide or follows a marker run
        if (inSys.length > 1) {
          const lastSyl = [...inSys].reverse().find(p => items[p.index].kind === 'syllable');
          if (lastSyl && lastSyl !== inSys[0]) {
            expect(lastSyl.x + items[lastSyl.index].width).toBeLessThanOrEqual(o.maxX + 1e-9);
          }
        }
        // clef only on wrapped systems in every-break mode
        const injected = inSys.some(p => p.injectClef);
        if (o.clefMode !== 'every-break' || s === 0) expect(injected).toBeFalse();
      }
    }
  });
});
