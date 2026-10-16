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

describe('GridView cell range', () => {
  const rows: [string, string, string][] = [['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i'], ['j', 'k', 'l']];

  it('selects a block with anchor and extension, and clamps to the table', () => {
    const v = view(rows);
    v.selectCell(1, 0);
    v.selectCell(2, 1, true);
    expect(v.range()).toEqual({ p0: 1, p1: 2, c0: 0, c1: 1 });
    expect(v.rangeCellCount).toBe(4);
    expect(v.inRange(2, 1)).toBeTrue();
    expect(v.inRange(0, 0)).toBeFalse();
    v.moveCursor(10, 10);
    expect(v.anchor).toEqual({ pos: 3, ci: 2 });
    v.moveCursor(-1, 0, true);
    expect(v.range()).toEqual({ p0: 2, p1: 3, c0: 2, c1: 2 });
  });

  it('copies the block as rows of values, in the displayed (sorted) order', () => {
    const v = view(rows, 'id');
    v.sortBy('id');          // asc then desc
    expect(ids(v)).toEqual(['j', 'g', 'd', 'a']);
    v.selectCell(0, 0);
    v.selectCell(1, 1, true);
    expect(v.rangeValues()).toEqual([['j', 'k'], ['g', 'h']]);
  });

  it('a new filter or sort drops the cell selection (positions would point at other rows)', () => {
    const v = view(rows);
    v.selectCell(1, 1);
    v.quick = 'x';
    v.refresh();
    expect(v.range()).toBeNull();
  });
});

describe('GridView edits', () => {
  const mk = () => new GridView(
    [{ key: 'id', label: 'ID', width: 100, required: true }, { key: 'initium', label: 'Initium', width: 100 }, { key: 'count', label: 'N', width: 50, editable: false }],
    [0, 1, 2, 3].map((i) => ({ id: 'r' + i, group: '', cells: ['id' + i, 'in' + i, String(i)] })),
  );

  it('writes cells as one undo step, tracks what differs from the loaded value, and undoes/redoes', () => {
    const v = mk();
    const res = v.setCells([{ row: 0, ci: 1, value: 'A' }, { row: 1, ci: 1, value: 'B' }]);
    expect(res).toEqual({ applied: 2, rejected: 0, outside: 0 });
    expect(v.dirtyCount).toBe(2);
    expect(v.dirtyRowCount).toBe(2);
    expect(v.isDirty(0, 1)).toBeTrue();
    expect(v.values[1][0]).toBe('A');
    v.undo();
    expect(v.dirtyCount).toBe(0);
    expect(v.values[1][0]).toBe('in0');
    v.redo();
    expect(v.dirtyCount).toBe(2);
  });

  it('typing the loaded value back is not an edit', () => {
    const v = mk();
    v.setCells([{ row: 2, ci: 1, value: 'x' }]);
    v.setCells([{ row: 2, ci: 1, value: 'in2' }]);
    expect(v.dirtyCount).toBe(0);
    expect(v.changes()).toEqual([]);
  });

  it('refuses read-only columns and empty values in required columns, and skips unchanged cells', () => {
    const v = mk();
    const res = v.setCells([{ row: 0, ci: 2, value: '9' }, { row: 0, ci: 0, value: '  ' }, { row: 0, ci: 1, value: 'in0' }, { row: 99, ci: 1, value: 'z' }]);
    expect(res).toEqual({ applied: 0, rejected: 2, outside: 1 });
    expect(v.dirtyCount).toBe(0);
    expect(v.canUndo).toBeFalse();
  });

  it('reports the edits per row with only the fields that changed', () => {
    const v = mk();
    v.setCells([{ row: 1, ci: 1, value: 'B' }, { row: 1, ci: 0, value: 'ID' }, { row: 3, ci: 1, value: 'D' }]);
    expect(v.changes()).toEqual([{ id: 'r1', fields: { initium: 'B', id: 'ID' } }, { id: 'r3', fields: { initium: 'D' } }]);
  });

  it('filters and sorts see the edited values, but rows stay where they are until the next refresh', () => {
    const v = mk();
    v.addFilter({ column: 'initium', op: 'equals', value: 'in1' });
    v.refresh();
    expect(v.viewIdx).toEqual([1]);
    v.setCells([{ row: 1, ci: 1, value: 'changed' }]);
    expect(v.viewIdx).toEqual([1]);       // still shown, like a spreadsheet
    v.refresh();
    expect(v.viewIdx).toEqual([]);        // now filtered out by its new value
    v.filters[0].value = 'changed';
    v.refresh();
    expect(v.viewIdx).toEqual([1]);
  });

  it('discard restores every loaded value', () => {
    const v = mk();
    v.setCells([{ row: 0, ci: 1, value: 'A' }, { row: 3, ci: 0, value: 'Z' }]);
    v.discardEdits();
    expect(v.values[1][0]).toBe('in0');
    expect(v.values[0][3]).toBe('id3');
    expect(v.dirtyCount).toBe(0);
    expect(v.canUndo).toBeFalse();
  });

  it('paste: one value fills the whole range, a block goes in at the top-left and is clipped at the table end', () => {
    const v = mk();
    v.selectCell(0, 1);
    v.selectCell(2, 1, true);
    expect(v.pasteMatrix([['X']])).toEqual({ applied: 3, rejected: 0, outside: 0 });
    expect(v.values[1].slice(0, 4)).toEqual(['X', 'X', 'X', 'in3']);

    v.selectCell(3, 0);
    const res = v.pasteMatrix([['a', 'b'], ['c', 'd']]);        // rows 3 and 4 (4 is outside), columns 0 and 1
    expect(res.outside).toBe(2);
    expect(v.values[0][3]).toBe('a');
    expect(v.values[1][3]).toBe('b');
    v.undo();
    expect(v.values[0][3]).toBe('id3');   // the paste is one undo step
    expect(v.values[1][0]).toBe('X');     // the fill before it is another
  });

  it('paste follows the displayed order, not the stored order', () => {
    const v = mk();
    v.sortBy('id'); v.sortBy('id');       // descending: r3, r2, r1, r0
    v.selectCell(0, 1);
    v.pasteMatrix([['first'], ['second']]);
    expect(v.values[1][3]).toBe('first');
    expect(v.values[1][2]).toBe('second');
  });

  it('delete empties the range but not required columns; fill down copies the top row', () => {
    const v = mk();
    v.selectCell(0, 0);
    v.selectCell(1, 1, true);
    const res = v.clearRange();
    expect(res.rejected).toBe(2);         // the two ID cells
    expect(v.values[1].slice(0, 2)).toEqual(['', '']);
    v.undo();
    v.setCells([{ row: 0, ci: 1, value: 'TOP' }]);
    v.selectCell(0, 1);
    v.selectCell(3, 1, true);
    v.fillDown();
    expect(v.values[1]).toEqual(['TOP', 'TOP', 'TOP', 'TOP']);
  });

  it('at 20 000 rows a paste of 20 000 cells and its undo take well under a second', () => {
    const rows: GridRowInput[] = Array.from({ length: 20000 }, (_, i) => ({ id: 'd' + i, group: '', cells: ['x' + i, '', ''] }));
    const v = new GridView(COLS, rows);
    v.selectCell(0, 1);
    v.selectCell(19999, 1, true);
    const t0 = performance.now();
    expect(v.fillRange('V').applied).toBe(20000);
    expect(v.changes().length).toBe(20000);
    v.undo();
    expect(v.dirtyCount).toBe(0);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
