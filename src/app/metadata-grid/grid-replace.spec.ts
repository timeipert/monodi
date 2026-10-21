import { EMPTY_REPLACE, ReplaceSpec, buildFindRegExp, planReplace } from './grid-replace';
import { GridView } from './grid-view';

function view(rows: string[][]): GridView {
  return new GridView(
    [{ key: 'id', label: 'ID', width: 100, required: true }, { key: 'a', label: 'A', width: 100 }, { key: 'b', label: 'B', width: 100 }, { key: 'ro', label: 'Read only', width: 100, editable: false }],
    rows.map((cells, i) => ({ id: 'r' + i, group: '', cells })),
  );
}
const spec = (o: Partial<ReplaceSpec>): ReplaceSpec => ({ ...EMPTY_REPLACE, columns: ['a', 'b'], ...o });

describe('search and replace: the pattern', () => {
  it('needs something to find', () => {
    const r = buildFindRegExp({ find: '', regex: false, caseSensitive: false, wholeWord: false });
    expect(r instanceof Error && r.message).toContain('Enter the text to find');
  });

  it('is plain text by default, case-insensitive', () => {
    const re = buildFindRegExp({ find: 'Ton', regex: false, caseSensitive: false, wholeWord: false }) as RegExp;
    expect('ton Ton TON tons'.match(re)?.length).toBe(4);
  });

  it('matches case only when asked', () => {
    const re = buildFindRegExp({ find: 'Ton', regex: false, caseSensitive: true, wholeWord: false }) as RegExp;
    expect('ton Ton TON'.match(re)).toEqual(['Ton']);
  });

  it('escapes plain text, so a dot or a paren is literal', () => {
    const re = buildFindRegExp({ find: 'a.b(c)', regex: false, caseSensitive: true, wholeWord: false }) as RegExp;
    expect('a.b(c) axbycz'.match(re)).toEqual(['a.b(c)']);
  });

  it('is a pattern when asked, groups usable in the replacement', () => {
    const re = buildFindRegExp({ find: 'T(\\d+)', regex: true, caseSensitive: true, wholeWord: false }) as RegExp;
    expect('T12 T3'.replace(re, 'Nr. $1')).toBe('Nr. 12 Nr. 3');
  });

  it('reports a pattern that does not compile', () => {
    const r = buildFindRegExp({ find: '(', regex: true, caseSensitive: false, wholeWord: false });
    expect(r instanceof Error && r.message).toContain('not valid');
  });

  it('whole word: stands on its own, not part of a longer word, letters with diacritics included', () => {
    const re = buildFindRegExp({ find: 'Ton', regex: false, caseSensitive: true, wholeWord: true }) as RegExp;
    expect('Ton Tonart Baritone, Ton.'.match(re)?.length).toBe(2);
    const re2 = buildFindRegExp({ find: 'öl', regex: false, caseSensitive: true, wholeWord: true }) as RegExp;
    // the leading "öl" is its own word and matches; "Säöl" has "öl" as part of a longer word and does not
    expect('öl Säöl-x'.match(re2)).toEqual(['öl']);
    expect('ein öl, zwei'.match(re2)?.length).toBe(1);
  });
});

describe('search and replace: the plan', () => {
  const v = () => view([['1', 'Ton eins', 'kein Ton', 'x'], ['2', 'Tonart', 'Ton', 'x'], ['3', '', 'nichts', 'x']]);

  it('replaces in every chosen column, counts matches and changed cells apart', () => {
    const p = planReplace(v(), spec({ find: 'Ton', replaceWith: 'Note' }));
    expect(p.changes.map((c) => [c.row, c.ci, c.value])).toEqual([[0, 1, 'Note eins'], [0, 2, 'kein Note'], [1, 1, 'Noteart'], [1, 2, 'Note']]);
    expect(p).toEqual(jasmine.objectContaining({ cells: 6, changed: 4, occurrences: 4, same: 0, problem: '' }));
  });

  it('counts several occurrences in one cell, and leaves the cell alone when the result is the same text', () => {
    const p = planReplace(view([['1', 'Ton Ton', '', 'x']]), spec({ find: 'Ton', replaceWith: 'Ton' }));
    expect(p.changes).toEqual([]);
    expect(p).toEqual(jasmine.objectContaining({ occurrences: 2, same: 1, changed: 0 }));
  });

  it('looks only at the chosen columns, read-only ones filtered out even when named', () => {
    const only_a = planReplace(v(), spec({ find: 'Ton', replaceWith: 'X', columns: ['a'] }));
    expect(only_a.changes.every((c) => c.ci === 1)).toBeTrue();
    const with_ro = planReplace(v(), spec({ find: 'x', replaceWith: 'y', columns: ['a', 'ro'] }));
    expect(with_ro.cells).toBe(3);   // only column a's 3 rows; "ro" dropped
  });

  it('says why there is no plan: no column chosen (also when only a read-only one was), nothing to find', () => {
    expect(planReplace(v(), spec({ find: 'Ton', columns: [] })).problem).toContain('Choose at least one column');
    expect(planReplace(v(), spec({ find: 'Ton', columns: ['ro'] })).problem).toContain('Choose at least one column');
    expect(planReplace(v(), spec({ find: '' })).problem).toContain('Enter the text to find');
  });

  it('looks at the rows that pass the filters, or at all of them', () => {
    const view2 = v();
    view2.quick = 'Tonart';
    view2.refresh();
    const shown = planReplace(view2, spec({ find: 'Ton', replaceWith: 'X', columns: ['a'] }));
    expect(shown.changes.map((c) => c.row)).toEqual([1]);
    const all = planReplace(view2, spec({ find: 'Ton', replaceWith: 'X', columns: ['a'], rows: 'all' }));
    expect(all.changes.map((c) => c.row)).toEqual([0, 1]);
  });

  it('looks only at the selected cells when asked, ignoring columns and rows', () => {
    const view3 = v();
    view3.selectCell(0, 1);
    view3.selectCell(1, 2, true);   // a2 .. b2: rows 0-1, columns a-b
    const p = planReplace(view3, spec({ find: 'Ton', replaceWith: 'X', selectionOnly: true }));
    expect(p.changes.map((c) => [c.row, c.ci])).toEqual([[0, 1], [0, 2], [1, 1], [1, 2]]);
  });

  it('needs a selection when selectionOnly is asked for', () => {
    expect(planReplace(v(), spec({ find: 'Ton', selectionOnly: true })).problem).toContain('Select one or more cells');
  });

  it('shows samples with the column label', () => {
    const p = planReplace(v(), spec({ find: 'Ton', replaceWith: 'Note' }));
    expect(p.samples[0]).toEqual({ column: 'A', before: 'Ton eins', after: 'Note eins' });
  });

  it('goes into the grid as one undo step and leaves a required column alone', () => {
    const g = v();
    const p = planReplace(g, spec({ find: 'Ton', replaceWith: 'Note' }));
    expect(g.setCells(p.changes).applied).toBe(4);
    expect(g.dirtyCount).toBe(4);
    expect(g.undo()).toBeTrue();
    expect(g.dirtyCount).toBe(0);
  });
});
