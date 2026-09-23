import * as localforage from 'localforage';
import * as _ from 'lodash';
import { NotesStore } from './notes-store';

/**
 * The streaming merge reconciles the remote repository one manuscript at a
 * time, so neither side is ever fully in memory. These tests exercise that
 * reconciliation logic directly (the same rules app.component applies in its
 * `onBundle` callback) to pin down the behaviour that matters:
 *
 *  - unambiguous changes are applied during the walk,
 *  - genuine conflicts are recorded WITHOUT payloads and left unapplied,
 *  - notes are read and written per document, never in bulk.
 */
describe('Streaming merge semantics', () => {
  let mockStore: Map<string, any>;

  beforeEach(() => {
    mockStore = new Map<string, any>();
    spyOn(localforage, 'getItem').and.callFake(async (key: string) =>
      mockStore.has(key) ? mockStore.get(key) : null);
    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => {
      mockStore.set(key, value); return value;
    });
    spyOn(localforage, 'removeItem').and.callFake(async (key: string) => { mockStore.delete(key); });
    (NotesStore as any).migrationPromise = null;
    mockStore.set('monodi_notes_migrated_v1', true);
    mockStore.set('monodi_notes_index', []);
  });

  /** Mirrors the reconciliation performed per manuscript during the walk. */
  async function mergeBundle(
    id: string,
    bundle: any,
    sourcesById: Map<string, any>,
    docsById: Map<string, any>,
    conflicts: any[]
  ): Promise<void> {
    if (bundle.source?.id) {
      const local = sourcesById.get(bundle.source.id);
      if (!local) sourcesById.set(bundle.source.id, bundle.source);
      else if (!_.isEqual(local, bundle.source)) {
        conflicts.push({ type: 'Source', id: bundle.source.id, sourceId: id, resolution: 'local' });
      }
    }
    for (const doc of (bundle.documents || [])) {
      if (!doc?.id) continue;
      const local = docsById.get(doc.id);
      if (!local) docsById.set(doc.id, doc);
      else if (!_.isEqual(local, doc)) {
        conflicts.push({ type: 'Document', id: doc.id, sourceId: id, resolution: 'local' });
      }
    }
    for (const docId of Object.keys(bundle.notes || {})) {
      const localNote = await NotesStore.get(docId);
      if (localNote === null || localNote === undefined) {
        await NotesStore.set(docId, bundle.notes[docId]);
      } else if (!_.isEqual(localNote, bundle.notes[docId])) {
        conflicts.push({ type: 'Notes', id: docId, sourceId: id, resolution: 'local' });
      }
    }
  }

  it('applies remote-only manuscripts during the walk', async () => {
    const sourcesById = new Map<string, any>();
    const docsById = new Map<string, any>();
    const conflicts: any[] = [];

    await mergeBundle('ms-a', {
      source: { id: 'ms-a', quellensigle: 'A-1' },
      documents: [{ id: 'd1', quelle_id: 'ms-a' }],
      notes: { d1: { n: 1 } }
    }, sourcesById, docsById, conflicts);

    expect(conflicts).toEqual([]);
    expect(sourcesById.get('ms-a')).toEqual({ id: 'ms-a', quellensigle: 'A-1' });
    expect(docsById.get('d1')).toEqual({ id: 'd1', quelle_id: 'ms-a' });
    expect(await NotesStore.get('d1')).toEqual({ n: 1 });
  });

  it('treats identical content as no conflict and no write', async () => {
    await NotesStore.set('d1', { n: 1 });
    const sourcesById = new Map([['ms-a', { id: 'ms-a' }]]);
    const docsById = new Map([['d1', { id: 'd1', quelle_id: 'ms-a' }]]);
    const conflicts: any[] = [];

    await mergeBundle('ms-a', {
      source: { id: 'ms-a' },
      documents: [{ id: 'd1', quelle_id: 'ms-a' }],
      notes: { d1: { n: 1 } }
    }, sourcesById, docsById, conflicts);

    expect(conflicts).toEqual([]);
    expect(await NotesStore.get('d1')).toEqual({ n: 1 });
  });

  it('records conflicts without payloads and leaves local data untouched', async () => {
    await NotesStore.set('d1', { n: 'local' });
    const sourcesById = new Map<string, any>([["ms-a", { id: "ms-a", quellensigle: "LOCAL" }]]);
    const docsById = new Map<string, any>([['d1', { id: 'd1', quelle_id: 'ms-a', festtag: 'local' }]]);
    const conflicts: any[] = [];

    await mergeBundle('ms-a', {
      source: { id: 'ms-a', quellensigle: 'REMOTE' },
      documents: [{ id: 'd1', quelle_id: 'ms-a', festtag: 'remote' }],
      notes: { d1: { n: 'remote' } }
    }, sourcesById, docsById, conflicts);

    expect(conflicts.map(c => c.type).sort()).toEqual(['Document', 'Notes', 'Source']);

    // Crucially: descriptors only. Carrying local/remote payloads for every
    // conflict is exactly what would put the whole corpus back in memory.
    for (const c of conflicts) {
      expect(c.local).toBeUndefined();
      expect(c.remote).toBeUndefined();
      expect(c.sourceId).toBe('ms-a');
    }

    // Nothing conflicting was applied.
    expect(sourcesById.get('ms-a').quellensigle).toBe('LOCAL');
    expect(docsById.get('d1').festtag).toBe('local');
    expect(await NotesStore.get('d1')).toEqual({ n: 'local' });
  });

  it('adds new chants of an otherwise conflicting manuscript', async () => {
    await NotesStore.set('d1', { n: 'local' });
    const sourcesById = new Map<string, any>();
    const docsById = new Map<string, any>([['d1', { id: 'd1', quelle_id: 'ms-a', v: 1 }]]);
    const conflicts: any[] = [];

    await mergeBundle('ms-a', {
      source: null,
      documents: [{ id: 'd1', quelle_id: 'ms-a', v: 2 }, { id: 'd2', quelle_id: 'ms-a' }],
      notes: { d1: { n: 'remote' }, d2: { n: 2 } }
    }, sourcesById, docsById, conflicts);

    // d1 conflicts both ways; d2 is simply new and applied.
    expect(conflicts.map(c => c.id).sort()).toEqual(['d1', 'd1']);
    expect(docsById.get('d2')).toEqual({ id: 'd2', quelle_id: 'ms-a' });
    expect(await NotesStore.get('d2')).toEqual({ n: 2 });
    expect(await NotesStore.get('d1')).toEqual({ n: 'local' });
  });

  it('never reads the whole notes store while merging', async () => {
    await NotesStore.set('other', { big: true });
    const getAllSpy = spyOn(NotesStore, 'getAll').and.callThrough();

    await mergeBundle('ms-a', {
      source: { id: 'ms-a' }, documents: [{ id: 'd1' }], notes: { d1: { n: 1 } }
    }, new Map(), new Map(), []);

    expect(getAllSpy).not.toHaveBeenCalled();
  });

  it('applying "take remote" overwrites only the chosen items', async () => {
    await NotesStore.set('d1', { n: 'local' });
    await NotesStore.set('d2', { n: 'local2' });
    const docsById = new Map<string, any>([
      ['d1', { id: 'd1', v: 'local' }],
      ['d2', { id: 'd2', v: 'local' }]
    ]);

    // User chose remote for d1's notes only.
    const bundle = {
      documents: [{ id: 'd1', v: 'remote' }, { id: 'd2', v: 'remote' }],
      notes: { d1: { n: 'remote' }, d2: { n: 'remote2' } }
    };
    const decisions = [{ type: 'Notes', id: 'd1' }];

    const noteWrites: any = {};
    for (const c of decisions) {
      if (c.type === 'Notes' && c.id in bundle.notes) {
        noteWrites[c.id] = (bundle.notes as any)[c.id];
      }
    }
    await NotesStore.merge(noteWrites);

    expect(await NotesStore.get('d1')).toEqual({ n: 'remote' });
    expect(await NotesStore.get('d2')).toEqual({ n: 'local2' }); // untouched
    expect(docsById.get('d1').v).toBe('local');                  // untouched
  });
});
