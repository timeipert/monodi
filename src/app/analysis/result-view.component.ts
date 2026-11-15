import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { cellText, isNotationCell, tableToCsv } from '@monodi/core/analysis';
import type { BarsView, Cell, MatrixView, NotationCell, PatternUnit, ResultView, ScatterView, TableView, TreeView } from '@monodi/core/analysis';
import { downloadBlob } from '../download';

/** Sequential blue ramp (steps 100 … 700 of the reference palette) for heat maps. */
const BLUE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export interface ColumnBar { x: number; y: number; w: number; h: number; path: string; label: string; value: number; peak: boolean; tip: string }
export interface ColumnChart {
  width: number; height: number; baseY: number; left: number;
  bars: ColumnBar[];
  yTicks: { y: number; label: string }[];
  xLabels: { x: number; text: string; rotate: boolean }[];
  unit: string;
}
export interface RowBar { label: string; notation?: NotationCell['notation']; value: number; pct: number }

interface Tip { x: number; y: number; text: string }

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
  return String(v);
}

/**
 * Draws one result view of any method: a table (filter, sort, page, notes in cells, CSV), a histogram or a ranking, a
 * heat map, a dendrogram, a scatter plot or text. Methods return plain data (see `@monodi/core/analysis`
 * `ResultView`), so a new method needs no component. Marks follow the reference chart rules: thin columns with a 2 px
 * gap and a rounded data end, hairline grid, one sequential blue, values at the tip or on the peak only.
 */
@Component({
  selector: 'app-result-view',
  standalone: false,
  templateUrl: './result-view.component.html',
  styleUrls: ['./result-view.component.css'],
})
export class ResultViewComponent implements OnChanges {
  @Input() view!: ResultView;
  /** Used for file names of downloads. */
  @Input() fileStem = 'analysis';
  /** The user asked to open documents (those behind one row, or behind all rows that pass the filter) in the search. */
  @Output() openDocs = new EventEmitter<string[]>();
  /** The user clicked the notes of a pattern: search the corpus for it. */
  @Output() searchPattern = new EventEmitter<{ unit: PatternUnit; text: string }>();

  // ── table state ──
  textFilter = '';
  colFilters: string[] = [];
  showColFilters = false;
  sortCol = -1;
  sortAsc = true;
  page = 0;
  readonly pageSize = 25;
  rows: Cell[][] = [];
  order: number[] = [];
  private rowText: string[] = [];
  /** The column that gets bars inside its cells (the first numeric one that is not a rank or an id), or -1. */
  barCol = -1;
  barMax = 0;

  // ── charts ──
  columns: ColumnChart | null = null;
  rankRows: RowBar[] = [];
  tip: Tip | null = null;
  showData = false;

  // dendrogram and scatter layout
  treeLinks: { x1: number; y1: number; x2: number; y2: number }[] = [];
  treeLeaves: { x: number; y: number; label: string }[] = [];
  treeTicks: { x: number; label: string }[] = [];
  treeHeight = 0;
  readonly treeWidth = 620;
  scatter: { x: number; y: number; label: string }[] = [];
  readonly plot = { w: 460, h: 320, pad: 26 };

  ngOnChanges(): void {
    this.sortCol = -1;
    this.page = 0;
    this.tip = null;
    this.textFilter = '';
    this.showData = false;
    const v = this.view;
    if (v.kind === 'table') this.prepareTable(v);
    else if (v.kind === 'bars') this.prepareBars(v);
    else if (v.kind === 'tree') this.layoutTree(v);
    else if (v.kind === 'scatter') this.layoutScatter(v);
  }

  get table(): TableView | null { return this.view.kind === 'table' ? this.view : null; }
  get matrix(): MatrixView | null { return this.view.kind === 'matrix' ? this.view : null; }
  get bars(): BarsView | null { return this.view.kind === 'bars' ? this.view : null; }

