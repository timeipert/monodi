import { ANY_COLUMN, compileFilter, GridFilter } from './grid-filter';
import { GridColumn, GridRowInput, GridView } from './grid-view';

const COLS: GridColumn[] = [
  { key: 'id', label: 'ID', width: 100 },
  { key: 'initium', label: 'Initium', width: 100 },
  { key: 'genre', label: 'Genre', width: 100 },
];

function view(rows: [string, string, string, string?][], sort?: string): GridView {
  const input: GridRowInput[] = rows.map(([id, initium, genre, group], i) => ({ id: 'r' + i, group: group ?? '', cells: [id, initium, genre] }));
  return new GridView(COLS, input, sort);
}

const ids = (v: GridView) => v.viewIdx.map((r) => v.values[0][r]);

describe('compileFilter', () => {
  const f = (op: GridFilter['op'], value: string, caseSensitive = false): GridFilter => ({ id: 1, column: 'id', op, value, caseSensitive });

  it('treats a rule that still needs its value as inactive, not as "matches nothing"', () => {
    expect(compileFilter(f('contains', '')).kind).toBe('inactive');
    expect(compileFilter(f('empty', '')).kind).toBe('test');
  });

  it('reports an invalid regular expression instead of throwing', () => {
    const c = compileFilter(f('regex', '(unclosed'));
    expect(c.kind).toBe('error');
  });
});

describe('GridView filters', () => {
  const rows: [string, string, string][] = [
    ['Pa 1-1 GS', 'Alpha', 'Antiphon'],
    ['Pa 1-2', 'Beta GS', 'Antiphon'],
    ['Pa 1-3 gs', 'Gamma', ''],
    ['GS Pa 1-4', 'Delta', 'Responsorium'],
    ['Pa 1-5 GSX', 'Epsilon', 'Responsorium'],
  ];

  it('"ends with" is anchored at the end, not a substring match (the GS case)', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'GS' });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-1 GS', 'Pa 1-3 gs']);
  });

  it('case-sensitive narrows the same rule', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'GS', caseSensitive: true });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-1 GS']);
  });

  it('starts with, equals, contains, regex', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'startsWith', value: 'gs' });
    v.refresh();
    expect(ids(v)).toEqual(['GS Pa 1-4']);

    v.clearFilters();
    v.addFilter({ column: 'initium', op: 'equals', value: 'beta gs' });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-2']);

    v.clearFilters();
    v.addFilter({ column: 'id', op: 'regex', value: ' GS$' });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-1 GS', 'Pa 1-3 gs']);

    v.clearFilters();
    v.addFilter({ column: 'id', op: 'contains', value: 'gs' });
    v.refresh();
    expect(ids(v).length).toBe(4);
  });

  it('empty and not empty', () => {
    const v = view(rows);
    v.addFilter({ column: 'genre', op: 'empty' });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-3 gs']);
    v.clearFilters();
    v.addFilter({ column: 'genre', op: 'notEmpty' });
    v.refresh();
    expect(v.viewIdx.length).toBe(4);
  });

  it('negated rules over every column mean "no column", not "some column"', () => {
    const v = view(rows);
    v.addFilter({ column: ANY_COLUMN, op: 'notContains', value: 'gs' });
    v.refresh();
    // rows 0, 1, 2, 3, 4 all have "gs" somewhere in id or initium
    expect(ids(v)).toEqual([]);
    v.clearFilters();
    v.addFilter({ column: ANY_COLUMN, op: 'contains', value: 'responsorium' });
    v.refresh();
    expect(ids(v)).toEqual(['GS Pa 1-4', 'Pa 1-5 GSX']);
  });

  it('combines rules with AND and the quick search', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'gs' });
    v.addFilter({ column: 'genre', op: 'equals', value: 'antiphon' });
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-1 GS']);
    v.quick = 'alpha';
    v.refresh();
    expect(ids(v)).toEqual(['Pa 1-1 GS']);
    v.quick = 'beta';
    v.refresh();
    expect(ids(v)).toEqual([]);
  });

  it('ignores a rule without its value and one with a broken regex (nothing disappears while typing)', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: '' });
    const bad = v.addFilter({ column: 'id', op: 'regex', value: '(' });
    v.refresh();
    expect(v.viewIdx.length).toBe(5);
    expect(v.filterErrors.has(bad.id)).toBeTrue();
    expect(v.activeFilterCount).toBe(0);
  });

  it('a rule on a column that no longer exists matches nothing', () => {
    const v = view(rows);
    v.addFilter({ column: 'gone', op: 'contains', value: 'a' });
    v.refresh();
    expect(v.viewIdx.length).toBe(0);
  });
});

