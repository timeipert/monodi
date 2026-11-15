import type { MethodResult, ResultView } from '@monodi/core/analysis';

/** The largest serialised size of one stored result, in characters of JSON (about 8 MB). */
export const MAX_RESULT_CHARS = 8 * 1024 * 1024;

/** The fewest rows a table is cut down to. */
const MIN_ROWS = 20;

function cutTable(view: ResultView, rows: number): ResultView {
  if (view.kind !== 'table' || view.rows.length <= rows) return view;
  return {
    ...view,
    rows: view.rows.slice(0, rows),
    rowDocs: view.rowDocs ? view.rowDocs.slice(0, rows) : undefined,
    truncated: true,
  };
}

/**
 * Keep a result under `maxChars` of JSON by cutting the rows of its tables (the most relevant rows come first in every
 * table) until it fits. Bars, matrices, trees and plots are kept whole: their size is bounded by the methods
 * (at most 20 bars, 120 groups in a matrix). Returns the result and whether anything was cut. A result that still does
 * not fit with every table at the minimum is returned as it is, so the caller can report it.
 */
export function shrinkResult(result: MethodResult, maxChars: number = MAX_RESULT_CHARS): { result: MethodResult; truncated: boolean } {
  let size = JSON.stringify(result).length;
  if (size <= maxChars) return { result, truncated: false };
  let current = result;
  let rows = Math.max(...result.views.map((v) => (v.kind === 'table' ? v.rows.length : 0)), MIN_ROWS);
  let cut = false;
  while (size > maxChars && rows > MIN_ROWS) {
    rows = Math.max(MIN_ROWS, Math.floor(rows / 2));
    current = { ...result, views: result.views.map((v) => cutTable(v, rows)) };
    size = JSON.stringify(current).length;
    cut = true;
  }
  if (cut) {
    current = { ...current, notes: [...current.notes, `The tables were cut to ${rows} rows to keep the stored result under ${Math.round(maxChars / 1024 / 1024)} MB; the full row counts are shown with each table.`] };
  }
  return { result: current, truncated: cut };
}
