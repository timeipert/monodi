/**
 * Figures for publications: draws the chart views of an analysis result (histograms, scatter plots, dendrograms, heat
 * maps) and the multi-panel `figure` view as plain SVG text.
 *
 * What it is for: one drawing that the screen shows and that can be downloaded unchanged as SVG, PNG or PDF. The functions
 * are pure (no DOM, no Angular), so they run in Node tests and in the browser alike.
 *
 * Style rules:
 *  - black and white by default; colour is used only when `FigureStyle.colour` is on, and then only to tell groups apart
 *    (a chart of one series stays black);
 *  - groups are told apart by position first: one panel per group (small multiples, shared scale) or, for few groups,
 *    side-by-side bars in black, white and two greys (outlined, so they survive a black-and-white print);
 *  - no background rectangle: the drawing is transparent where nothing is drawn;
 *  - units are points (1 pt = 1/72 inch) and text sizes are fixed (7 pt ticks, 8 pt titles), so a figure set to a width of
 *    85, 120 or 175 mm has the same type size at every width and a PDF made from it has the real size.
 */
import type { BarsView, MatrixView, ResultView, ScatterView, TreeView } from './result';

export interface FigureStyle {
  /** Colour tells groups apart; off draws everything in black, white and grey. */
  colour: boolean;
  /** Groups as separate panels (`panels`) or as side-by-side bars (`grouped`, only for up to 4 groups, or 8 in colour). */
  groups: 'panels' | 'grouped';
  /** `count`: the counts as they are; `share`: the percentage within each group (groups of different size compare). */
  value: 'count' | 'share';
  /** Width of the whole figure in millimetres (a journal column is about 85, a page about 175). */
  widthMm: number;
  /** Add `<title>` elements, shown as tooltips by a browser; off for files. */
  tooltips: boolean;
}

export const DEFAULT_FIGURE_STYLE: FigureStyle = { colour: false, groups: 'panels', value: 'count', widthMm: 120, tooltips: true };

/** Widths offered for a figure: single column, one and a half columns, full page width. */
export const FIGURE_WIDTHS_MM = [85, 120, 175];

export interface RenderedFigure {
  /** A complete SVG document (root element with `xmlns`, `width`, `height` and `viewBox` in points). */
  svg: string;
  width: number;
  height: number;
  /** What the figure shows, in words (for alternative text). */
  description: string;
}

export const MM_TO_PT = 72 / 25.4;

const INK = '#000000';
const FONT = 'Helvetica, Arial, sans-serif';
const TICK = 7;
const TITLE = 8;
/** Space around the drawing in pt, so strokes at the edge are not cut. */
const MARGIN = 3;
/** Fills of up to four groups side by side in black and white: alternating dark and light, all outlined. */
const GROUP_GREYS = ['#000000', '#ffffff', '#8c8c8c', '#d9d9d9'];
/** Colours of the groups (the categorical order of the reference palette). */
const COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'cross', 'plus'] as const;

interface Block { svg: string; w: number; h: number }

const f = (n: number): string => String(Math.round(n * 100) / 100);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shorten = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const place = (x: number, y: number, inner: string): string => `<g transform="translate(${f(x)} ${f(y)})">${inner}</g>`;

function txt(x: number, y: number, s: string, o: { size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; rotate?: number; fill?: string } = {}): string {
  const tr = o.rotate ? ` transform="rotate(${o.rotate} ${f(x)} ${f(y)})"` : '';
  return `<text x="${f(x)}" y="${f(y)}" font-family="${FONT}" font-size="${o.size ?? TICK}" text-anchor="${o.anchor ?? 'start'}"${o.bold ? ' font-weight="bold"' : ''} fill="${o.fill ?? INK}"${tr}>${esc(s)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, w = 0.5, colour = INK): string {
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${colour}" stroke-width="${w}"/>`;
}

/** Round tick values for an axis from 0 to `max`: a clean step (1, 2, 2.5, 5 times a power of ten). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** 12,345 as `12.3K` on an axis that reaches it; full below 10,000. */
export function tickLabel(v: number, compact: boolean): string {
  if (compact && v >= 1000) return `${Math.round((v / 1000) * 10) / 10}K`;
  return String(Math.round(v * 100) / 100);
}

