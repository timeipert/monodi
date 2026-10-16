import { compareNatural } from '../../utils';
import { MetadataPatch } from '../metadata-patch';
import { ANY_COLUMN, CompiledFilter, GridFilter, compileFilter } from './grid-filter';

export interface GridColumn {
  key: string;
  label: string;
  width: number;
  /** `false` for columns that are computed (a document count) or must not change here. Default: editable. */
  editable?: boolean;
  /** An empty value is refused (a document without an ID, a source without a siglum). */
  required?: boolean;
}

/** One cell, addressed by its position in the displayed rows (`pos`) and its column index. */
export interface CellPos { pos: number; ci: number }

export interface CellChange { row: number; ci: number; value: string }

/** What a bulk write did: written, refused (read-only column, empty value in a required one), outside the table. */
export interface EditResult { applied: number; rejected: number; outside: number }

interface EditGroup { changes: { row: number; ci: number; from: string; to: string }[] }

/** One row as the grid is fed: `cells` line up with the columns. */
export interface GridRowInput {
  id: string;
  /** What the rows are grouped by in the delete summary (a document's source); '' when there is no grouping. */
  group: string;
  cells: string[];
}

/**
 * The table behind the metadata grid: column-wise values (`values[column][row]`, built once), the filters on
 * them, the sort, and the selection. `viewIdx` is the rows that pass the filters, in display order.
 *
 * Rows are addressed by their index in the data this view was built from. Reloading the data builds a new view
 * (`adopt` carries the filters and sort over), so an index never outlives the data it points into.
 */
export class GridView {
  readonly ids: string[];
  readonly groups: string[];
  /** `values[c][r]`: the cell of column `c` in row `r`. */
  readonly values: string[][];
  /** Width of a row in px: the columns plus the selection and open columns in front. */
  readonly totalWidth: number;

  filters: GridFilter[] = [];
  quick = '';
  sortKey: string | undefined;
  sortDescending = false;

  /** Row indices that pass the filters, sorted. A field, replaced (never mutated) by `refresh`. */
  viewIdx: number[] = [];
  /** Filters that did not compile, by filter id (an invalid regular expression). */
  filterErrors = new Map<number, string>();

  /** Selected row indices. Always a subset of `viewIdx` after `refresh`: nothing the user cannot see stays selected. */
  readonly selected = new Set<number>();

  private lowerCache = new Map<number, string[]>();
  private nextFilterId = 1;
  private lastToggledPos = -1;

  constructor(readonly columns: GridColumn[], rows: GridRowInput[], defaultSortKey?: string) {
    this.ids = rows.map((r) => r.id);
    this.groups = rows.map((r) => r.group);
    this.values = columns.map((_, c) => rows.map((r) => r.cells[c] ?? ''));
    this.totalWidth = GridView.LEADING_WIDTH + columns.reduce((sum, c) => sum + c.width, 0);
    this.sortKey = defaultSortKey;
    this.refresh();
  }

  /** The selection checkbox and the "open" button in front of the columns. */
  static readonly LEADING_WIDTH = 76;

  get rowCount(): number {
    return this.ids.length;
  }

  /** The filters, the quick search and the sort of an earlier view of the same kind of data. */
  adopt(old: GridView): void {
    const keys = new Set(this.columns.map((c) => c.key));
    this.filters = old.filters.filter((f) => f.column === ANY_COLUMN || keys.has(f.column)).map((f) => ({ ...f }));
    this.nextFilterId = Math.max(old.nextFilterId, ...this.filters.map((f) => f.id + 1));
    this.quick = old.quick;
    this.sortKey = old.sortKey && keys.has(old.sortKey) ? old.sortKey : undefined;
    this.sortDescending = old.sortDescending;
    this.refresh();
  }

  // --- filters ---

  addFilter(partial: Partial<Omit<GridFilter, 'id'>> = {}): GridFilter {
    const f: GridFilter = {
      id: this.nextFilterId++,
      column: partial.column ?? ANY_COLUMN,
      op: partial.op ?? 'contains',
      value: partial.value ?? '',
      caseSensitive: partial.caseSensitive ?? false,
    };
    this.filters = [...this.filters, f];
    return f;
  }

