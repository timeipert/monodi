import { CellChange, GridView } from './grid-view';

/**
 * Finds text inside cells and replaces it, in place (the rest of a cell's text stays): plain text or a pattern, case
 * sensitive or not, whole words only. Several rules can run in one go, each on the result of the one before it (find
 * "Ton", replace "Note"; find "alt", replace "neu" — both in the same pass, one undo step). The area is either the
 * cells currently selected in the grid, or one or more columns over the rows shown now or all of them. Nothing is
 * written here: the plan says what would change, and the caller puts it into the grid as edits.
 */
export interface ReplaceRule {
  find: string;
  replaceWith: string;
  /** `find` is a regular expression (groups can be used in `replaceWith` as $1, $2 …); otherwise plain text. */
  regex: boolean;
  caseSensitive: boolean;
  /** `find` must stand on its own, not as part of a longer word ("Ton" does not match inside "Tonart"). */
  wholeWord: boolean;
}

export const EMPTY_RULE: ReplaceRule = { find: '', replaceWith: '', regex: false, caseSensitive: false, wholeWord: false };

export interface ReplaceSpec {
  /** Run in order, each on the result of the one before. A row with nothing to find is ignored (room to type one more). */
  rules: ReplaceRule[];
  /** Column keys to search, when `selectionOnly` is false. */
  columns: string[];
  /** The rows that pass the filters now, or every row; ignored when `selectionOnly` is true. */
  rows: 'shown' | 'all';
  /** Look only at the cells currently selected in the grid (`view.range()`); `columns` and `rows` are then ignored. */
  selectionOnly: boolean;
}

export const EMPTY_REPLACE: ReplaceSpec = { rules: [{ ...EMPTY_RULE }], columns: [], rows: 'shown', selectionOnly: false };

export interface ReplacePlan {
  changes: CellChange[];
  /** Cells looked at. */
  cells: number;
  /** Cells that match at least one rule and get a new value (= changes.length). */
  changed: number;
  /** Cells that match a rule, but the result (after every rule ran) is the same text. */
  same: number;
  /** How many times any rule's text was found, across every cell and every rule. */
  occurrences: number;
  /** Why there is no plan: nothing to find anywhere, no column or cell chosen, a row's pattern that does not compile. */
  problem: string;
  samples: { column: string; before: string; after: string }[];
}

const SAMPLES = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pattern that looks for `rule.find`, or the problem when it does not compile. Exported for its own tests; most
 * callers go through `planReplace`.
 */
export function buildFindRegExp(rule: Pick<ReplaceRule, 'find' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp | Error {
  if (!rule.find) return new Error('Enter the text to find.');
  let core = rule.regex ? rule.find : escapeRegExp(rule.find);
  let flags = 'g' + (rule.caseSensitive ? '' : 'i');
  // a word boundary that also works for letters outside a-z (ä, é …), unlike \b
  if (rule.wholeWord) { core = `(?<![\\p{L}\\p{N}_])(?:${core})(?![\\p{L}\\p{N}_])`; flags += 'u'; }
  try {
    return new RegExp(core, flags);
  } catch (e: any) {
    return new Error('The pattern is not valid: ' + (e?.message || e));
  }
}

/** The rows that have something to find, each compiled in order; the row number (1-based) names which one failed. */
function activeRules(rules: readonly ReplaceRule[]): { rules: { re: RegExp; replaceWith: string }[] } | { problem: string } {
  const used = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.find.trim() !== '');
  if (!used.length) return { problem: 'Enter the text to find, in at least one row.' };
  const out: { re: RegExp; replaceWith: string }[] = [];
  for (const { r, i } of used) {
    const re = buildFindRegExp(r);
    if (re instanceof Error) return { problem: `Row ${i + 1}: ${re.message}` };
    out.push({ re, replaceWith: r.replaceWith });
  }
  return { rules: out };
}

export function planReplace(view: GridView, spec: ReplaceSpec): ReplacePlan {
  const plan: ReplacePlan = { changes: [], cells: 0, changed: 0, same: 0, occurrences: 0, problem: '', samples: [] };
  const ar = activeRules(spec.rules);
  if ('problem' in ar) { plan.problem = ar.problem; return plan; }
  const rules = ar.rules;

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
    let next = text;
    let matchedAny = false;
    for (const rule of rules) {
      const found = next.match(rule.re);
      if (!found) continue;
      matchedAny = true;
      plan.occurrences += found.length;
      next = next.replace(rule.re, rule.replaceWith);
    }
    if (!matchedAny) continue;
    if (next === text) { plan.same++; continue; }
    plan.changes.push({ row, ci, value: next });
    if (plan.samples.length < SAMPLES) plan.samples.push({ column: view.columns[ci].label, before: text, after: next });
  }
  plan.changed = plan.changes.length;
  return plan;
}
