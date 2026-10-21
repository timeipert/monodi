import { CellChange, GridView } from './grid-view';

/**
 * Fills one column from another, row by row, with an optional change of the text on the way: a plain copy, a find and
 * replace (also with a pattern and groups: "Spiel (\d+)" → "$1"), a prefix and a suffix. Nothing is written here: the plan
 * says what would change, and the caller puts it into the grid as edits (one undo step, saved like any other edit).
 */
export interface FillSpec {
  /** Column keys of the view. */
  from: string;
  to: string;
  find: string;
  /** `find` is a regular expression (case-insensitive no, groups yes); otherwise plain text. */
  regex: boolean;
  replaceWith: string;
  prefix: string;
  suffix: string;
  /** Leave cells that already have a value alone. */
  onlyEmpty: boolean;
  /** The rows that pass the filters now, or every row. */
  scope: 'shown' | 'all';
}

export const EMPTY_FILL: FillSpec = { from: '', to: '', find: '', regex: false, replaceWith: '', prefix: '', suffix: '', onlyEmpty: true, scope: 'shown' };

export interface FillPlan {
  changes: CellChange[];
  /** Rows looked at. */
  rows: number;
  /** Cells that would get a new value (= changes.length). */
  changed: number;
  /** Rows whose source is empty: nothing is copied from them. */
  emptySource: number;
  /** Rows whose target has a value and was left alone ("only empty cells"). */
  kept: number;
  /** Rows where the result is what the target has already. */
  same: number;
  /** Why there is no plan: a column missing, a pattern that does not compile, a target that cannot be written. */
  problem: string;
  samples: { from: string; to: string; was: string }[];
}

const SAMPLES = 6;

/** The text after the find/replace and the prefix and suffix; '' stays '' (an empty source gives nothing). */
export function transformText(value: string, spec: Pick<FillSpec, 'find' | 'regex' | 'replaceWith' | 'prefix' | 'suffix'>): string {
  let v = value.trim();
  if (spec.find) {
    if (spec.regex) v = v.replace(new RegExp(spec.find, 'g'), spec.replaceWith);
    else v = v.split(spec.find).join(spec.replaceWith);
    v = v.trim();
  }
  return v ? spec.prefix + v + spec.suffix : '';
}

export function planFill(view: GridView, spec: FillSpec): FillPlan {
  const plan: FillPlan = { changes: [], rows: 0, changed: 0, emptySource: 0, kept: 0, same: 0, problem: '', samples: [] };
  const from = view.columns.findIndex((c) => c.key === spec.from);
  const to = view.columns.findIndex((c) => c.key === spec.to);
  if (from < 0 || to < 0) { plan.problem = from < 0 ? 'Choose the column to copy from.' : 'Choose the column to fill.'; return plan; }
  if (from === to) { plan.problem = 'Both columns are the same.'; return plan; }
  if (!view.isEditable(to)) { plan.problem = `"${view.columns[to].label}" cannot be changed here.`; return plan; }
  if (spec.regex && spec.find) {
    try { new RegExp(spec.find, 'g'); } catch (e: any) { plan.problem = 'The pattern is not valid: ' + (e?.message || e); return plan; }
  }
  const rows = spec.scope === 'all' ? Array.from({ length: view.rowCount }, (_, i) => i) : view.viewIdx.slice();
  plan.rows = rows.length;
  for (const r of rows) {
    const src = view.values[from][r];
    const was = view.values[to][r];
    const next = transformText(src, spec);
    if (!next) { plan.emptySource++; continue; }
    if (spec.onlyEmpty && was.trim() !== '') { plan.kept++; continue; }
    if (next === was) { plan.same++; continue; }
    plan.changes.push({ row: r, ci: to, value: next });
    if (plan.samples.length < SAMPLES) plan.samples.push({ from: src, to: next, was });
  }
  plan.changed = plan.changes.length;
  return plan;
}
