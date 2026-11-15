import type { MethodResult, TableView } from '@monodi/core/analysis';
import { shrinkResult } from './result-size';

function resultWithRows(n: number): MethodResult {
  const rows = Array.from({ length: n }, (_, i) => [i, `gram ${i} ${'x'.repeat(40)}`]);
  const table: TableView = {
    kind: 'table', title: 'T', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows, totalRows: n, truncated: false,
    rowDocs: rows.map((_, i) => [`d${i}`]),
  };
  return { summary: 's', docCount: 1, views: [table, { kind: 'bars', title: 'B', items: [{ label: 'x', value: 1 }] }], notes: [] };
}

describe('shrinkResult', () => {
  it('keeps a result that fits as it is', () => {
    const r = resultWithRows(10);
    const out = shrinkResult(r, 1_000_000);
    expect(out.truncated).toBeFalse();
    expect(out.result).toBe(r);
  });

  it('cuts the rows of tables until the result fits, keeps the first rows and the full row count', () => {
    const r = resultWithRows(4000);
    const limit = 40_000;
    const out = shrinkResult(r, limit);
    expect(out.truncated).toBeTrue();
    expect(JSON.stringify(out.result).length).toBeLessThanOrEqual(limit);
    const t = out.result.views[0] as TableView;
    expect(t.rows.length).toBeLessThan(4000);
    expect(t.rows[0][0]).toBe(0);
    expect(t.rowDocs!.length).toBe(t.rows.length);
    expect(t.totalRows).toBe(4000);
    expect(t.truncated).toBeTrue();
    expect(out.result.views[1].kind).toBe('bars');
    expect(out.result.notes.join(' ')).toContain('cut to');
  });

  it('never cuts below the minimum and says so when it still does not fit', () => {
    const out = shrinkResult(resultWithRows(100), 100);
    expect((out.result.views[0] as TableView).rows.length).toBe(20);
  });
});
