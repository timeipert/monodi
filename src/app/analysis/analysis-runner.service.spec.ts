import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { APIService } from '../api.service';
import { NotesStore } from '../notes-store';
import { AnalysisRunnerService } from './analysis-runner.service';
import { AnalysisStore } from './analysis-store';
import type { AnalysisDefinition, MethodStatus } from './analysis-types';
import { InlineMethodRunner, MethodRunner, RunHooks, RunJob } from './method-runner';

/** A document tree with one line; each syllable is `[text, pitches as diatonic indexes]`. */
function tree(syllables: [string, number[]][]): any {
  const bases = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  return {
    kind: 'RootContainer', uuid: 'r', comments: [], documentType: 'Neumes',
    children: [{
      kind: 'ZeileContainer', uuid: 'z',
      children: syllables.map(([text, pitches], i) => ({
        kind: 'Syllable', uuid: `s${i}`, text, syllableType: 'Normal',
        notes: { spaced: [{ nonSpaced: [{ grouped: pitches.map((p, k) => ({ uuid: `n${i}_${k}`, noteType: 'Normal', base: bases[p % 7], octave: Math.floor(p / 7), liquescent: false, focus: false })) }] }] },
      })),
    }],
  };
}

const DOCS = ['ana-t-1', 'ana-t-2', 'ana-t-3', 'ana-t-4'].map((id, i) => ({
  id, quelle_id: i < 2 ? 'src-a' : 'src-b', dokumenten_id: `Doc ${i + 1}`, textinitium: `Inc ${i + 1}`, gattung1: i % 2 ? 'Antiphon' : 'Responsory',
  gattung2: '', festtag: '', feier: '', bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
}));
const SOURCES = [{ id: 'src-a', quellensigle: 'A' }, { id: 'src-b', quellensigle: 'B' }];