// ── histogram ──────────────────────────────────────────────────────────────────

interface Ser { name: string; n?: number; raw: number[]; values: number[] }

function seriesOf(v: BarsView, style: FigureStyle): Ser[] {
  const raw: { name: string; n?: number; values: number[] }[] = v.series?.length ? v.series : [{ name: '', values: v.items.map((i) => i.value) }];
  return raw.map((s) => {
    const total = s.values.reduce((a, b) => a + b, 0);
    return { name: s.name, n: s.n, raw: s.values, values: style.value === 'share' ? s.values.map((x) => (total ? (x / total) * 100 : 0)) : s.values };
  });
}

function yTitleOf(v: BarsView, style: FigureStyle): string {
  return style.value === 'share' ? `% of ${v.unit || 'items'}` : (v.unit ?? '');
}

type Paint = { fill: string; stroke: string };

/** Fill of series `j` of `k`: black when there is nothing to tell apart; greys or colours otherwise. */
function paint(style: FigureStyle, how: 'plain' | 'grouped' | 'panel', j: number): Paint {
  if (how === 'plain' || (how === 'panel' && !style.colour)) return { fill: INK, stroke: INK };
  if (style.colour) return { fill: COLOURS[j % COLOURS.length], stroke: 'none' };
  return { fill: GROUP_GREYS[j % GROUP_GREYS.length], stroke: INK };
}

interface ColumnOpts {
  w: number; plotH: number; series: Ser[]; paints: Paint[]; yMax: number;
  showYLabels: boolean; yTitle: string; xLabels: boolean; tooltips: boolean; share: boolean;
}

/** Left margin that holds the tick labels and the rotated axis title. */
const LEFT = 34;

function columnChart(v: BarsView, o: ColumnOpts): Block {
  const n = v.items.length;
  const k = o.series.length;
  const labels = v.items.map((i) => shorten(i.label, 12));
  const longest = Math.max(1, ...labels.map((l) => l.length));
  const left = LEFT; const right = 4; const top = 5;
  const plotW = Math.max(24, o.w - left - right);
  const slot = plotW / Math.max(1, n);
  const charW = 3.7;
  const rotate = o.xLabels && longest * charW + 2 > slot;
  const every = rotate ? Math.max(1, Math.ceil(8 / slot)) : 1;
  const bottom = !o.xLabels ? 4 : rotate ? Math.min(34, longest * charW * 0.72 + 8) : 12;
  const ticks = niceTicks(o.yMax, 3);
  const axisMax = ticks[ticks.length - 1] || 1;
  const scale = o.plotH / axisMax;
  const baseY = top + o.plotH;
  const compact = axisMax >= 10000;
  let s = '';
  for (const t of ticks) {
    const y = baseY - t * scale;
    s += line(left - 2, y, left, y);
    if (o.showYLabels) s += txt(left - 4, y + 2.5, tickLabel(t, compact), { anchor: 'end' });
  }
  s += line(left, top, left, baseY) + line(left, baseY, left + plotW, baseY);
  const groupW = Math.min(slot * 0.82, k === 1 ? 14 : 10 * k);
  const barW = groupW / k;
  for (let i = 0; i < n; i++) {
    const x0 = left + i * slot + (slot - groupW) / 2;
    for (let j = 0; j < k; j++) {
      const val = o.series[j].values[i] ?? 0;
      if (!(val > 0)) continue;
      const h = Math.max(0.6, val * scale);
      const p = o.paints[j];
      const tip = o.tooltips
        ? `<title>${esc(`${v.items[i].label}${o.series[j].name ? ` (${o.series[j].name})` : ''}: ${o.share ? `${Math.round(val * 10) / 10} %` : o.series[j].raw[i].toLocaleString('en')}${!o.share && v.unit ? ` ${v.unit}` : ''}`)}</title>`
        : '';
      s += `<rect x="${f(x0 + j * barW)}" y="${f(baseY - h)}" width="${f(barW)}" height="${f(h)}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="0.4">${tip}</rect>`;
    }
    if (o.xLabels && i % every === 0) {
      const cx = left + i * slot + slot / 2;
      s += rotate ? txt(cx + 2, baseY + 6, labels[i], { anchor: 'end', rotate: -45 }) : txt(cx, baseY + 8.5, labels[i], { anchor: 'middle' });
      s += line(cx, baseY, cx, baseY + 1.5);
    }
  }
  if (o.showYLabels && o.yTitle) s += txt(8, top + o.plotH / 2, o.yTitle, { anchor: 'middle', rotate: -90 });
  return { svg: s, w: o.w, h: baseY + bottom };
}