  // ── tooltip ─────────────────────────────────────────────────────────────
  showTip(ev: MouseEvent, text: string): void {
    const box = (ev.currentTarget as Element).closest('.rv-chart')?.getBoundingClientRect();
    if (!box) return;
    this.tip = { x: ev.clientX - box.left + 12, y: ev.clientY - box.top - 8, text };
  }
  hideTip(): void { this.tip = null; }

  // ── table ───────────────────────────────────────────────────────────────
  private prepareTable(t: TableView): void {
    this.rows = t.rows;
    this.rowText = t.rows.map((r) => r.map(cellText).join(' ').toLowerCase());
    this.colFilters = t.columns.map(() => '');
    this.barCol = t.columns.length < 3 || t.rows.length < 4 ? -1 : t.columns.findIndex((c) => c.numeric && c.key !== 'rank' && !/(^|\s)(#|id)($|\s)/i.test(c.label));
    this.barMax = 0;
    if (this.barCol >= 0) for (const r of t.rows) { const v = r[this.barCol]; if (typeof v === 'number' && v > this.barMax) this.barMax = v; }
    this.refresh();
  }

  /** Apply the filters and the sort. */
  refresh(): void {
    const t = this.table;
    if (!t) return;
    const terms = this.textFilter.toLowerCase().split(/\s+/).filter(Boolean);
    const min = t.columns.map((c, i) => (c.numeric && this.colFilters[i]?.trim() ? Number(this.colFilters[i]) : NaN));
    this.order = [];
    this.rows.forEach((r, i) => {
      if (terms.length && !terms.every((term) => this.rowText[i].includes(term))) return;
      for (let c = 0; c < t.columns.length; c++) {
        const f = this.colFilters[c]?.trim();
        if (!f) continue;
        if (t.columns[c].numeric) {
          const v = r[c];
          if (!Number.isNaN(min[c]) && !(typeof v === 'number' && v >= min[c])) return;
        } else if (!cellText(r[c]).toLowerCase().includes(f.toLowerCase())) return;
      }
      this.order.push(i);
    });
    this.applySort();
    this.page = 0;
  }

  private applySort(): void {
    if (this.sortCol < 0) return;
    const col = this.sortCol;
    const dir = this.sortAsc ? 1 : -1;
    this.order.sort((a, b) => {
      const x = this.rows[a][col];
      const y = this.rows[b][col];
      if (x === y) return a - b;
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : cellText(x).localeCompare(cellText(y), undefined, { numeric: true })) * dir;
    });
  }

  sortBy(col: number): void {
    const t = this.table;
    if (!t) return;
    if (this.sortCol === col) this.sortAsc = !this.sortAsc; else { this.sortCol = col; this.sortAsc = !t.columns[col].numeric; }
    this.applySort();
    this.page = 0;
  }

  clearFilters(): void {
    this.textFilter = '';
    this.colFilters = this.colFilters.map(() => '');
    this.refresh();
  }

  get filtered(): boolean { return this.textFilter.trim() !== '' || this.colFilters.some((f) => f.trim() !== ''); }
  get pageRows(): number[] { return this.order.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize); }
  get pages(): number { return Math.max(1, Math.ceil(this.order.length / this.pageSize)); }

  isNotes(c: Cell): c is NotationCell { return isNotationCell(c); }
  text(c: Cell): string { return cellText(c); }

  /** The pattern of a notation cell as the search form wants it: pitch names, signed steps or contour letters. */
  clickNotes(c: NotationCell): void { this.clickPattern(c.text, c.notation.mode); }

  /** Emit a pattern given as text; steps made of u, d and r are a contour, other relative notes are intervals. */
  clickPattern(label: string, mode: 'pitch' | 'interval'): void {
    const text = label.replace(/\s*…$/, '');
    const unit: PatternUnit = mode === 'pitch' ? 'pitch' : /^[udr ]+$/.test(text) ? 'contour' : 'interval';
    this.searchPattern.emit({ unit, text });
  }

  barPct(ri: number): number {
    const v = this.barCol >= 0 ? this.rows[ri][this.barCol] : null;
    return typeof v === 'number' && this.barMax > 0 ? Math.max(0, Math.min(100, (v / this.barMax) * 100)) : 0;
  }