  removeFilter(id: number): void {
    this.filters = this.filters.filter((f) => f.id !== id);
    this.refresh();
  }

  clearFilters(): void {
    this.filters = [];
    this.quick = '';
    this.refresh();
  }

  /** Number of rules that actually narrow the result (a rule without its value yet does not). */
  get activeFilterCount(): number {
    return this.filters.filter((f) => compileFilter(f).kind === 'test').length + (this.quick.trim() ? 1 : 0);
  }

  /** Recomputes `viewIdx` from the filters and the sort, and drops selected rows that fell out of view. */
  refresh(): void {
    const n = this.rowCount;
    this.filterErrors = new Map();
    const compiled: { filter: GridFilter; c: Extract<CompiledFilter, { kind: 'test' }> }[] = [];
    for (const f of this.filters) {
      const c = compileFilter(f);
      if (c.kind === 'error') this.filterErrors.set(f.id, c.message);
      else if (c.kind === 'test') compiled.push({ filter: f, c });
    }

    const idx: number[] = [];
    const allColumns = this.columns.map((_, i) => i);
    const quick = this.quick.trim().toLowerCase();
    const columnIndex = new Map(this.columns.map((c, i) => [c.key, i]));
    const rules = compiled.map(({ filter, c }) => ({
      c,
      cols: filter.column === ANY_COLUMN ? allColumns : columnIndex.has(filter.column) ? [columnIndex.get(filter.column)!] : [],
      unknownColumn: filter.column !== ANY_COLUMN && !columnIndex.has(filter.column),
    }));
    // make sure every lowercase column a rule needs exists before the row loop
    for (const r of rules) if (!r.c.caseSensitive) for (const ci of r.cols) this.lower(ci);
    if (quick) for (const ci of allColumns) this.lower(ci);

    rows:
    for (let r = 0; r < n; r++) {
      if (quick && !allColumns.some((ci) => this.lower(ci)[r].includes(quick))) continue;
      for (const rule of rules) {
        if (rule.unknownColumn) continue rows;   // a rule on a column that is gone matches nothing
        const hit = rule.cols.some((ci) => rule.c.test(this.values[ci][r], this.lower(ci)[r]));
        if (hit === rule.c.negate) continue rows;
      }
      idx.push(r);
    }

    this.viewIdx = this.sorted(idx);
    for (const r of Array.from(this.selected)) {
      if (!this.inView(r)) this.selected.delete(r);
    }
    this.lastToggledPos = -1;
    // cell positions are rows of the view as it was: after a new filter or sort they would point at other rows
    this.clearCellSelection();
  }

  private viewSet: Set<number> | null = null;
  private viewSetFor: number[] | null = null;
  private inView(r: number): boolean {
    if (this.viewSetFor !== this.viewIdx) {
      this.viewSet = new Set(this.viewIdx);
      this.viewSetFor = this.viewIdx;
    }
    return this.viewSet!.has(r);
  }

  private lower(ci: number): string[] {
    let l = this.lowerCache.get(ci);
    if (!l) {
      l = this.values[ci].map((v) => v.toLowerCase());
      this.lowerCache.set(ci, l);
    }
    return l;
  }

  // --- sorting ---

  /** none → ascending → descending → none, like the other tables. */
  sortBy(key: string): void {
    if (this.sortKey !== key) {
      this.sortKey = key;
      this.sortDescending = false;
    } else if (!this.sortDescending) {
      this.sortDescending = true;
    } else {
      this.sortKey = undefined;
      this.sortDescending = false;
    }
    this.refresh();
  }

  private sorted(idx: number[]): number[] {
    const ci = this.sortKey === undefined ? -1 : this.columns.findIndex((c) => c.key === this.sortKey);
    if (ci < 0) return idx;
    const col = this.values[ci];
    const m = this.sortDescending ? -1 : 1;
    // stable: equal cells keep the order the rows came in
    return idx.sort((a, b) => m * compareNatural(col[a], col[b]) || a - b);
  }

  // --- selection ---

  get selectedCount(): number {
    return this.selected.size;
  }

