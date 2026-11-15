/**
 * What an analysis method returns and how it describes itself.
 *
 * A result is a list of *views*: plain JSON descriptions of a table, a bar chart, a matrix, a dendrogram, a scatter plot
 * or a block of text. The user interface renders every view with one generic component, so a new method needs no
 * Angular code, and a result can be stored, exported and compared without the code that made it.
 */
import type { Corpus, FieldOption } from './corpus';
import type { Uses } from './fingerprint';

/**
 * Notes inside a table cell, drawn as a small staff by the user interface.
 * `pitch`: `values` are diatonic indexes, drawn on a five-line staff with a clef (the pitches are absolute).
 * `interval`: `values` are the steps between consecutive notes, so there are `values.length + 1` notes; the staff has
 * no clef (only the shape and the sizes of the steps are meant), and the first note is placed near the middle.
 */
export interface NotationCell {
  notation: { mode: 'pitch' | 'interval'; values: number[]; /** True when the sequence was cut for display. */ more?: boolean };
  /** The same notes as text, for sorting, filtering and CSV export. */
  text: string;
}

export type Cell = string | number | null | NotationCell;

export function isNotationCell(c: Cell): c is NotationCell {
  return typeof c === 'object' && c !== null && 'notation' in c;
}

/** The text of a cell, whatever it holds. */
export function cellText(c: Cell): string {
  return c === null || c === undefined ? '' : isNotationCell(c) ? c.text : String(c);
}

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  /** Short explanation shown as a tooltip. */
  help?: string;
}

export interface TableView {
  kind: 'table';
  title: string;
  columns: Column[];
  rows: Cell[][];
  /** Rows before capping; `rows.length < totalRows` means the table was cut (see `truncated`). */
  totalRows: number;
  truncated: boolean;
  /** For each row, the documents behind it (at most `ROW_DOC_CAP`), so the user can open them in the search. */
  rowDocs?: (string[] | null)[];
  note?: string;
}

export interface BarsView {
  kind: 'bars';
  title: string;
  /** `columns`: a histogram over an ordered axis (pitch, interval, length); `rows`: a ranking, largest first. */
  layout?: 'columns' | 'rows';
  items: { label: string; value: number; /** Drawn instead of the label when present. */ notation?: NotationCell['notation'] }[];
  /** Unit shown after the value (`%`, `chants`). */
  unit?: string;
  /**
   * The same categories counted separately for each group of the corpus (`values[i]` belongs to `items[i]`). `items[i].value`
   * stays the total over all groups. With more than one series the renderer draws the groups as separate panels or as
   * side-by-side bars (see `FigureStyle`).
   */
  series?: { name: string; /** Chants (or other units) behind the series, shown next to its name. */ n?: number; values: number[] }[];
  note?: string;
}

export interface MatrixView {
  kind: 'matrix';
  title: string;
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
  digits: number;
  /** True when small values mean "close" (a distance), false for a similarity or a count. */
  lowIsClose?: boolean;
  note?: string;
}

/** A dendrogram: leaves are numbered 0…n-1; merge `i` joins nodes `a` and `b` into node `n + i` at `height`. */
export interface TreeView {
  kind: 'tree';
  title: string;
  leaves: string[];
  merges: { a: number; b: number; height: number }[];
  note?: string;
}

export interface ScatterView {
  kind: 'scatter';
  title: string;
  points: { label: string; x: number; y: number; group: string }[];
  note?: string;
}

export interface TextView {
  kind: 'text';
  title: string;
  paragraphs: string[];
}

/**
 * Several histograms drawn as one figure for a publication (panels a, b, c, ...), with a caption that can be pasted next to
 * it. Every panel is a `bars` view with `layout: 'columns'`; panels with `series` are drawn once per group.
 */
export interface FigureView {
  kind: 'figure';
  title: string;
  panels: BarsView[];
  /** A caption for the figure: what is shown, how many chants, which groups. */
  caption: string;
  note?: string;
}

export type ResultView = TableView | BarsView | MatrixView | TreeView | ScatterView | TextView | FigureView;