/** Panel title with its letter, e.g. `(b) Pitch distribution`. */
const panelTitle = (title: string, i: number, lettered: boolean): string => `${lettered ? `(${String.fromCharCode(97 + i)}) ` : ''}${title}`;

function legendRow(names: string[], paints: Paint[], w: number): Block {
  let x = 0; let y = 0; let s = '';
  names.forEach((name, j) => {
    const width = 12 + name.length * 3.8 + 10;
    if (x > 0 && x + width > w) { x = 0; y += 11; }
    s += `<rect x="${f(x)}" y="${f(y)}" width="7" height="7" fill="${paints[j].fill}" stroke="${paints[j].stroke === 'none' ? paints[j].fill : paints[j].stroke}" stroke-width="0.4"/>`;
    s += txt(x + 10, y + 6.2, name);
    x += width;
  });
  return { svg: s, w, h: y + 9 };
}

/** `Name (n = 12)` cut to `max` characters by shortening the name, never the count. */
function headerOf(s: Ser, max: number): string {
  const tail = s.n !== undefined ? ` (n = ${s.n.toLocaleString('en')})` : '';
  return `${shorten(s.name, Math.max(6, max - tail.length))}${tail}`;
}

const nameOf = (s: Ser): string => (s.n !== undefined ? `${s.name} (n = ${s.n.toLocaleString('en')})` : s.name);

/** One or several histograms in one block: a grid (plain or side-by-side bars) or a facet grid (a panel per group). */
function composeBars(panels: BarsView[], style: FigureStyle, lettered: boolean, width: number): Block {
  const first = panels.find((p) => (p.series?.length ?? 0) > 1);
  const k = first?.series?.length ?? 0;
  const mode: 'plain' | 'grouped' | 'facet' = !first ? 'plain' : style.groups === 'grouped' && k <= (style.colour ? 8 : 4) ? 'grouped' : 'facet';
  let s = '';
  let y = 0;
  const share = style.value === 'share';

  if (mode !== 'facet') {
    const paints = Array.from({ length: Math.max(1, k) }, (_, j) => paint(style, mode === 'grouped' ? 'grouped' : 'plain', j));
    if (mode === 'grouped') {
      const lg = legendRow(first!.series!.map((x) => nameOf({ name: x.name, n: x.n, raw: [], values: [] })), paints, width);
      s += lg.svg;
      y += lg.h + 8;
    }
    const cols = panels.length > 1 && width >= 300 ? 2 : 1;
    const gap = 14;
    const cw = (width - (cols - 1) * gap) / cols;
    for (let i = 0; i < panels.length; i += cols) {
      let rowH = 0;
      for (let c = 0; c < cols && i + c < panels.length; c++) {
        const p = panels[i + c];
        const sers = mode === 'grouped' && p.series ? seriesOf(p, style) : seriesOf({ ...p, series: undefined }, style);
        const yMax = Math.max(1e-9, ...sers.flatMap((x) => x.values));
        const blk = columnChart(p, { w: cw, plotH: 70, series: sers, paints, yMax, showYLabels: true, yTitle: yTitleOf(p, style), xLabels: true, tooltips: style.tooltips, share });
        s += place(c * (cw + gap), y, txt(0, 8, panelTitle(p.title, i + c, lettered), { size: TITLE, bold: true }) + place(0, 13, blk.svg));
        rowH = Math.max(rowH, blk.h + 13);
      }
      y += rowH + 10;
    }
    return { svg: s, w: width, h: Math.max(0, y - 10) };
  }

  // facet grid: a row of small panels per measure, one panel per group, one scale per measure
  const names = first!.series!.map((x) => nameOf({ name: x.name, n: x.n, raw: [], values: [] }));
  const perRow = Math.min(k, width >= 450 ? 4 : width >= 300 ? 3 : 2);
  const gap = 6;
  const bw = (width - (perRow - 1) * gap) / perRow;
  panels.forEach((p, pi) => {
    s += txt(0, y + 8, panelTitle(p.title, pi, lettered), { size: TITLE, bold: true });
    y += 13;
    const sers = seriesOf(p, style);
    const yMax = Math.max(1e-9, ...sers.flatMap((x) => x.values));
    for (let r = 0; r < k; r += perRow) {
      let rowH = 0;
      for (let c = 0; c < perRow && r + c < k; c++) {
        const j = r + c;
        const one: Ser = sers[j] ?? { name: '', raw: [], values: [] };
        const blk = columnChart(p, {
          w: bw, plotH: 46, series: [one], paints: [paint(style, 'panel', j)], yMax, showYLabels: c === 0,
          yTitle: c === 0 ? yTitleOf(p, style) : '', xLabels: true, tooltips: style.tooltips, share,
        });
        s += place(c * (bw + gap), y, txt(LEFT, 7, headerOf(sers[j] ?? { name: names[j], raw: [], values: [] }, Math.floor((bw - LEFT) / 3.7)), { bold: true }) + place(0, 10, blk.svg));
        rowH = Math.max(rowH, blk.h + 10);
      }
      y += rowH + 4;
    }
    y += 8;
  });
  return { svg: s, w: width, h: Math.max(0, y - 8) };
}