  /** Every row that passes the filters is selected (and there is at least one). */
  get allSelected(): boolean {
    return this.viewIdx.length > 0 && this.selected.size === this.viewIdx.length;
  }

  get someSelected(): boolean {
    return this.selected.size > 0 && !this.allSelected;
  }

  /** Header checkbox: select every row that passes the filters (all of them, not just the ones on screen), or none. */
  toggleAll(): void {
    if (this.allSelected) {
      this.selected.clear();
    } else {
      for (const r of this.viewIdx) this.selected.add(r);
    }
    this.lastToggledPos = -1;
  }

  clearSelection(): void {
    this.selected.clear();
    this.lastToggledPos = -1;
  }

  /** Row checkbox. With `range` the rows between the last toggled row and this one follow this one's new state. */
  toggleAt(pos: number, range = false): void {
    const r = this.viewIdx[pos];
    if (r === undefined) return;
    const select = !this.selected.has(r);
    if (range && this.lastToggledPos >= 0) {
      const [from, to] = this.lastToggledPos < pos ? [this.lastToggledPos, pos] : [pos, this.lastToggledPos];
      for (let p = from; p <= to; p++) {
        if (select) this.selected.add(this.viewIdx[p]);
        else this.selected.delete(this.viewIdx[p]);
      }
    } else if (select) {
      this.selected.add(r);
    } else {
      this.selected.delete(r);
    }
    this.lastToggledPos = pos;
  }

  /** Ids of the selected rows, in display order. */
  selectedIds(): string[] {
    return this.viewIdx.filter((r) => this.selected.has(r)).map((r) => this.ids[r]);
  }