export interface MethodResult {
  /** One line telling what was computed, for the list of results and for citation. */
  summary: string;
  /** How many documents the method used (documents without notes or text are skipped by some methods). */
  docCount: number;
  views: ResultView[];
  /** Caveats the reader needs (skipped documents, caps, assumptions). */
  notes: string[];
}

export type ParamSpec =
  | { key: string; label: string; help: string; type: 'number'; min: number; max: number; step?: number }
  | { key: string; label: string; help: string; type: 'boolean' }
  | { key: string; label: string; help: string; type: 'select'; options: { value: string; label: string }[] }
  /** A grouping field of the corpus (source, genre, a custom key); `optional` adds an entry "no grouping". */
  | { key: string; label: string; help: string; type: 'field'; optional?: boolean }
  | { key: string; label: string; help: string; type: 'text'; placeholder?: string };

export type ParamValues = Record<string, number | boolean | string>;

/** How a method reports progress. It cannot be cancelled from inside: the caller ends the worker. */
export interface RunIo {
  progress(done: number, total: number): void;
}

export type MethodGroup = 'overview' | 'melody' | 'corpus' | 'chantdigger';

export interface AnalysisMethod {
  id: string;
  /** Bumped when the result for the same input and parameters changes; part of the cache key. */
  version: number;
  title: string;
  group: MethodGroup;
  /** Two sentences: what the method computes and which question it answers. */
  summary: string;
  /** Which digests of a document the method reads (decides what invalidates a stored result). */
  uses: Uses[];
  /** 1 = well under a second for 1,000 chants, 2 = seconds, 3 = can take minutes on tens of thousands. */
  cost: 1 | 2 | 3;
  params: ParamSpec[];
  defaults: ParamValues;
  run(corpus: Corpus, params: ParamValues, io: RunIo): MethodResult;
}

/** The documents listed per row of a table: more would make stored results large. */
export const ROW_DOC_CAP = 12;

/** The default and the largest number of rows a table keeps. */
export const DEFAULT_ROW_CAP = 500;
export const MAX_ROW_CAP = 5000;

/** Build a table view, cutting it to `cap` rows and recording the full row count. */
export function makeTable(args: {
  title: string;
  columns: Column[];
  rows: Cell[][];
  rowDocs?: (string[] | null)[];
  cap?: number;
  note?: string;
}): TableView {
  const cap = Math.max(1, Math.min(MAX_ROW_CAP, args.cap ?? DEFAULT_ROW_CAP));
  const total = args.rows.length;
  const rows = total > cap ? args.rows.slice(0, cap) : args.rows;
  const rowDocs = args.rowDocs ? args.rowDocs.slice(0, rows.length).map((d) => (d ? d.slice(0, ROW_DOC_CAP) : null)) : undefined;
  return { kind: 'table', title: args.title, columns: args.columns, rows, totalRows: total, truncated: total > rows.length, rowDocs, note: args.note };
}

/** Fill in defaults and clamp numbers so that a stored or typed parameter set is always valid. */
export function normalizeParams(method: AnalysisMethod, given: ParamValues | undefined): ParamValues {
  const out: ParamValues = {};
  for (const spec of method.params) {
    const fallback = method.defaults[spec.key];
    const v = given?.[spec.key];
    switch (spec.type) {
      case 'number': {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(fallback);
        out[spec.key] = Math.max(spec.min, Math.min(spec.max, Math.round(n / (spec.step ?? 1)) * (spec.step ?? 1)));
        break;
      }
      case 'boolean':
        out[spec.key] = typeof v === 'boolean' ? v : Boolean(fallback);
        break;
      case 'select':
        out[spec.key] = typeof v === 'string' && spec.options.some((o) => o.value === v) ? v : String(fallback);
        break;
      default:
        out[spec.key] = typeof v === 'string' ? v : String(fallback ?? '');
    }
  }
  return out;
}

/** The grouping fields a method's `field` parameters may take, for the parameter form. */
export type FieldChoices = FieldOption[];
