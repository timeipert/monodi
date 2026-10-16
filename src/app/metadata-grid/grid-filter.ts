/** Column filters of the metadata grid: what a rule says, and the test it compiles to. No Angular in here. */

export type FilterOp =
  | 'contains' | 'notContains'
  | 'equals' | 'notEquals'
  | 'startsWith' | 'endsWith'
  | 'regex'
  | 'empty' | 'notEmpty';

export const FILTER_OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: 'contains',    label: 'contains',        needsValue: true },
  { op: 'notContains', label: 'does not contain', needsValue: true },
  { op: 'equals',      label: 'equals',          needsValue: true },
  { op: 'notEquals',   label: 'does not equal',  needsValue: true },
  { op: 'startsWith',  label: 'starts with',     needsValue: true },
  { op: 'endsWith',    label: 'ends with',       needsValue: true },
  { op: 'regex',       label: 'matches regex',   needsValue: true },
  { op: 'empty',       label: 'is empty',        needsValue: false },
  { op: 'notEmpty',    label: 'is not empty',    needsValue: false },
];

/** `column` of a rule that looks at every column. */
export const ANY_COLUMN = '*';

export interface GridFilter {
  /** Identity for the UI (`@for ... track`); not used for matching. */
  id: number;
  column: string;
  op: FilterOp;
  value: string;
  caseSensitive: boolean;
}

/** A rule compiled to a test on one cell, or why it cannot be compiled. */
export type CompiledFilter =
  | { kind: 'test'; test: (cell: string, lowerCell: string) => boolean; negate: boolean; caseSensitive: boolean }
  | { kind: 'inactive' }
  | { kind: 'error'; message: string };

export function opNeedsValue(op: FilterOp): boolean {
  return FILTER_OPS.find((o) => o.op === op)?.needsValue ?? true;
}

/**
 * `test` is the *positive* form of the rule ("contains", "is not empty" …). Negated rules ("does not contain",
 * "is empty") set `negate`; on a rule that looks at every column that means "none of the columns", not "some
 * column does not".
 *
 * A rule that still needs a value but has none is `inactive` (typing a rule is not an empty result in between);
 * an invalid regular expression is an `error` and also does not filter.
 */
export function compileFilter(f: GridFilter): CompiledFilter {
  const needsValue = opNeedsValue(f.op);
  if (needsValue && f.value === '') return { kind: 'inactive' };
  const cs = f.caseSensitive;
  const needle = cs ? f.value : f.value.toLowerCase();
  const pick = (cell: string, lower: string) => (cs ? cell : lower);
  const make = (test: (cell: string, lowerCell: string) => boolean, negate = false): CompiledFilter =>
    ({ kind: 'test', test, negate, caseSensitive: cs });

  switch (f.op) {
    case 'contains':    return make((c, l) => pick(c, l).includes(needle));
    case 'notContains': return make((c, l) => pick(c, l).includes(needle), true);
    case 'equals':      return make((c, l) => pick(c, l) === needle);
    case 'notEquals':   return make((c, l) => pick(c, l) === needle, true);
    case 'startsWith':  return make((c, l) => pick(c, l).startsWith(needle));
    case 'endsWith':    return make((c, l) => pick(c, l).endsWith(needle));
    case 'empty':       return make((c) => c.trim() !== '', true);
    case 'notEmpty':    return make((c) => c.trim() !== '');
    case 'regex': {
      let re: RegExp;
      try {
        re = new RegExp(f.value, cs ? '' : 'i');
      } catch (e) {
        return { kind: 'error', message: String((e as Error).message ?? e) };
      }
      return make((c) => re.test(c));
    }
  }
}