// ── scatter plot ───────────────────────────────────────────────────────────────

function marker(shape: (typeof SHAPES)[number], cx: number, cy: number, paintOf: Paint, title: string): string {
  const r = 3;
  const common = `fill="${paintOf.fill}" stroke="${paintOf.stroke === 'none' ? paintOf.fill : INK}" stroke-width="0.6"`;
  const t = title ? `<title>${esc(title)}</title>` : '';
  switch (shape) {
    case 'circle': return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" ${common}>${t}</circle>`;
    case 'square': return `<rect x="${f(cx - r)}" y="${f(cy - r)}" width="${2 * r}" height="${2 * r}" ${common}>${t}</rect>`;
    case 'triangle': return `<polygon points="${f(cx)},${f(cy - r - 0.5)} ${f(cx + r + 0.5)},${f(cy + r)} ${f(cx - r - 0.5)},${f(cy + r)}" ${common}>${t}</polygon>`;
    case 'diamond': return `<polygon points="${f(cx)},${f(cy - r - 1)} ${f(cx + r + 1)},${f(cy)} ${f(cx)},${f(cy + r + 1)} ${f(cx - r - 1)},${f(cy)}" ${common}>${t}</polygon>`;
    case 'cross': return `<g stroke="${paintOf.stroke === 'none' ? paintOf.fill : INK}" stroke-width="1.1">${line(cx - r, cy - r, cx + r, cy + r, 1.1, paintOf.fill)}${line(cx - r, cy + r, cx + r, cy - r, 1.1, paintOf.fill)}${t}</g>`;
    default: return `<g>${line(cx - r - 0.5, cy, cx + r + 0.5, cy, 1.1, paintOf.fill)}${line(cx, cy - r - 0.5, cx, cy + r + 0.5, 1.1, paintOf.fill)}${t}</g>`;
  }
}

