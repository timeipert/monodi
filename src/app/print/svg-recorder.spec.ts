import { jsPDF } from 'jspdf';
import { SvgRecorder, fmt } from './svg-recorder';
import type { PathOp } from './svg-path';

/** A recorder around a small real jsPDF document (built-in font: no font files are needed). */
function setup(): { doc: jsPDF; rec: SvgRecorder } {
  const rec = new SvgRecorder();
  const doc = rec.wrap(new jsPDF({ unit: 'pt', format: [400, 600] }));
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  return { doc, rec };
}

/** A small closed outline whose first point is (x, y): the same shape at any place. */
const blob = (x: number, y: number): PathOp[] => [
  { op: 'm', c: [x, y] }, { op: 'c', c: [x + 1, y, x + 2, y + 1, x + 2, y + 2] }, { op: 'l', c: [x, y + 2] }, { op: 'h', c: [] },
];

describe('fmt', () => {
  it('writes the shortest spelling', () => {
    expect(fmt(1.5)).toBe('1.5');
    expect(fmt(0.5)).toBe('.5');
    expect(fmt(-0.25)).toBe('-.25');
    expect(fmt(3)).toBe('3');
    expect(fmt(-0.001)).toBe('0');
    expect(fmt(12.3456)).toBe('12.35');
    expect(fmt(12.34, 1)).toBe('12.3');
  });
});

