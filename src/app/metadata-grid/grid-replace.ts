import { CellChange, GridView } from './grid-view';

/**
 * Finds text inside cells and replaces it, in place (the rest of a cell's text stays): plain text or a pattern, case
 * sensitive or not, whole words only. The area is either the cells currently selected in the grid, or one or more
 * columns over the rows shown now or all of them. Nothing is written here: the plan says what would change, and the
 * caller puts it into the grid as edits (one undo step, saved like any other edit).
 */
export interface ReplaceSpec {
  find: string;
  replaceWith: string;
  /** `find` is a regular expression (groups can be used in `replaceWith` as $1, $2 …); otherwise plain text. */
  regex: boolean;
  caseSensitive: boolean;
  /** `find` must stand on its own, not as part of a longer word ("Ton" does not match inside "Tonart"). */
  wholeWord: boolean;
  /** Column keys to search, when `selectionOnly` is false. */
  columns: string[];
  /** The rows that pass the filters now, or every row; ignored when `selectionOnly` is true. */
  rows: 'shown' | 'all';
  /** Look only at the cells currently selected in the grid (`view.range()`); `columns` and `rows` are then ignored. */
  selectionOnly: boolean;
}

export const EMPTY_REPLACE: ReplaceSpec = {
  find: '', replaceWith: '', regex: false, caseSensitive: false, wholeWord: false, columns: [], rows: 'shown', selectionOnly: false,
};

export interface ReplacePlan {
  changes: CellChange[];
  /** Cells looked at. */
  cells: number;
  /** Cells that contain the text and get a new value (= changes.length). */
  changed: number;
  /** Cells that contain the text, but the result is the same text (replacing "a" with "a"). */
  same: number;
  /** How many times the text was found, across every cell. */
  occurrences: number;
  /** Why there is no plan: nothing to find, no column or cell chosen, a pattern that does not compile. */
  problem: string;
  samples: { column: string; before: string; after: string }[];
}

const SAMPLES = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pattern that looks for `spec.find`, or the problem when it does not compile. Exported for its own tests; most
 * callers go through `planReplace`.
 */
export function buildFindRegExp(spec: Pick<ReplaceSpec, 'find' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp | Error {
  if (!spec.find) return new Error('Enter the text to find.');
  let core = spec.regex ? spec.find : escapeRegExp(spec.find);
  let flags = 'g' + (spec.caseSensitive ? '' : 'i');
  // a word boundary that also works for letters outside a-z (ä, é …), unlike \b
  if (spec.wholeWord) { core = `(?<![\\p{L}\\p{N}_])(?:${core})(?![\\p{L}\\p{N}_])`; flags += 'u'; }
  try {
    return new RegExp(core, flags);
  } catch (e: any) {
    return new Error('The pattern is not valid: ' + (e?.message || e));
  }
}

export function planReplace(view: GridView, spec: ReplaceSpec): ReplacePlan {
  const plan: ReplacePlan = { changes: [], cells: 0, changed: 0, same: 0, occurrences: 0, problem: '', samples: [] };
  const re = buildFindRegExp(spec);
  if (re instanceof Error) { plan.problem = re.message; return plan; }

  const cells: { row: number; ci: number }[] = [];
  if (spec.selectionOnly) {
    const range = view.range();
    if (!range) { plan.problem = 'Select one or more cells first.'; return plan; }
    for (let p = range.p0; p <= range.p1; p++) {
      const row = view.viewIdx[p];
      if (row === undefined) continue;
      for (let ci = range.c0; ci <= range.c1; ci++) if (view.isEditable(ci)) cells.push({ row, ci });
    }
  } else {
    const colIdx = spec.columns
      .map((key) => view.columns.findIndex((c) => c.key === key))
      .filter((ci) => ci >= 0 && view.isEditable(ci));
    if (!colIdx.length) { plan.problem = 'Choose at least one column.'; return plan; }
    const rows = spec.rows === 'all' ? Array.from({ length: view.rowCount }, (_, i) => i) : view.viewIdx;
    for (const row of rows) for (const ci of colIdx) cells.push({ row, ci });
  }
  plan.cells = cells.length;

  for (const { row, ci } of cells) {
    const text = view.values[ci][row];
    if (!text) continue;
    const found = text.match(re);
    if (!found) continue;
    plan.occurrences += found.length;
    const next = text.replace(re, spec.replaceWith);
    if (next === text) { plan.same++; continue; }
    plan.changes.push({ row, ci, value: next });
    if (plan.samples.length < SAMPLES) plan.samples.push({ column: view.columns[ci].label, before: text, after: next });
  }
  plan.changed = plan.changes.length;
  return plan;
}