  rowDocs(i: number): string[] | null { return this.table?.rowDocs?.[i] ?? null; }

  /** The documents behind every row that passes the filter (at most 2,000). */
  get filteredDocs(): string[] {
    const t = this.table;
    if (!t?.rowDocs) return [];
    const out = new Set<string>();
    for (const i of this.order) for (const d of t.rowDocs[i] ?? []) { out.add(d); if (out.size >= 2000) return [...out]; }
    return [...out];
  }

  downloadCsv(): void {
    const t = this.table;
    if (!t) return;
    const kept = { columns: t.columns, rows: this.order.map((i) => t.rows[i]) };
    downloadBlob(new Blob([tableToCsv(kept)], { type: 'text/csv;charset=utf-8' }), `${this.fileStem}-${slug(t.title)}.csv`);
  }

  // ── bars: columns (histogram) and rows (ranking) ─────────────────────────
  private prepareBars(b: BarsView): void {
    this.columns = null;
    this.rankRows = [];
    const max = Math.max(1, ...b.items.map((i) => i.value));
    if ((b.layout ?? 'rows') === 'columns') this.columns = layoutColumns(b);
    else this.rankRows = b.items.map((i) => ({ label: i.label, notation: i.notation, value: i.value, pct: (i.value / max) * 100 }));
  }

  // ── matrix ──────────────────────────────────────────────────────────────
  private matrixRange(): [number, number] {
    const m = this.matrix;
    let lo = Infinity; let hi = -Infinity;
    if (m) for (const row of m.values) for (const x of row) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return [lo, hi];
  }

  /** 0 (weakest) … 1 (strongest) for a cell; for distances the smallest value is the strongest. */
  private strength(v: number): number {
    const [lo, hi] = this.matrixRange();
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    return this.matrix?.lowIsClose ? 1 - t : t;
  }

  cellColor(v: number): string { return rampColor(this.strength(v)); }
  cellInk(v: number): string { return this.strength(v) > 0.55 ? '#ffffff' : '#0b0b0b'; }
  get rampGradient(): string { return `linear-gradient(to right, ${BLUE_RAMP.join(', ')})`; }
  get matrixLow(): string { const [lo, hi] = this.matrixRange(); return String(this.matrix?.lowIsClose ? hi : lo); }
  get matrixHigh(): string { const [lo, hi] = this.matrixRange(); return String(this.matrix?.lowIsClose ? lo : hi); }

  downloadMatrix(): void {
    const m = this.matrix;
    if (!m) return;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [['', ...m.colLabels].map(esc).join(',')];
    m.rowLabels.forEach((l, i) => lines.push([esc(l), ...m.values[i].map(String)].join(',')));
    downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), `${this.fileStem}-${slug(m.title)}.csv`);
  }

  // ── dendrogram ──────────────────────────────────────────────────────────
  private layoutTree(t: TreeView): void {
    const n = t.leaves.length;
    this.treeLinks = []; this.treeLeaves = []; this.treeTicks = [];
    if (n === 0) return;
    const maxH = Math.max(...t.merges.map((m) => m.height), 1e-9);
    const rowH = 17;
    const plotW = this.treeWidth - 170;
    this.treeHeight = n * rowH + 34;
    const pos = new Map<number, { x: number; y: number }>();
    const order: number[] = [];
    const visit = (id: number) => { if (id < n) { order.push(id); return; } const m = t.merges[id - n]; visit(m.a); visit(m.b); };
    visit(t.merges.length ? n + t.merges.length - 1 : 0);
    order.forEach((leaf, i) => {
      pos.set(leaf, { x: plotW, y: 10 + i * rowH });
      this.treeLeaves.push({ x: plotW + 6, y: 10 + i * rowH + 4, label: t.leaves[leaf] });
    });
    t.merges.forEach((m, i) => {
      const a = pos.get(m.a)!; const b = pos.get(m.b)!;
      const x = plotW - (m.height / maxH) * (plotW - 8);
      this.treeLinks.push({ x1: a.x, y1: a.y, x2: x, y2: a.y }, { x1: b.x, y1: b.y, x2: x, y2: b.y }, { x1: x, y1: a.y, x2: x, y2: b.y });
      pos.set(n + i, { x, y: (a.y + b.y) / 2 });
    });
    for (const v of niceTicks(maxH, 4)) {
      if (v > maxH * 1.0001) continue;
      this.treeTicks.push({ x: plotW - (v / maxH) * (plotW - 8), label: String(Math.round(v * 100) / 100) });
    }
  }

  // ── scatter ─────────────────────────────────────────────────────────────
  private layoutScatter(s: ScatterView): void {
    const xs = s.points.map((p) => p.x); const ys = s.points.map((p) => p.y);
    const { w, h, pad } = this.plot;
    const lo = (a: number[]) => Math.min(...a); const hi = (a: number[]) => Math.max(...a);
    const sx = (v: number) => pad + ((v - lo(xs)) / ((hi(xs) - lo(xs)) || 1)) * (w - 2 * pad);
    const sy = (v: number) => h - pad - ((v - lo(ys)) / ((hi(ys) - lo(ys)) || 1)) * (h - 2 * pad);
    this.scatter = s.points.map((p) => ({ x: sx(p.x), y: sy(p.y), label: p.label }));
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table';
}

