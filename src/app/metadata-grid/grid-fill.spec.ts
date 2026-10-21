import { EMPTY_FILL, FillSpec, planFill, transformText } from './grid-fill';
import { GridView } from './grid-view';

function view(rows: string[][]): GridView {
  return new GridView(
    [{ key: 'id', label: 'ID', width: 100, required: true }, { key: 'spiel', label: 'Spiel', width: 100 }, { key: 'unit', label: 'Unit', width: 100 }, { key: 'ro', label: 'Read only', width: 100, editable: false }],
    rows.map((cells, i) => ({ id: 'r' + i, group: '', cells })),
  );
}
const spec = (o: Partial<FillSpec>): FillSpec => ({ ...EMPTY_FILL, from: 'spiel', to: 'unit', ...o });

describe('grid fill: the text on the way', () => {
  it('copies as it is, trimmed, and gives nothing for an empty source', () => {
    expect(transformText('  Spiel 3 ', EMPTY_FILL)).toBe('Spiel 3');
    expect(transformText('   ', EMPTY_FILL)).toBe('');
  });

  it('replaces plain text everywhere, or a pattern with groups', () => {
    expect(transformText('a-b-c', { ...EMPTY_FILL, find: '-', replaceWith: '/' })).toBe('a/b/c');
    expect(transformText('Spiel 12 (Teil 2)', { ...EMPTY_FILL, find: 'Spiel (\\d+).*', regex: true, replaceWith: 'play-$1' })).toBe('play-12');
    // characters that mean something in a pattern are plain text when the box is not ticked
    expect(transformText('a.b', { ...EMPTY_FILL, find: '.', replaceWith: '!' })).toBe('a!b');
  });

  it('adds a prefix and a suffix to what is there, never to nothing', () => {
    expect(transformText('7', { ...EMPTY_FILL, prefix: 'play-', suffix: '/x' })).toBe('play-7/x');
    expect(transformText('Spiel', { ...EMPTY_FILL, find: 'Spiel', replaceWith: '', prefix: 'p-' })).toBe('');
  });
});

describe('grid fill: the plan', () => {
  const v = () => view([['a', 'Spiel 1', '', 'x'], ['b', 'Spiel 1', 'old', 'x'], ['c', '', '', 'x'], ['d', 'Spiel 2', '', 'x']]);

  it('fills only empty cells by default and counts what it leaves out', () => {
    const p = planFill(v(), spec({}));
    expect(p.changes.map((c) => [c.row, c.value])).toEqual([[0, 'Spiel 1'], [3, 'Spiel 2']]);
    expect(p).toEqual(jasmine.objectContaining({ rows: 4, changed: 2, kept: 1, emptySource: 1, same: 0, problem: '' }));
  });

  it('can overwrite, and counts a cell that already has the value as unchanged', () => {
    const view2 = view([['a', 'Spiel 1', 'Spiel 1', ''], ['b', 'Spiel 1', 'old', '']]);
    const p = planFill(view2, spec({ onlyEmpty: false }));
    expect(p.changes.map((c) => c.row)).toEqual([1]);
    expect(p.same).toBe(1);
  });

  it('looks at the rows that pass the filters, or at all of them', () => {
    const view3 = v();
    view3.quick = 'Spiel 2';
    view3.refresh();
    expect(planFill(view3, spec({})).changes.map((c) => c.row)).toEqual([3]);
    expect(planFill(view3, spec({ scope: 'all' })).changes.length).toBe(2);
  });

  it('applies the change of text and shows samples', () => {
    const p = planFill(v(), spec({ find: 'Spiel ', replaceWith: 'play-' }));
    expect(p.samples).toEqual([{ from: 'Spiel 1', to: 'play-1', was: '' }, { from: 'Spiel 2', to: 'play-2', was: '' }]);
  });

  it('says why there is no plan: a missing column, the same column, a read-only target, a bad pattern', () => {
    expect(planFill(v(), spec({ from: '' })).problem).toContain('copy from');
    expect(planFill(v(), spec({ to: '' })).problem).toContain('to fill');
    expect(planFill(v(), spec({ to: 'spiel' })).problem).toContain('same');
    expect(planFill(v(), spec({ to: 'ro' })).problem).toContain('cannot be changed');
    expect(planFill(v(), spec({ find: '(', regex: true })).problem).toContain('not valid');
    expect(planFill(v(), spec({ from: '' })).changes).toEqual([]);
  });

  it('goes into the grid as one undo step and leaves a required column alone when the result would be empty', () => {
    const g = v();
    const p = planFill(g, spec({}));
    expect(g.setCells(p.changes).applied).toBe(2);
    expect(g.dirtyCount).toBe(2);
    expect(g.undo()).toBeTrue();
    expect(g.dirtyCount).toBe(0);
  });
});
