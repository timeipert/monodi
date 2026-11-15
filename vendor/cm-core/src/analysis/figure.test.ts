import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FIGURE_STYLE, MM_TO_PT, groupCount, isFigureView, niceTicks, renderViewSvg } from './figure';
import type { FigureStyle } from './figure';
import type { BarsView, FigureView, MatrixView, ScatterView, TreeView } from './result';

const style = (o: Partial<FigureStyle> = {}): FigureStyle => ({ ...DEFAULT_FIGURE_STYLE, ...o });

const grouped: BarsView = {
  kind: 'bars', layout: 'columns', title: 'Pitch <distribution> & more', unit: 'notes',
  items: [{ label: 'C4', value: 6 }, { label: 'D4', value: 10 }, { label: 'E4', value: 4 }],
  series: [{ name: 'Source A', n: 3, values: [4, 6, 0] }, { name: 'Source B', n: 2, values: [2, 4, 4] }],
};
const plain: BarsView = { kind: 'bars', layout: 'columns', title: 'Lengths', unit: 'chants', items: [{ label: '1–49', value: 5 }, { label: '50–99', value: 2 }] };

/** All colour values (hex or rgb) that an SVG uses. */
function colours(svg: string): Set<string> {
  const out = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))"/g)) out.add(m[1].toLowerCase());
  return out;
}
const isGrey = (c: string): boolean => {
  if (c.startsWith('rgb')) { const [r, g, b] = c.slice(4, -1).split(',').map(Number); return r === g && g === b; }
  const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x) : [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)];
  return h[0] === h[1] && h[1] === h[2];
};
/** Opening and closing tags match (a cheap well-formedness check for the SVG text). */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (m[1] === '/') { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

describe('figure: general', () => {
  it('niceTicks gives round steps', () => {
    assert.deepEqual(niceTicks(10, 2), [0, 5, 10]);
    assert.deepEqual(niceTicks(0), [0, 1]);
  });

  it('is a complete, well-formed SVG whose size is the width asked for, in points, and has no background', () => {
    const r = renderViewSvg(plain, style({ widthMm: 85 }))!;
    assert.ok(r.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(balanced(r.svg));
    assert.ok(Math.abs(r.width - 85 * MM_TO_PT) < 0.5, String(r.width));
    assert.match(r.svg, new RegExp(`viewBox="0 0 ${Math.round(r.width * 100) / 100} `));
    // nothing is drawn as a full-size rectangle that would paint the background
    for (const m of r.svg.matchAll(/<rect [^>]*width="([\d.]+)" height="([\d.]+)"/g)) assert.ok(Number(m[1]) < r.width * 0.9 || Number(m[2]) < r.height * 0.9);
    assert.ok(!/fill="#ffffff"[^>]*width="[\d.]+"[^>]*height="[\d.]+"[^>]*\/><\/g>$/.test(r.svg));
  });

  it('draws only views that are figures', () => {
    assert.equal(renderViewSvg({ kind: 'text', title: 't', paragraphs: [] }), null);
    assert.equal(renderViewSvg({ kind: 'bars', title: 'rank', layout: 'rows', items: [] }), null);
    assert.equal(isFigureView(plain), true);
    assert.equal(isFigureView({ kind: 'table', title: 't', columns: [], rows: [], totalRows: 0, truncated: false }), false);
    assert.equal(groupCount(grouped), 2);
    assert.equal(groupCount(plain), 1);
  });

  it('escapes text from the data', () => {
    const r = renderViewSvg(grouped, style())!;
    assert.ok(r.svg.includes('Pitch &lt;distribution&gt; &amp; more'));
    assert.ok(!r.svg.includes('<distribution>'));
  });

  it('leaves out tooltips for files', () => {
    assert.ok(renderViewSvg(plain, style({ tooltips: true }))!.svg.includes('<title>'));
    assert.ok(!renderViewSvg(plain, style({ tooltips: false }))!.svg.includes('<title>'));
  });
});

describe('figure: black and white and groups', () => {
  it('draws a chart without groups in black, even when colour is on', () => {
    for (const colour of [false, true]) {
      const cs = [...colours(renderViewSvg(plain, style({ colour }))!.svg)];
      assert.ok(cs.every(isGrey), cs.join());
    }
  });

  it('draws groups as separate panels in black and white: one title per group, only greys', () => {
    const r = renderViewSvg(grouped, style({ groups: 'panels' }))!;
    assert.ok(r.svg.includes('Source A (n = 3)') && r.svg.includes('Source B (n = 2)'));
    assert.ok([...colours(r.svg)].every(isGrey));
    // 3 + 2 bars with a value above zero in the panels
    assert.equal((r.svg.match(/<rect /g) ?? []).length, 2 + 3);
  });

  it('draws groups side by side with a legend and four distinguishable fills', () => {
    const four: BarsView = { ...grouped, series: [0, 1, 2, 3].map((i) => ({ name: `G${i}`, values: [i + 1, i + 1, i + 1] })) };
    const r = renderViewSvg(four, style({ groups: 'grouped' }))!;
    const fills = new Set([...r.svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
    assert.equal(fills.size, 4);
    assert.ok([...colours(r.svg)].every(isGrey));
    for (let i = 0; i < 4; i++) assert.ok(r.svg.includes(`>G${i}<`));
  });

  it('falls back to panels when there are more groups than the greys can tell apart', () => {
    const five: BarsView = { ...grouped, series: [0, 1, 2, 3, 4].map((i) => ({ name: `G${i}`, values: [1, 2, 3] })) };
    const r = renderViewSvg(five, style({ groups: 'grouped' }))!;
    assert.equal(new Set([...r.svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])).size, 1);
  });

  it('uses the palette for groups only when colour is on', () => {
    const r = renderViewSvg(grouped, style({ colour: true, groups: 'panels' }))!;
    const cs = colours(r.svg);
    assert.ok(cs.has('#2a78d6') && cs.has('#eb6834'));
  });

  it('share turns counts into percentages within each group and the groups can be compared', () => {
    const r = renderViewSvg(grouped, style({ value: 'share', tooltips: true }))!;
    // Source A: 4 of 10 notes on C4 = 40 %, Source B: 2 of 10 = 20 %
    assert.ok(r.svg.includes('C4 (Source A): 40 %'));
    assert.ok(r.svg.includes('C4 (Source B): 20 %'));
    assert.ok(r.svg.includes('% of notes'));
  });

  it('counts show the counts', () => {
    const r = renderViewSvg(grouped, style({ value: 'count', tooltips: true }))!;
    assert.ok(r.svg.includes('D4 (Source A): 6 notes'));
  });

  it('a wider figure is wider and keeps the type size', () => {
    const narrow = renderViewSvg(plain, style({ widthMm: 85 }))!;
    const wide = renderViewSvg(plain, style({ widthMm: 175 }))!;
    assert.ok(wide.width > narrow.width * 1.9);
    assert.deepEqual([...narrow.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), [...wide.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i));
  });

  it('draws nothing but axes for an empty histogram without failing', () => {
    const r = renderViewSvg({ kind: 'bars', layout: 'columns', title: 'Empty', items: [] }, style())!;
    assert.ok(balanced(r.svg));
  });
});

describe('figure: composite and other charts', () => {
  const fig: FigureView = { kind: 'figure', title: 'Figure 1', panels: [plain, grouped], caption: 'Figure 1. Test.' };

  it('letters the panels (a), (b) and puts the group panels in a grid per measure', () => {
    const r = renderViewSvg(fig, style({ widthMm: 175 }))!;
    assert.ok(balanced(r.svg));
    assert.ok(r.svg.includes('(a) Lengths') && r.svg.includes('(b) Pitch'));
    assert.ok(r.svg.includes('Source A (n = 3)'));
    assert.equal(r.description, 'Figure 1. Test.');
  });

  it('draws a scatter plot with a different marker for each group and a legend', () => {
    const v: ScatterView = { kind: 'scatter', title: 'Map', points: [{ label: 'a', x: 0, y: 0, group: 'G1' }, { label: 'b', x: 1, y: 1, group: 'G2' }, { label: 'c', x: 2, y: 0, group: 'G3' }], note: '' };
    const r = renderViewSvg(v, style())!;
    assert.ok(balanced(r.svg));
    assert.ok(r.svg.includes('<circle') && r.svg.includes('<rect') && r.svg.includes('<polygon'));
    assert.ok([...colours(r.svg)].every(isGrey));
    assert.ok(r.svg.includes('>G2<'));
  });

  it('uses one marker and no legend when there are more groups than marker shapes', () => {
    const points = Array.from({ length: 9 }, (_, i) => ({ label: `p${i}`, x: i, y: i % 3, group: `G${i}` }));
    const r = renderViewSvg({ kind: 'scatter', title: 'Map', points }, style())!;
    assert.ok(!r.svg.includes('<polygon') && !r.svg.includes('<rect'));
    assert.equal((r.svg.match(/<circle/g) ?? []).length, 9);
  });

  it('draws a dendrogram and a heat map in greys', () => {
    const tree: TreeView = { kind: 'tree', title: 'Tree', leaves: ['A', 'B', 'C'], merges: [{ a: 0, b: 1, height: 1 }, { a: 3, b: 2, height: 2 }] };
    const rt = renderViewSvg(tree, style())!;
    assert.ok(balanced(rt.svg) && rt.svg.includes('>A<') && rt.svg.includes('>C<'));
    const m: MatrixView = { kind: 'matrix', title: 'Heat', rowLabels: ['A', 'B'], colLabels: ['A', 'B'], values: [[0, 1], [1, 0]], digits: 1, lowIsClose: true };
    const rm = renderViewSvg(m, style())!;
    assert.ok(balanced(rm.svg));
    assert.ok([...colours(rm.svg)].every(isGrey));
  });
});