describe('SvgRecorder', () => {
  it('records nothing for an untouched document', () => {
    const { rec } = setup();
    expect(rec.isEmpty).toBeTrue();
    expect(rec.toSvg()).toBe('');
  });

  it('is transparent: the wrapped document still draws and measures', () => {
    const { doc } = setup();
    expect(doc.getTextWidth('abc')).toBeGreaterThan(0);
    doc.text('abc', 10, 20);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('writes text as plain <text>, escaped, with the font size on the root', () => {
    const { doc, rec } = setup();
    doc.text('a<b & c', 10, 20);
    doc.text('x', 30, 20);
    const svg = rec.toSvg();
    expect(svg).toContain('<text x="');
    expect(svg).toContain('a&lt;b &amp; c</text>');
    expect(svg).toContain('font-size="10"');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="\d+" height="\d+" fill="currentColor"/);
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('class=');
  });

  it('a text with another size, weight or alignment gets attributes of its own', () => {
    const { doc, rec } = setup();
    doc.text('base', 10, 20);
    doc.text('base2', 10, 40);
    doc.setFontSize(14);
    doc.setFont('times', 'bold');
    doc.text('big', 100, 60, { align: 'center' });
    const svg = rec.toSvg();
    expect(svg).toContain('font-size="14"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('text-anchor="middle"');
  });

  it('five equally spaced staff lines become one <use> of a staff defined once', () => {
    const { doc, rec } = setup();
    doc.setDrawColor(0x33, 0x33, 0x33);
    doc.setLineWidth(0.5);
    for (const top of [50, 150]) for (let i = 0; i < 5; i++) doc.line(30, top + i * 3.6, 130 + top, top + i * 3.6);
    const svg = rec.toSvg();
    expect(svg.match(/<use /g)?.length).toBe(2);
    expect(svg.match(/<path id="s/g)?.length).toBe(1);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width=".5"');
    expect(svg).toContain('matrix(');
  });

  it('other lines are merged into one path per stroke width', () => {
    const { doc, rec } = setup();
    doc.setDrawColor(0x33, 0x33, 0x33);
    doc.setLineWidth(1);
    doc.line(10, 10, 10, 30);
    doc.line(50, 10, 50, 30);
    doc.line(10, 100, 40, 120);
    const svg = rec.toSvg();
    expect(svg.match(/<path d="M[^"]*" fill="none" stroke="currentColor"\/>/g)?.length).toBe(1);
    expect(svg).toContain('V');
    expect(svg).toContain('L');
  });

  it('filled rectangles are merged into one path', () => {
    const { doc, rec } = setup();
    doc.setFillColor(0x33, 0x33, 0x33);
    doc.rect(10, 10, 5.4, 0.36, 'F');
    doc.rect(40, 10, 5.4, 0.36, 'F');
    const svg = rec.toSvg();
    expect(svg.match(/<path /g)?.length).toBe(1);
    expect(svg).toContain('h5.4v.36h-5.4z');
  });

  it('an outline drawn twice is defined once and placed with <use x y>; ids depend on the shape only', () => {
    const { doc, rec } = setup();
    doc.setFillColor(0x33, 0x33, 0x33);
    doc.path(blob(10, 10)); doc.fillEvenOdd();
    doc.path(blob(50.5, 70.25)); doc.fillEvenOdd();
    const svg = rec.toSvg();
    expect(svg.match(/<path id="g/g)?.length).toBe(1);
    expect(svg.match(/<use href="#g/g)?.length).toBe(2);
    const id = /<path id="(g\w+)"/.exec(svg)![1];
    // the same shape in another document gets the same id
    const other = setup();
    other.doc.setFillColor(0x33, 0x33, 0x33);
    other.doc.path(blob(0, 0)); other.doc.fillEvenOdd();
    other.doc.path(blob(5, 5)); other.doc.fillEvenOdd();
    expect(/<path id="(g\w+)"/.exec(other.rec.toSvg())![1]).toBe(id);
  });

  it('a single outline is written inline, a different shape does not share a definition', () => {
    const { doc, rec } = setup();
    doc.setFillColor(0x33, 0x33, 0x33);
    doc.path(blob(10, 10)); doc.fillEvenOdd();
    doc.path([{ op: 'm', c: [60, 60] }, { op: 'l', c: [70, 60] }, { op: 'l', c: [70, 80] }, { op: 'h', c: [] }]); doc.fillEvenOdd();
    const svg = rec.toSvg();
    expect(svg).not.toContain('<defs>');
    expect(svg.match(/<path fill-rule="evenodd"/g)?.length).toBe(2);
  });

  it('stroked outlines (neume brackets) are merged, unfilled, with round joins', () => {
    const { doc, rec } = setup();
    doc.setDrawColor(0x33, 0x33, 0x33);
    doc.setLineWidth(0.72);
    doc.path([{ op: 'm', c: [10, 10] }, { op: 'l', c: [10, 8] }, { op: 'l', c: [20, 8] }]); doc.stroke();
    doc.path([{ op: 'm', c: [40, 10] }, { op: 'l', c: [40, 8] }, { op: 'l', c: [50, 8] }]); doc.stroke();
    const svg = rec.toSvg();
    expect(svg.match(/<path /g)?.length).toBe(1);
    expect(svg).toContain('fill="none" stroke="currentColor" stroke-width=".72" stroke-linejoin="round"');
  });

  it('the notation colour and black are currentColor, any other colour stays explicit', () => {
    const { doc, rec } = setup();
    doc.setDrawColor(140, 140, 140);
    doc.setLineWidth(0.5);
    doc.line(10, 10, 10, 20);
    doc.setTextColor(0, 0, 0);
    doc.text('black', 20, 20);
    doc.setTextColor(0x33, 0x33, 0x33);
    doc.text('notation', 20, 40);
    doc.setTextColor(150, 150, 150);
    doc.text('grey', 20, 60);
    const svg = rec.toSvg();
    expect(svg).toContain('stroke="#8c8c8c"');
    expect(svg).toMatch(/<text [^>]*fill="#9[0-9a-f]{5}"/);
    expect(svg.match(/fill="#/g)?.length).toBe(1);
  });

  it('the viewBox fits the drawing and the drawing starts at the top left', () => {
    const { doc, rec } = setup();
    doc.text('x', 200, 300);
    const svg = rec.toSvg({ padding: 4 });
    const [w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.slice(1).map(Number);
    expect(w).toBeLessThan(40);
    expect(h).toBeLessThan(40);
    expect(svg).toContain('x="4');
  });

  it('pages are stacked below each other, without the margins', () => {
    const { doc, rec } = setup();
    doc.text('one', 10, 100);
    doc.addPage();
    doc.text('two', 10, 100);
    const svg = rec.toSvg({ padding: 0, trimPerPage: 60 });
    const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => +m[1]);
    expect(ys.length).toBe(2);
    // the second page's baseline is 600 - 60 pt below the first one's
    expect(ys[1] - ys[0]).toBe(-60);
  });
});
