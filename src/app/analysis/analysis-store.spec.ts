import * as localforage from 'localforage';
import type { MethodResult, TableView } from '@monodi/core/analysis';
import { AnalysisStore, AnalysisStoreError } from './analysis-store';
import type { ResultRecord } from './analysis-types';

function record(methodId: string, rows = 3): ResultRecord {
  const table: TableView = {
    kind: 'table', title: 'T', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
    rows: Array.from({ length: rows }, (_, i) => [i, `value ${i % 97}`]), totalRows: rows, truncated: false,
  };
  const result: MethodResult = { summary: 'done', docCount: 2, views: [table], notes: [] };
  return { methodId, methodVersion: 1, params: { n: 3 }, fingerprint: 'fp-' + methodId, digests: { d1: 'x', d2: 'y' }, computedAt: 1, durationMs: 5, bytes: 0, truncated: false, result };
}

describe('AnalysisStore', () => {
  afterEach(async () => { await AnalysisStore.deleteAll(); });

  it('creates an analysis with a sorted, duplicate-free corpus and lists it', async () => {
    const def = await AnalysisStore.create('First', { docIds: ['b', 'a', 'b'], origin: 'selection', label: 'test' }, [{ id: 'ngrams', params: {} }]);
    expect(def.corpus.docIds).toEqual(['a', 'b']);
    const list = await AnalysisStore.list();
    expect(list.length).toBe(1);
    expect(list[0]).toEqual(jasmine.objectContaining({ id: def.id, name: 'First', docCount: 2, methodIds: ['ngrams'], resultIds: [] }));
    expect((await AnalysisStore.get(def.id))!.name).toBe('First');
  });

  it('saves a rename and keeps the stored results listed', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, [{ id: 'axis', params: {} }]);
    await AnalysisStore.putResult(def.id, record('axis'));
    def.name = 'B';
    await AnalysisStore.save(def);
    const s = (await AnalysisStore.list())[0];
    expect(s.name).toBe('B');
    expect(s.resultIds).toEqual(['axis']);
  });

  it('stores one row per result and reads it back', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    const stored = await AnalysisStore.putResult(def.id, record('axis'));
    await AnalysisStore.putResult(def.id, record('ngrams'));
    expect(stored.bytes).toBeGreaterThan(0);
    expect(await localforage.getItem(AnalysisStore.resultKey(def.id, 'axis'))).not.toBeNull();
    const back = await AnalysisStore.getResult(def.id, 'axis');
    expect(back!.fingerprint).toBe('fp-axis');
    expect(back!.result.summary).toBe('done');
    expect(back!.bytes).toBe(stored.bytes); // a record read back knows its stored size
    expect((await AnalysisStore.list())[0].resultIds.sort()).toEqual(['axis', 'ngrams']);
    expect(await AnalysisStore.getResult(def.id, 'nope')).toBeNull();
  });

  it('replaces the result of a method instead of adding a second one', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    await AnalysisStore.putResult(def.id, record('axis', 3));
    const second = record('axis', 5);
    second.fingerprint = 'new';
    await AnalysisStore.putResult(def.id, second);
    expect((await AnalysisStore.list())[0].resultIds).toEqual(['axis']);
    expect((await AnalysisStore.getResult(def.id, 'axis'))!.fingerprint).toBe('new');
  });

  it('compresses a large result and reads it back unchanged', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    const big = record('ngrams', 40000);
    const stored = await AnalysisStore.putResult(def.id, big);
    const raw = await localforage.getItem<{ gz: boolean }>(AnalysisStore.resultKey(def.id, 'ngrams'));
    expect(raw!.gz).toBeTrue();
    expect(stored.bytes).toBeLessThan(JSON.stringify(big).length);
    const back = await AnalysisStore.getResult(def.id, 'ngrams');
    expect((back!.result.views[0] as TableView).rows.length).toBe(40000);
  });

  it('deleting an analysis removes its definition, its results and its line in the list', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    await AnalysisStore.putResult(def.id, record('axis'));
    await AnalysisStore.delete(def.id);
    expect(await AnalysisStore.list()).toEqual([]);
    expect(await localforage.getItem(AnalysisStore.defKey(def.id))).toBeNull();
    expect(await localforage.getItem(AnalysisStore.resultKey(def.id, 'axis'))).toBeNull();
  });

  it('reports the stored size', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    const before = await AnalysisStore.totalBytes();
    await AnalysisStore.putResult(def.id, record('axis', 500));
    expect(await AnalysisStore.totalBytes()).toBeGreaterThan(before);
  });

  describe('export and import', () => {
    it('round-trips an analysis with its results under a new id', async () => {
      const def = await AnalysisStore.create('Study', { docIds: ['a', 'b'], origin: 'selection', label: 'x' }, [{ id: 'axis', params: { size: 3 } }], 'a note');
      await AnalysisStore.putResult(def.id, record('axis'));
      const file = AnalysisStore.parseExport(JSON.parse(JSON.stringify(await AnalysisStore.exportOne(def.id))));
      expect(file.results.length).toBe(1);
      const copy = await AnalysisStore.importOne(file);
      expect(copy.id).not.toBe(def.id);
      expect(copy.name).toBe('Study (imported)');
      expect(copy.note).toBe('a note');
      expect((await AnalysisStore.getResult(copy.id, 'axis'))!.fingerprint).toBe('fp-axis');
      expect((await AnalysisStore.list()).length).toBe(2);
    });

    it('exports without results when asked', async () => {
      const def = await AnalysisStore.create('S', { docIds: ['a'], origin: 'manual', label: '' }, []);
      await AnalysisStore.putResult(def.id, record('axis'));
      expect((await AnalysisStore.exportOne(def.id, false)).results).toEqual([]);
    });

    it('rejects files that are not analyses or come from a newer version', () => {
      expect(() => AnalysisStore.parseExport({ nope: 1 })).toThrowError(AnalysisStoreError, /not a Monodi-Zero analysis/);
      expect(() => AnalysisStore.parseExport({ format: 'monodi-analysis', version: 99, analysis: {} })).toThrowError(/newer version/);
      expect(() => AnalysisStore.parseExport({ format: 'monodi-analysis', version: 1, analysis: { id: 'x' } })).toThrowError(/incomplete/);
    });
  });

  it('backs up and restores all analyses with their ids and results, replacing the ones that are there', async () => {
    const a = await AnalysisStore.create('One', { docIds: ['a'], origin: 'manual', label: '' }, [{ id: 'axis', params: {} }]);
    await AnalysisStore.putResult(a.id, record('axis'));
    const backup = JSON.parse(JSON.stringify(await AnalysisStore.exportAll()));
    expect(backup.length).toBe(1);
    const other = await AnalysisStore.create('Other', { docIds: ['b'], origin: 'manual', label: '' }, []);
    expect((await AnalysisStore.list()).length).toBe(2);
    expect(await AnalysisStore.restoreAll([...backup, { not: 'an analysis' }])).toBe(1);
    const list = await AnalysisStore.list();
    expect(list.map((s) => s.id)).toEqual([a.id]);
    expect(await AnalysisStore.get(other.id)).toBeNull();
    expect((await AnalysisStore.getResult(a.id, 'axis'))!.fingerprint).toBe('fp-axis');
  });

  it('turns a full browser store into a readable message', async () => {
    const def = await AnalysisStore.create('A', { docIds: ['a'], origin: 'manual', label: '' }, []);
    spyOn(localforage, 'setItem').and.rejectWith(new DOMException('full', 'QuotaExceededError'));
    await expectAsync(AnalysisStore.putResult(def.id, record('axis'))).toBeRejectedWithError(/no storage left/);
  });
});