function scatterBlock(v: ScatterView, style: FigureStyle, width: number): Block {
  const w = Math.min(width, 380);
  const h = Math.round(w * 0.72);
  const left = 16; const bottom = 16; const top = 6; const right = 8;
  const groups = [...new Set(v.points.map((p) => p.group))];
  const xs = v.points.map((p) => p.x); const ys = v.points.map((p) => p.y);
  const lo = (a: number[]) => a.reduce((m, x) => Math.min(m, x), Infinity);
  const hi = (a: number[]) => a.reduce((m, x) => Math.max(m, x), -Infinity);
  const pw = w - left - right; const ph = h - top - bottom;
  const sx = (x: number) => left + 6 + ((x - lo(xs)) / ((hi(xs) - lo(xs)) || 1)) * (pw - 12);
  const sy = (y: number) => top + ph - 6 - ((y - lo(ys)) / ((hi(ys) - lo(ys)) || 1)) * (ph - 12);
  let s = line(left, top, left, top + ph) + line(left, top + ph, left + pw, top + ph);
  s += txt(left + pw / 2, top + ph + 12, 'Dimension 1', { anchor: 'middle' }) + txt(8, top + ph / 2, 'Dimension 2', { anchor: 'middle', rotate: -90 });
  // Six marker shapes tell at most six groups apart; with more groups every point is a circle and its label names it.
  const shapes = groups.length > 1 && groups.length <= SHAPES.length;
  const paintOf = (g: string): Paint => (style.colour && shapes ? { fill: COLOURS[groups.indexOf(g) % COLOURS.length], stroke: 'none' } : { fill: INK, stroke: INK });
  for (const p of v.points) {
    const shape = shapes ? SHAPES[groups.indexOf(p.group)] : 'circle';
    s += marker(shape, sx(p.x), sy(p.y), paintOf(p.group), style.tooltips ? p.label : '');
    if (v.points.length <= 30) s += txt(sx(p.x) + 5, sy(p.y) + 2.5, shorten(p.label, 18), { size: 6.5 });
  }
  let hh = h;
  if (shapes) {
    let x = left; let y = h + 6;
    groups.forEach((g, i) => {
      const width2 = 14 + g.length * 3.8 + 8;
      if (x > left && x + width2 > w) { x = left; y += 11; }
      s += marker(SHAPES[i % SHAPES.length], x + 3, y + 3, paintOf(g), '') + txt(x + 10, y + 5.5, g);
      x += width2;
    });
    hh = y + 11;
  }
  return { svg: s, w, h: hh };
}

// ── dendrogram ─────────────────────────────────────────────────────────────────

function treeBlock(v: TreeView, width: number): Block {
  const n = v.leaves.length;
  if (n === 0) return { svg: '', w: width, h: 10 };
  const rowH = 9;
  const labelW = Math.min(120, Math.max(...v.leaves.map((l) => l.length)) * 3.7 + 8);
  const plotW = Math.max(60, width - labelW - 6);
  const maxH = Math.max(...v.merges.map((m) => m.height), 1e-9);
  const height = n * rowH + 24;
  const pos = new Map<number, { x: number; y: number }>();
  const order: number[] = [];
  const visit = (id: number): void => { if (id < n) { order.push(id); return; } const m = v.merges[id - n]; visit(m.a); visit(m.b); };
  visit(v.merges.length ? n + v.merges.length - 1 : 0);
  let s = '';
  order.forEach((leaf, i) => {
    pos.set(leaf, { x: plotW, y: 5 + i * rowH });
    s += txt(plotW + 4, 5 + i * rowH + 2.5, shorten(v.leaves[leaf], 24));
  });
  v.merges.forEach((m, i) => {
    const a = pos.get(m.a)!; const b = pos.get(m.b)!;
    const x = plotW - (m.height / maxH) * (plotW - 6);
    s += line(a.x, a.y, x, a.y) + line(b.x, b.y, x, b.y) + line(x, a.y, x, b.y);
    pos.set(n + i, { x, y: (a.y + b.y) / 2 });
  });
  const axisY = n * rowH + 8;
  s += line(plotW - (plotW - 6), axisY, plotW, axisY);
  for (const t of niceTicks(maxH, 4)) {
    if (t > maxH * 1.0001) continue;
    const x = plotW - (t / maxH) * (plotW - 6);
    s += line(x, axisY, x, axisY + 2) + txt(x, axisY + 10, String(Math.round(t * 100) / 100), { anchor: 'middle' });
  }
  return { svg: s, w: width, h: height };
}

// ── heat map ───────────────────────────────────────────────────────────────────

const grey = (t: number): string => { const v = Math.round(255 - Math.max(0, Math.min(1, t)) * 225); return `rgb(${v},${v},${v})`; };

