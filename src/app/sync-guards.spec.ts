import { inSyncManuscripts, manuscriptsWithLocalOnlyDocuments } from './sync-guards';

describe('manuscriptsWithLocalOnlyDocuments', () => {
  const remote = (o: { [id: string]: string[] }) => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]));

  it('finds a visited manuscript that has a document the remote does not', () => {
    const local = [{ id: 'd1', quelle_id: 'a' }, { id: 'd2', quelle_id: 'a' }, { id: 'd3', quelle_id: 'b' }];
    expect(manuscriptsWithLocalOnlyDocuments(local, remote({ a: ['d1'], b: ['d3'] }))).toEqual(new Set(['a']));
  });

  it('is empty when the remote has every local document', () => {
    const local = [{ id: 'd1', quelle_id: 'a' }];
    expect(manuscriptsWithLocalOnlyDocuments(local, remote({ a: ['d1', 'd9'] })).size).toBe(0);
  });

  it('ignores manuscripts the walk did not visit (they are not claimed to be in sync)', () => {
    expect(manuscriptsWithLocalOnlyDocuments([{ id: 'd1', quelle_id: 'z' }], remote({ a: [] })).size).toBe(0);
  });

  it('counts a document that moved into the manuscript as local-only (a merge of two sources)', () => {
    // d3 used to be in b on the remote; locally it is in a now
    const local = [{ id: 'd1', quelle_id: 'a' }, { id: 'd3', quelle_id: 'a' }];
    expect(manuscriptsWithLocalOnlyDocuments(local, remote({ a: ['d1'], b: ['d3'] }))).toEqual(new Set(['a']));
  });

  it('puts documents without a source under the bundle for documents without one', () => {
    expect(manuscriptsWithLocalOnlyDocuments([{ id: 'd1', quelle_id: '' }], remote({ __unassigned__: [] }))).toEqual(new Set(['__unassigned__']));
  });
});

describe('inSyncManuscripts', () => {
  const remote = new Map([['a', new Set(['d1'])], ['b', new Set(['d2'])], ['c', new Set(['d3'])]]);
  const local = [{ id: 'd1', quelle_id: 'a' }, { id: 'd2', quelle_id: 'b' }, { id: 'd3', quelle_id: 'c' }, { id: 'd4', quelle_id: 'c' }];

  it('leaves out manuscripts with a conflict and those with a local-only document', () => {
    expect(inSyncManuscripts(['a', 'b', 'c'], new Set(['b']), local, remote)).toEqual(['a']);
  });
});