/** Interpolate the blue ramp at `t` in 0…1. */
export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (BLUE_RAMP.length - 1);
  const i = Math.min(BLUE_RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(BLUE_RAMP[i]); const b = hexToRgb(BLUE_RAMP[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
function hexToRgb(h: string): number[] { return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)); }

/**
 * Geometry of a histogram, kept small: columns at most 16 px wide with a 2 px gap, a rounded data end and a square base,
 * three hairlines (0, half, top), the value only on the peak, and about 100 px of height.
 */
export function layoutColumns(b: BarsView): ColumnChart {
  const n = b.items.length;
  const longest = Math.max(1, ...b.items.map((i) => i.label.length));
  // Few columns with short labels stay upright and get room for the labels; many, or long ones, are tilted.
  const rotate = n > 12 || (n > 6 && longest > 4);
  const left = rotate ? 40 : 28; const right = 6; const top = 12; const bottom = rotate ? 26 : 16;
  const slot = rotate ? Math.max(8, Math.min(20, 400 / Math.max(1, n))) : Math.max(18, Math.min(48, longest * 5.5 + 8));
  const plotW = Math.max(80, n * slot);
  const width = left + plotW + right;
  const height = top + 72 + bottom;
  const baseY = height - bottom;
  const max = Math.max(1, ...b.items.map((i) => i.value));
  const ticks = niceTicks(max, 2);
  const axisMax = ticks[ticks.length - 1] || max;
  const compact = axisMax >= 10000;
  const scale = (baseY - top) / axisMax;
  const peak = b.items.reduce((best, it, i) => (it.value > b.items[best].value ? i : best), 0);
  const bars: ColumnBar[] = b.items.map((it, i) => {
    const w = Math.min(16, slot - 2);
    const x = left + i * slot + (slot - w) / 2;
    const h = it.value * scale;
    const y = baseY - h;
    const r = Math.min(3, w / 2, h);
    const path = h <= 0 ? '' : `M${x},${baseY}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${baseY}Z`;
    return { x, y, w, h, path, label: it.label, value: it.value, peak: i === peak && n > 1, tip: `${it.label}: ${it.value.toLocaleString('en')}${b.unit ? ' ' + b.unit : ''}` };
  });
  const every = n > 40 ? Math.ceil(n / 20) : 1;
  const xLabels = b.items.map((it, i) => ({ x: left + i * slot + slot / 2, text: it.label, rotate })).filter((_, i) => i % every === 0);
  return { width, height, baseY, left, bars, yTicks: ticks.map((v) => ({ y: baseY - v * scale, label: tickLabel(v, compact) })), xLabels, unit: b.unit ?? '' };
}
