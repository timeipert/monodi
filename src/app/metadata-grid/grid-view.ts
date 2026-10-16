import { compareNatural } from '../../utils';
import { ANY_COLUMN, CompiledFilter, GridFilter, compileFilter } from './grid-filter';

export interface GridColumn {
  key: string;
  label: string;
  width: number;
}

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
}