  /** Selected rows per group, biggest first, for the "what am I about to delete" summary. */
  selectedByGroup(): { group: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const r of this.selected) counts.set(this.groups[r], (counts.get(this.groups[r]) ?? 0) + 1);
    return Array.from(counts, ([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || compareNatural(a.group, b.group));
  }

  /** The first `limit` values of a column among the selected rows, in display order. */
  selectedSample(key: string, limit: number): string[] {
    const ci = this.columns.findIndex((c) => c.key === key);
    if (ci < 0) return [];
    const out: string[] = [];
    for (const r of this.viewIdx) {
      if (!this.selected.has(r)) continue;
      out.push(this.values[ci][r]);
      if (out.length >= limit) break;
    }
    return out;
  }

  // --- cell cursor and range ---

  /** The cell the range starts at (where typing goes) and the one it was extended to. */
  anchor: CellPos | null = null;
  focusCell: CellPos | null = null;

  /** Moves the cursor to a cell; with `extend` the range from the old anchor to here is selected. */
  selectCell(pos: number, ci: number, extend = false): void {
    if (this.viewIdx.length === 0 || this.columns.length === 0) return;
    const cell = { pos: clamp(pos, 0, this.viewIdx.length - 1), ci: clamp(ci, 0, this.columns.length - 1) };
    if (extend && this.anchor) {
      this.focusCell = cell;
    } else {
      this.anchor = cell;
      this.focusCell = cell;
    }
  }

  /** Arrow keys: moves the cursor (or, with `extend`, the free end of the range) by a number of rows/columns. */
  moveCursor(dPos: number, dCi: number, extend = false): void {
    const from = extend ? this.focusCell : this.anchor;
    if (!from) { this.selectCell(0, 0); return; }
    this.selectCell(from.pos + dPos, from.ci + dCi, extend);
  }

  selectAllCells(): void {
    if (this.viewIdx.length === 0) return;
    this.anchor = { pos: 0, ci: 0 };
    this.focusCell = { pos: this.viewIdx.length - 1, ci: this.columns.length - 1 };
  }

  /** Ctrl+Space: the whole column of the rows that are shown. */
  selectColumn(ci: number): void {
    if (this.viewIdx.length === 0) return;
    const c = clamp(ci, 0, this.columns.length - 1);
    this.anchor = { pos: 0, ci: c };
    this.focusCell = { pos: this.viewIdx.length - 1, ci: c };
  }

  /** Shift+Space: the whole row. */
  selectRowCells(pos: number): void {
    if (this.viewIdx.length === 0) return;
    const p = clamp(pos, 0, this.viewIdx.length - 1);
    this.anchor = { pos: p, ci: 0 };
    this.focusCell = { pos: p, ci: this.columns.length - 1 };
  }

  clearCellSelection(): void {
    this.anchor = null;
    this.focusCell = null;
  }

  /** The selected block, in view positions, or null when no cell is selected. */
  range(): { p0: number; p1: number; c0: number; c1: number } | null {
    if (!this.anchor || !this.focusCell) return null;
    return {
      p0: Math.min(this.anchor.pos, this.focusCell.pos), p1: Math.max(this.anchor.pos, this.focusCell.pos),
      c0: Math.min(this.anchor.ci, this.focusCell.ci), c1: Math.max(this.anchor.ci, this.focusCell.ci),
    };
  }

  inRange(pos: number, ci: number): boolean {
    const r = this.range();
    return !!r && pos >= r.p0 && pos <= r.p1 && ci >= r.c0 && ci <= r.c1;
  }

  get rangeCellCount(): number {
    const r = this.range();
    return r ? (r.p1 - r.p0 + 1) * (r.c1 - r.c0 + 1) : 0;
  }

  /** The value of a cell at a position in the displayed rows. */
  cellValue(pos: number, ci: number): string {
    const row = this.viewIdx[pos];
    return row === undefined ? '' : this.values[ci][row];
  }

  /** The selected block as rows of values, for the clipboard. */
  rangeValues(): string[][] {
    const r = this.range();
    if (!r) return [];
    const out: string[][] = [];
    for (let p = r.p0; p <= r.p1; p++) {
      const line: string[] = [];
      for (let c = r.c0; c <= r.c1; c++) line.push(this.cellValue(p, c));
      out.push(line);
    }
    return out;
  }

  // --- edits ---

  /** Cells that differ from what was loaded (key = row * column count + column), and their original values. */
  private readonly dirty = new Set<number>();
  private readonly original = new Map<number, string>();
  private readonly dirtyRowCounts = new Map<number, number>();
  private undoStack: EditGroup[] = [];
  private redoStack: EditGroup[] = [];

  private cellKey(row: number, ci: number): number {
    return row * this.columns.length + ci;
  }

  get dirtyCount(): number {
    return this.dirty.size;
  }

  get dirtyRowCount(): number {
    return this.dirtyRowCounts.size;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  isDirty(row: number, ci: number): boolean {
    return this.dirty.has(this.cellKey(row, ci));
  }

  isEditable(ci: number): boolean {
    return this.columns[ci]?.editable !== false;
  }

  /**
   * Writes values into cells as one undo step. Cells whose column is read-only, or whose value would be empty in a
   * required column, are refused; cells that already have the value are skipped. Rows keep their place in the
   * view (the filters and the sort are not re-applied until the next `refresh`), like a spreadsheet.
   */
  setCells(changes: CellChange[]): EditResult {
    const group: EditGroup = { changes: [] };
    const result: EditResult = { applied: 0, rejected: 0, outside: 0 };
    for (const { row, ci, value } of changes) {
      const col = this.columns[ci];
      if (!col || row < 0 || row >= this.rowCount) { result.outside++; continue; }
      if (col.editable === false || (col.required && value.trim() === '')) { result.rejected++; continue; }
      const from = this.values[ci][row];
      if (from === value) continue;
      this.writeCell(row, ci, value);
      group.changes.push({ row, ci, from, to: value });
      result.applied++;
    }
    if (group.changes.length) {
      this.undoStack.push(group);
      this.redoStack = [];
    }
    return result;
  }

  /** Like `setCells`, with cells addressed by their position in the displayed rows. */
  setCellsAt(changes: { pos: number; ci: number; value: string }[]): EditResult {
    const rows: CellChange[] = [];
    let outside = 0;
    for (const c of changes) {
      const row = this.viewIdx[c.pos];
      if (row === undefined) outside++;
      else rows.push({ row, ci: c.ci, value: c.value });
    }
    const res = this.setCells(rows);
    res.outside += outside;
    return res;
  }

  private writeCell(row: number, ci: number, value: string): void {
    const key = this.cellKey(row, ci);
    const current = this.values[ci][row];
    if (!this.original.has(key)) this.original.set(key, current);
    this.values[ci][row] = value;
    const lower = this.lowerCache.get(ci);
    if (lower) lower[row] = value.toLowerCase();
    if (this.original.get(key) === value) {
      // back to what was loaded: not an edit any more
      this.original.delete(key);
      if (this.dirty.delete(key)) this.countRow(row, -1);
    } else if (!this.dirty.has(key)) {
      this.dirty.add(key);
      this.countRow(row, +1);
    }
  }

  private countRow(row: number, delta: number): void {
    const n = (this.dirtyRowCounts.get(row) ?? 0) + delta;
    if (n <= 0) this.dirtyRowCounts.delete(row);
    else this.dirtyRowCounts.set(row, n);
  }

  undo(): boolean {
    const g = this.undoStack.pop();
    if (!g) return false;
    for (let i = g.changes.length - 1; i >= 0; i--) this.writeCell(g.changes[i].row, g.changes[i].ci, g.changes[i].from);
    this.redoStack.push(g);
    return true;
  }

  redo(): boolean {
    const g = this.redoStack.pop();
    if (!g) return false;
    for (const c of g.changes) this.writeCell(c.row, c.ci, c.to);
    this.undoStack.push(g);
    return true;
  }

  /** Throws every edit away and shows the loaded values again. */
  discardEdits(): void {
    for (const [key, value] of this.original) {
      const cols = this.columns.length;
      const row = Math.floor(key / cols);
      const ci = key % cols;
      this.values[ci][row] = value;
      const lower = this.lowerCache.get(ci);
      if (lower) lower[row] = value.toLowerCase();
    }
    this.original.clear();
    this.dirty.clear();
    this.dirtyRowCounts.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.refresh();
  }

  /** The edits per row, as the API takes them. Only fields that differ from what was loaded. */
  changes(): MetadataPatch[] {
    const byRow = new Map<number, Record<string, string>>();
    const cols = this.columns.length;
    for (const key of this.dirty) {
      const row = Math.floor(key / cols);
      const ci = key % cols;
      let fields = byRow.get(row);
      if (!fields) byRow.set(row, (fields = {}));
      fields[this.columns[ci].key] = this.values[ci][row];
    }
    return Array.from(byRow, ([row, fields]) => ({ id: this.ids[row], fields }));
  }

  // --- clipboard-style bulk writes on the range ---

  /**
   * Paste: a block of values goes in at the top-left of the range. One value pasted over a bigger range fills the
   * whole range with it. What would fall outside the table is skipped (and counted).
   */
  pasteMatrix(matrix: string[][]): EditResult {
    const r = this.range();
    if (!r || matrix.length === 0) return { applied: 0, rejected: 0, outside: 0 };
    const changes: { pos: number; ci: number; value: string }[] = [];
    if (matrix.length === 1 && matrix[0].length === 1) {
      for (let p = r.p0; p <= r.p1; p++) for (let c = r.c0; c <= r.c1; c++) changes.push({ pos: p, ci: c, value: matrix[0][0] });
    } else {
      matrix.forEach((line, dr) => line.forEach((value, dc) => changes.push({ pos: r.p0 + dr, ci: r.c0 + dc, value })));
    }
    return this.setCellsAt(changes);
  }

  /** Writes one value into every cell of the range (Ctrl+Enter while editing). */
  fillRange(value: string): EditResult {
    return this.pasteMatrix([[value]]);
  }

  /** Delete key: empties the cells of the range (required columns refuse). */
  clearRange(): EditResult {
    return this.fillRange('');
  }

  /** Ctrl+D: the top row of the range is copied down over the rest of it, column by column. */
  fillDown(): EditResult {
    const r = this.range();
    if (!r || r.p0 === r.p1) return { applied: 0, rejected: 0, outside: 0 };
    const changes: { pos: number; ci: number; value: string }[] = [];
    for (let c = r.c0; c <= r.c1; c++) {
      const value = this.cellValue(r.p0, c);
      for (let p = r.p0 + 1; p <= r.p1; p++) changes.push({ pos: p, ci: c, value });
    }
    return this.setCellsAt(changes);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
