import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DEFAULT_FIGURE_STYLE, FIGURE_WIDTHS_MM, cellText, groupCount, isFigureView, isNotationCell, niceTicks, renderViewSvg, tableToCsv, tickLabel } from '@monodi/core/analysis';
import type { BarsView, Cell, FigureStyle, FigureView, MatrixView, NotationCell, PatternUnit, RenderedFigure, ResultView, TableView } from '@monodi/core/analysis';
import { downloadBlob } from '../download';
import { svgToBlob, svgToPdf, svgToPng } from './figure-export';

export { niceTicks, tickLabel };

/** Grey ramp (light to dark) for heat maps: the shade carries the value, so no colour is needed. */
const GREY_RAMP = ['#f2f2f2', '#d9d9d9', '#bfbfbf', '#8c8c8c', '#666666', '#404040', '#1a1a1a'];

export interface RowBar { label: string; notation?: NotationCell['notation']; value: number; pct: number }

export type FigureFormat = 'svg' | 'png' | 'pdf';

/**
 * Draws one result view of any method: a table (filter, sort, page, notes in cells, CSV), a histogram or a ranking, a
 * heat map, a dendrogram, a scatter plot or text. Methods return plain data (see `@monodi/core/analysis`
 * `ResultView`), so a new method needs no component. Charts are drawn by `renderViewSvg` (core) in black and white, with
 * colour only as an option to tell groups apart; the SVG on the screen is the one that is downloaded as SVG, PNG (transparent)
 * or PDF.
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
  rankRows: RowBar[] = [];
  showData = false;

  /** How a chart is drawn; the start values depend on the view (see `startStyle`). */
  style: FigureStyle = { ...DEFAULT_FIGURE_STYLE };
  readonly widths = FIGURE_WIDTHS_MM;
  /** The drawn figure as markup (built by `renderViewSvg` from escaped text only), or null for views that are not figures. */
  figureHtml: SafeHtml | null = null;
  private figure: RenderedFigure | null = null;
  groups = 1;
  exporting = '';
  exportError = '';

  constructor(private readonly sanitizer: DomSanitizer) {}

  ngOnChanges(): void {
    this.sortCol = -1;
    this.page = 0;
    this.textFilter = '';
    this.showData = false;
    this.exportError = '';
    const v = this.view;
    if (v.kind === 'table') this.prepareTable(v);
    else if (v.kind === 'bars') this.prepareBars(v);
    if (isFigureView(v) && !(v.kind === 'bars' && (v.layout ?? 'rows') !== 'columns')) {
      this.groups = groupCount(v);
      this.style = this.startStyle(v);
      this.draw();
    } else {
      this.figureHtml = null;
      this.figure = null;
    }
  }

  /** A composite figure starts at page width, a single chart at one and a half columns; groups start as shares in panels. */
  private startStyle(v: ResultView): FigureStyle {
    return { ...DEFAULT_FIGURE_STYLE, widthMm: v.kind === 'figure' ? 175 : 120, value: groupCount(v) > 1 ? 'share' : 'count' };
  }

  /** Change one or more style options and draw the figure again. */
  setStyle(change: Partial<FigureStyle>): void {
    this.style = { ...this.style, ...change };
    this.draw();
  }

  private draw(): void {
    this.figure = renderViewSvg(this.view, this.style);
    this.figureHtml = this.figure ? this.sanitizer.bypassSecurityTrustHtml(this.figure.svg) : null;
  }

  /** The drawn size on the screen in CSS pixels (1 pt = 4/3 px), so a figure is as large as it will be on paper. */
  get figurePx(): number { return this.figure ? Math.round((this.figure.width * 4) / 3) : 0; }
  get isFigure(): boolean { return this.figure !== null; }
  get figureView(): FigureView | null { return this.view.kind === 'figure' ? this.view : null; }
  /** The panels of the view when it is a histogram or a figure of histograms. */
  get panels(): BarsView[] { return this.view.kind === 'figure' ? this.view.panels : this.view.kind === 'bars' ? [this.view] : []; }

  /** Download the figure as it is drawn; PNG at 300 dpi. */
  async download(format: FigureFormat): Promise<void> {
    if (!this.figure) return;
    this.exporting = format;
    this.exportError = '';
    try {
      // Files carry no tooltips (`<title>` elements), which a PDF or a program reading the SVG has no use for.
      const file = renderViewSvg(this.view, { ...this.style, tooltips: false })!;
      const name = `${this.fileStem}-${slug(this.view.title)}`;
      if (format === 'svg') downloadBlob(svgToBlob(file.svg), `${name}.svg`);
      else if (format === 'png') downloadBlob(await svgToPng(file.svg, file.width, file.height, 300), `${name}.png`);
      else downloadBlob(await svgToPdf(file.svg, file.width, file.height), `${name}.pdf`);
    } catch (e) {
      this.exportError = (e as Error)?.message ?? String(e);
    } finally {
      this.exporting = '';
    }
  }

  /** Copy the caption of a figure to the clipboard. */
  async copyCaption(): Promise<void> {
    const c = this.figureView?.caption;
    if (c && navigator.clipboard) await navigator.clipboard.writeText(c);
  }

  get table(): TableView | null { return this.view.kind === 'table' ? this.view : null; }
  get matrix(): MatrixView | null { return this.view.kind === 'matrix' ? this.view : null; }
  get bars(): BarsView | null { return this.view.kind === 'bars' ? this.view : null; }

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

  // ── bars: rankings (histograms are drawn by the figure renderer) ─────────
  private prepareBars(b: BarsView): void {
    this.rankRows = [];
    if ((b.layout ?? 'rows') === 'columns') return;
    const max = Math.max(1, ...b.items.map((i) => i.value));
    this.rankRows = b.items.map((i) => ({ label: i.label, notation: i.notation, value: i.value, pct: (i.value / max) * 100 }));
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
  get rampGradient(): string { return `linear-gradient(to right, ${GREY_RAMP.join(', ')})`; }
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
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table';
}

/** Interpolate the grey ramp at `t` in 0…1. */
export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (GREY_RAMP.length - 1);
  const i = Math.min(GREY_RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(GREY_RAMP[i]); const b = hexToRgb(GREY_RAMP[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
function hexToRgb(h: string): number[] { return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)); }