describe('AnalysisRunnerService', () => {
  let svc: AnalysisRunnerService;
  let def: AnalysisDefinition;
  let inline: InlineMethodRunner;
  let runCalls: RunJob[][];
  let statuses: Record<string, MethodStatus>;
  const cb = () => ({ onStatus: (id: string, st: MethodStatus) => { statuses[id] = st; } });

  beforeEach(async () => {
    const api = {
      listDocuments: () => of({ kind: 'DocumentsRetrieved', documents: DOCS }),
      listSources: () => of({ kind: 'SourcesRetrieved', sources: SOURCES }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: APIService, useValue: api }] });
    svc = TestBed.inject(AnalysisRunnerService);
    inline = new InlineMethodRunner();
    runCalls = [];
    const spying: MethodRunner = {
      run: (corpus, jobs, hooks: RunHooks) => { runCalls.push(jobs); return inline.run(corpus, jobs, hooks); },
      cancel: () => inline.cancel(),
    };
    svc.setRunner(spying);
    statuses = {};
    for (let i = 0; i < DOCS.length; i++) {
      await NotesStore.set(DOCS[i].id, tree([['Ky-', [29 + i, 30]], ['rie', [31, 29 + i, 28]], ['e', [29]]]));
    }
    def = await AnalysisStore.create('Test', { docIds: DOCS.map((d) => d.id), origin: 'manual', label: 'four documents' }, [
      { id: 'axis', params: { size: 2, ordered: false, groupBy: '', minChants: 1, rows: 100 } },
      { id: 'syllable-groups', params: { groupBy: '', minChants: 2, showCount: 0, rows: 100 } },
      { id: 'bridges', params: { minNucleus: 2, minTotal: 4, minCount: 1, rows: 100 } },
    ]);
  });

  afterEach(async () => {
    await AnalysisStore.deleteAll();
    await NotesStore.removeMany(DOCS.map((d) => d.id));
  });

  it('computes the ticked methods and stores each result with its fingerprint', async () => {
    const summary = await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    expect(summary.ran.sort()).toEqual(['axis', 'syllable-groups']);
    expect(summary.cached).toEqual([]);
    expect(statuses['axis'].state).toBe('fresh');
    const rec = await AnalysisStore.getResult(def.id, 'axis');
    expect(rec!.fingerprint.length).toBeGreaterThan(10);
    expect(Object.keys(rec!.digests).length).toBe(4);
    expect(rec!.result.docCount).toBe(4);
  });

  it('opens again without recomputing: a second run reuses every valid stored result', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    expect(runCalls.length).toBe(1);
    const again = await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    expect(again.cached.sort()).toEqual(['axis', 'syllable-groups']);
    expect(again.ran).toEqual([]);
    expect(runCalls.length).toBe(1); // the runner was not called a second time
  });

  it('recomputes only the method whose parameters changed', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    def.methods.find((m) => m.id === 'axis')!.params['size'] = 3;
    const again = await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    expect(again.ran).toEqual(['axis']);
    expect(again.cached).toEqual(['syllable-groups']);
    expect(runCalls[1].map((j) => j.id)).toEqual(['axis']);
  });

  it('force recomputes even a valid result', async () => {
    await svc.run(def, ['axis'], 't', cb());
    const again = await svc.run(def, ['axis'], 't', cb(), { force: true });
    expect(again.ran).toEqual(['axis']);
  });

  it('tells which results are stale after a melody edit: only methods that read the melody', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    expect(await svc.checkFreshness(def, 't')).toEqual({ axis: { state: 'fresh' }, 'syllable-groups': { state: 'fresh' } });
    await NotesStore.set('ana-t-2', tree([['Ky-', [40, 41]], ['rie', [31, 30, 28]], ['e', [29]]])); // other notes, same text
    const check = (await svc.checkFreshness(def, 't'))!;
    expect(check['axis']).toEqual(jasmine.objectContaining({ state: 'stale', changed: 1, removed: 0 }));
    expect(check['syllable-groups']).toEqual({ state: 'fresh' });
  });

  it('a text edit makes the text method stale but not the melody method', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    await NotesStore.set('ana-t-1', tree([['Ky-', [29, 30]], ['ri-', [31, 29, 28]], ['e', [29]]])); // 'rie' became 'ri-'
    const check = (await svc.checkFreshness(def, 't'))!;
    expect(check['axis']).toEqual({ state: 'fresh' });
    expect(check['syllable-groups'].state).toBe('stale');
  });

  it('an edit that changes neither melody nor text keeps every result valid', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    const root = tree([['Ky-', [29, 30]], ['rie', [31, 29, 28]], ['e', [29]]]);
    root.comments = [{ startUUID: 'a', endUUID: 'b', text: 'a new comment' }];
    await NotesStore.set('ana-t-1', root);
    const check = (await svc.checkFreshness(def, 't'))!;
    expect(check['axis'].state).toBe('fresh');
    expect(check['syllable-groups'].state).toBe('fresh');
  });

  it('a changed metadata field makes every method that reads metadata stale', async () => {
    await svc.run(def, ['axis', 'syllable-groups'], 't', cb());
    const original = DOCS[0].gattung1;
    DOCS[0].gattung1 = 'Hymn';
    try {
      const check = (await svc.checkFreshness(def, 't'))!;
      expect(check['axis'].state).toBe('stale');
      expect(check['syllable-groups'].state).toBe('stale');
    } finally {
      DOCS[0].gattung1 = original;
    }
  });

  describe('leaving chants and words out', () => {
    it('a rule leaves matching chants out of every method, and the result says how many chants it used', async () => {
      def.filters = { exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'inc 1' }], stopWords: { builtIn: false, custom: [] } };
      const summary = await svc.run(def, ['axis'], 't', cb());
      expect(summary.excludedDocs).toBe(1);
      const rec = await AnalysisStore.getResult(def.id, 'axis');
      expect(rec!.result.docCount).toBe(3);
      expect(rec!.filtersKey).toContain('doc:textinitium');
      expect(Object.keys(rec!.digests).length).toBe(3);
    });

    it('changing the rules makes the stored result invalid: the next run computes again, an unchanged run does not', async () => {
      await svc.run(def, ['axis'], 't', cb());
      def.filters = { exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'inc 2' }], stopWords: { builtIn: false, custom: [] } };
      const again = await svc.run(def, ['axis'], 't', cb());
      expect(again.ran).toEqual(['axis']);
      const third = await svc.run(def, ['axis'], 't', cb());
      expect(third.cached).toEqual(['axis']);
    });

    it('a check for changes names the changed rules as the reason', async () => {
      await svc.run(def, ['axis'], 't', cb());
      def.filters = { exclude: [], stopWords: { builtIn: true, custom: [] } };
      const check = (await svc.checkFreshness(def, 't'))!;
      expect(check['axis'].state).toBe('stale');
      expect((check['axis'] as { reason: string }).reason).toContain('left out');
    });

    it('with rules a method that does not read the metadata still notices a changed field', async () => {
      def.filters = { exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'inc 1' }], stopWords: { builtIn: false, custom: [] } };
      await svc.run(def, ['bridges'], 't', cb()); // bridges reads melody and text only
      const original = DOCS[2].textinitium;
      DOCS[2].textinitium = 'Inc 1 changed'; // now a rule matches this chant as well
      try {
        const check = (await svc.checkFreshness(def, 't'))!;
        expect(check['bridges'].state).toBe('stale');
      } finally {
        DOCS[2].textinitium = original;
      }
    });
  });

  it('a removed document is reported and left out of a new run', async () => {
    const ghost: AnalysisDefinition = { ...def, corpus: { ...def.corpus, docIds: [...def.corpus.docIds, 'ana-t-gone'] } };
    const summary = await svc.run(ghost, ['axis'], 't', cb());
    expect(summary.missingDocs).toBe(1);
    const rec = await AnalysisStore.getResult(def.id, 'axis');
    expect(rec!.result.docCount).toBe(4);
  });

  it('reports a cancelled run and keeps no half result', async () => {
    const stopper: MethodRunner = { run: async () => 'cancelled', cancel: () => undefined };
    svc.setRunner(stopper);
    const summary = await svc.run(def, ['axis'], 't', cb());
    expect(summary.cancelled).toBeTrue();
    expect(await AnalysisStore.getResult(def.id, 'axis')).toBeNull();
  });

  it('reports a method that fails without losing the others', async () => {
    const failing: MethodRunner = {
      run: async (_c, jobs, hooks) => { hooks.onError(jobs[0].id, 'boom'); return 'done'; },
      cancel: () => undefined,
    };
    svc.setRunner(failing);
    const summary = await svc.run(def, ['axis'], 't', cb());
    expect(summary.failed).toEqual([{ id: 'axis', message: 'boom' }]);
    expect(statuses['axis'].state).toBe('error');
  });
});