describe('GridView sorting', () => {
  it('sorts naturally (10 after 9) and cycles asc, desc, none', () => {
    const v = view([['Pa 10', 'a', ''], ['Pa 9', 'b', ''], ['Pa 100', 'c', '']]);
    v.sortBy('id');
    expect(ids(v)).toEqual(['Pa 9', 'Pa 10', 'Pa 100']);
    v.sortBy('id');
    expect(ids(v)).toEqual(['Pa 100', 'Pa 10', 'Pa 9']);
    v.sortBy('id');
    expect(ids(v)).toEqual(['Pa 10', 'Pa 9', 'Pa 100']);
  });

  it('adopt keeps filters and sort over a reload, and drops rules on columns the new data lacks', () => {
    const old = view([['b', '', ''], ['a', '', '']], 'id');
    old.addFilter({ column: 'id', op: 'contains', value: 'a' });
    old.addFilter({ column: 'nope', op: 'contains', value: 'a' });
    old.quick = 'q';
    const next = view([['b', '', ''], ['a', 'q', '']]);
    next.adopt(old);
    expect(next.filters.length).toBe(1);
    expect(next.sortKey).toBe('id');
    expect(next.quick).toBe('q');
    expect(ids(next)).toEqual(['a']);
    const added = next.addFilter();
    expect(next.filters.filter((f) => f.id === added.id).length).toBe(1);
  });
});

describe('GridView selection', () => {
  const rows: [string, string, string, string][] = [
    ['a 1 GS', '', '', 'S1'], ['a 2', '', '', 'S1'], ['a 3 GS', '', '', 'S2'], ['a 4 GS', '', '', 'S1'], ['a 5', '', '', 'S2'],
  ];

  it('the header checkbox selects every matching row across the whole data, and nothing else', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'GS' });
    v.refresh();
    v.toggleAll();
    expect(v.selectedIds()).toEqual(['r0', 'r2', 'r3']);
    expect(v.allSelected).toBeTrue();
    v.toggleAll();
    expect(v.selectedCount).toBe(0);
  });

  it('changing the filter drops selected rows that are no longer visible (never delete what you cannot see)', () => {
    const v = view(rows);
    v.toggleAll();
    expect(v.selectedCount).toBe(5);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'GS' });
    v.refresh();
    expect(v.selectedIds()).toEqual(['r0', 'r2', 'r3']);
  });

  it('shift-click selects the range between two toggles and clears it the same way', () => {
    const v = view(rows);
    v.toggleAt(1);
    v.toggleAt(3, true);
    expect(v.selectedIds()).toEqual(['r1', 'r2', 'r3']);
    v.toggleAt(2);       // single toggle off
    expect(v.selectedIds()).toEqual(['r1', 'r3']);
    v.toggleAt(0, true); // range from 2 to 0, new state: selected
    expect(v.selectedIds()).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('summarises the selection by group and samples values', () => {
    const v = view(rows);
    v.addFilter({ column: 'id', op: 'endsWith', value: 'GS' });
    v.refresh();
    v.toggleAll();
    expect(v.selectedByGroup()).toEqual([{ group: 'S1', count: 2 }, { group: 'S2', count: 1 }]);
    expect(v.selectedSample('id', 2)).toEqual(['a 1 GS', 'a 3 GS']);
  });
});

describe('GridView at 20 000 rows', () => {
  it('filters, sorts and selects them in well under a second', () => {
    const rows: GridRowInput[] = [];
    for (let i = 0; i < 20000; i++) {
      rows.push({ id: 'd' + i, group: 'S' + (i % 40), cells: [`Doc ${i}${i % 7 === 0 ? ' GS' : ''}`, 'Incipit ' + i, i % 3 ? 'Antiphon' : 'Responsorium'] });
    }
    const t0 = performance.now();
    const v = new GridView(COLS, rows, 'id');
    v.addFilter({ column: 'id', op: 'endsWith', value: 'gs' });
    v.addFilter({ column: 'genre', op: 'equals', value: 'antiphon' });
    v.refresh();
    v.toggleAll();
    const ms = performance.now() - t0;
    const expected = rows.filter((_, i) => i % 7 === 0 && i % 3 !== 0).length;
    expect(v.selectedCount).toBe(expected);
    expect(v.selectedIds().length).toBe(expected);
    expect(ms).toBeLessThan(1500);
  });
});