function matrixBlock(v: MatrixView, width: number): Block {
  const rows = v.rowLabels.length; const cols = v.colLabels.length;
  if (!rows || !cols) return { svg: '', w: width, h: 10 };
  const labelW = Math.min(110, Math.max(...v.rowLabels.map((l) => l.length)) * 3.6 + 6);
  const colLab = Math.min(70, Math.max(...v.colLabels.map((l) => l.length)) * 3.6 + 6);
  const cell = Math.max(4, Math.min(20, (width - labelW) / cols));
  let lo = Infinity; let hi = -Infinity;
  for (const r of v.values) for (const x of r) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const strength = (x: number): number => { const t = hi > lo ? (x - lo) / (hi - lo) : 0; return v.lowIsClose ? 1 - t : t; };
  let s = '';
  v.colLabels.forEach((c, j) => { s += txt(labelW + j * cell + cell / 2 + 2.5, colLab - 3, shorten(c, 18), { rotate: -90 }); });
  v.rowLabels.forEach((r, i) => {
    s += txt(labelW - 3, colLab + i * cell + cell / 2 + 2.5, shorten(r, 24), { anchor: 'end' });
    v.values[i].forEach((x, j) => {
      const t = strength(x);
      s += `<rect x="${f(labelW + j * cell)}" y="${f(colLab + i * cell)}" width="${f(cell)}" height="${f(cell)}" fill="${grey(t)}" stroke="#ffffff" stroke-width="0.5"/>`;
      if (cell >= 14 && cols <= 24) s += txt(labelW + j * cell + cell / 2, colLab + i * cell + cell / 2 + 2.3, x.toFixed(Math.min(2, v.digits)), { size: 6, anchor: 'middle', fill: t > 0.55 ? '#ffffff' : INK });
    });
  });
  const ly = colLab + rows * cell + 10;
  s += txt(labelW, ly + 6, String(v.lowIsClose ? hi : lo), { size: 6.5 });
  for (let i = 0; i < 7; i++) s += `<rect x="${f(labelW + 22 + i * 10)}" y="${f(ly)}" width="10" height="7" fill="${grey(i / 6)}" stroke="${INK}" stroke-width="0.3"/>`;
  s += txt(labelW + 22 + 7 * 10 + 4, ly + 6, `${v.lowIsClose ? lo : hi}  ${v.lowIsClose ? '(far to close)' : '(low to high)'}`, { size: 6.5 });
  return { svg: s, w: width, h: ly + 12 };
}

// ── entry point ────────────────────────────────────────────────────────────────

function wrap(block: Block, title: string, description: string, style: FigureStyle): RenderedFigure {
  const w = block.w + 2 * MARGIN; const h = block.h + 2 * MARGIN;
  const head = style.tooltips ? `<title>${esc(title)}</title>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" role="img" aria-label="${esc(title)}">${head}${place(MARGIN, MARGIN, block.svg)}</svg>`;
  return { svg, width: w, height: h, description };
}

/** True for the views that can be drawn as a figure (histograms over an axis, scatter plots, dendrograms, heat maps, figures). */
export function isFigureView(v: ResultView): boolean {
  return v.kind === 'figure' || v.kind === 'scatter' || v.kind === 'tree' || v.kind === 'matrix' || (v.kind === 'bars' && (v.layout ?? 'rows') === 'columns');
}

/** Number of groups drawn side by side or as panels in a view (1 when the view has no groups). */
export function groupCount(v: ResultView): number {
  const bars = v.kind === 'figure' ? v.panels : v.kind === 'bars' ? [v] : [];
  return Math.max(1, ...bars.map((b) => b.series?.length ?? 0));
}

/** Draws a view as an SVG document; `null` for views that are not figures (tables, rankings, text). */
export function renderViewSvg(view: ResultView, style: FigureStyle = DEFAULT_FIGURE_STYLE): RenderedFigure | null {
  const width = Math.max(120, style.widthMm * MM_TO_PT - 2 * MARGIN);
  if (view.kind === 'figure') return wrap(composeBars(view.panels, style, view.panels.length > 1, width), view.title, view.caption, style);
  if (view.kind === 'bars' && (view.layout ?? 'rows') === 'columns') {
    return wrap(composeBars([view], style, false, width), view.title, `${view.title}: ${view.items.length} categories.`, style);
  }
  if (view.kind === 'scatter') return wrap(scatterBlock(view, style, width), view.title, `${view.title}: ${view.points.length} points.`, style);
  if (view.kind === 'tree') return wrap(treeBlock(view, width), view.title, `${view.title}: dendrogram of ${view.leaves.length} leaves.`, style);
  if (view.kind === 'matrix') return wrap(matrixBlock(view, width), view.title, `${view.title}: ${view.rowLabels.length} by ${view.colLabels.length} matrix.`, style);
  return null;
}

