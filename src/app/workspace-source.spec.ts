import * as localforage from 'localforage';
import { NotesStore } from './notes-store';
import { LocalWorkspaceSource, ORPHAN_BUNDLE_ID } from './workspace-source';
import { PushCache } from './push-cache';

/**
 * These guard the streaming push path: it must produce exactly the same
 * manuscript bundles the old "load everything into memory, then group" code
 * did — without ever reading the whole notes store at once.
 */
describe('LocalWorkspaceSource', () => {
  let mockStore: Map<string, any>;

  beforeEach(() => {
    mockStore = new Map<string, any>();

    spyOn(localforage, 'getItem').and.callFake(async (key: string) => {
      return mockStore.has(key) ? mockStore.get(key) : null;
    });
    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => {
      mockStore.set(key, value);
      return value;
    });
    spyOn(localforage, 'removeItem').and.callFake(async (key: string) => {
      mockStore.delete(key);
    });

    (NotesStore as any).migrationPromise = null;
    (PushCache as any).cleanIds = null;
    (PushCache as any).deletedIds = null;
  });

  /** Seeds sources, documents and per-document notes into the mock store. */
  async function seed(sources: any[], documents: any[], notes: { [id: string]: any }) {
    mockStore.set('monodi_sources', sources);
    mockStore.set('monodi_documents', documents);
    mockStore.set('monodi_notes_migrated_v1', true);
    for (const id of Object.keys(notes)) {
      mockStore.set(`monodi_notes_doc_${id}`, notes[id]);
    }
    mockStore.set('monodi_notes_index', Object.keys(notes));
  }

  it('groups documents and notes under their owning manuscript', async () => {
    await seed(
      [{ id: 'ms-a', quellensigle: 'A-1' }, { id: 'ms-b', quellensigle: 'B-1' }],
      [
        { id: 'd1', quelle_id: 'ms-a' },
        { id: 'd2', quelle_id: 'ms-a' },
        { id: 'd3', quelle_id: 'ms-b' }
      ],
      { d1: { n: 1 }, d2: { n: 2 }, d3: { n: 3 } }
    );

    const src = new LocalWorkspaceSource();
    const ids = await src.listIds();
    expect(ids.sort()).toEqual(['ms-a', 'ms-b']);

    const a = await src.load('ms-a');
    expect(a.source).toEqual({ id: 'ms-a', quellensigle: 'A-1' });
    expect(a.documents.map((d: any) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(a.notes).toEqual({ d1: { n: 1 }, d2: { n: 2 } });

    const b = await src.load('ms-b');
    expect(b.documents.map((d: any) => d.id)).toEqual(['d3']);
    expect(b.notes).toEqual({ d3: { n: 3 } });
  });

  it('loads only the requested manuscript\'s notes, never the whole store', async () => {
    await seed(
      [{ id: 'ms-a' }, { id: 'ms-b' }],
      [{ id: 'd1', quelle_id: 'ms-a' }, { id: 'd2', quelle_id: 'ms-b' }],
      { d1: { n: 1 }, d2: { n: 2 } }
    );

    const getAllSpy = spyOn(NotesStore, 'getAll').and.callThrough();
    const src = new LocalWorkspaceSource();
    await src.listIds();
    await src.load('ms-a');

    // The whole point of the streaming source: getAll() would materialise a
    // multi-GB workspace and is exactly what used to kill the tab.
    expect(getAllSpy).not.toHaveBeenCalled();

    // And it must not have touched the other manuscript's notes row.
    const touched = (localforage.getItem as jasmine.Spy).calls.allArgs().map(a => a[0]);
    expect(touched).toContain('monodi_notes_doc_d1');
    expect(touched).not.toContain('monodi_notes_doc_d2');
  });

  it('keeps documents whose manuscript is missing, under their quelle_id', async () => {
    await seed([], [{ id: 'd1', quelle_id: 'ghost-ms' }], { d1: { n: 1 } });

    const src = new LocalWorkspaceSource();
    expect(await src.listIds()).toEqual(['ghost-ms']);

    const bundle = await src.load('ghost-ms');
    expect(bundle.source).toBeNull();
    expect(bundle.documents.map((d: any) => d.id)).toEqual(['d1']);
    expect(bundle.notes).toEqual({ d1: { n: 1 } });
  });

  it('rescues orphan documents and orphan notes so a push cannot drop them', async () => {
    await seed(
      [{ id: 'ms-a' }],
      [{ id: 'd1', quelle_id: 'ms-a' }, { id: 'd2' }], // d2 has no quelle_id
      { d1: { n: 1 }, d2: { n: 2 }, 'gone-doc': { n: 99 } } // notes with no document
    );

    const src = new LocalWorkspaceSource();
    const ids = await src.listIds();
    expect(ids).toContain(ORPHAN_BUNDLE_ID);

    const orphans = await src.load(ORPHAN_BUNDLE_ID);
    expect(orphans.documents.map((d: any) => d.id)).toEqual(['d2']);
    // Both the orphan document's notes and the document-less notes survive.
    expect(orphans.notes).toEqual({ d2: { n: 2 }, 'gone-doc': { n: 99 } });
  });

  it('round-trips the whole workspace without losing anything', async () => {
    const sources = [{ id: 'ms-a' }, { id: 'ms-b' }];
    const documents = [
      { id: 'd1', quelle_id: 'ms-a' },
      { id: 'd2', quelle_id: 'ms-b' },
      { id: 'd3' }
    ];
    const notes = { d1: { n: 1 }, d2: { n: 2 }, d3: { n: 3 }, orphan: { n: 4 } };
    await seed(sources, documents, notes);

    const src = new LocalWorkspaceSource();
    const rebuiltDocs: any[] = [];
    const rebuiltNotes: any = {};
    const rebuiltSources: any[] = [];

    for (const id of await src.listIds()) {
      const b = await src.load(id);
      if (b.source) rebuiltSources.push(b.source);
      rebuiltDocs.push(...b.documents);
      Object.assign(rebuiltNotes, b.notes);
    }

    expect(rebuiltSources.sort((a, b) => a.id.localeCompare(b.id))).toEqual(sources);
    expect(rebuiltDocs.map(d => d.id).sort()).toEqual(['d1', 'd2', 'd3']);
    expect(rebuiltNotes).toEqual(notes);
  });

  it('exposes settings separately', async () => {
    await seed([], [], {});
    mockStore.set('monodi_settings', { theme: 'dark' });
    expect(await new LocalWorkspaceSource().loadSettings()).toEqual({ theme: 'dark' });
  });

  describe('with PushCache (repeat-push performance)', () => {
    it('excludes manuscripts already marked clean', async () => {
      await seed(
        [{ id: 'ms-a' }, { id: 'ms-b' }, { id: 'ms-c' }],
        [{ id: 'd1', quelle_id: 'ms-a' }, { id: 'd2', quelle_id: 'ms-b' }, { id: 'd3', quelle_id: 'ms-c' }],
        { d1: { n: 1 }, d2: { n: 2 }, d3: { n: 3 } }
      );
      await PushCache.markClean(['ms-a', 'ms-c']);

      const ids = await new LocalWorkspaceSource().listIds();
      expect(ids.sort()).toEqual(['ms-b']);
    });

    it('with nothing marked clean (fresh cache), scans everything — same as before this feature existed', async () => {
      await seed(
        [{ id: 'ms-a' }, { id: 'ms-b' }],
        [{ id: 'd1', quelle_id: 'ms-a' }, { id: 'd2', quelle_id: 'ms-b' }],
        { d1: { n: 1 }, d2: { n: 2 } }
      );
      const ids = await new LocalWorkspaceSource().listIds();
      expect(ids.sort()).toEqual(['ms-a', 'ms-b']);
    });

    it('a manuscript marked dirty again after being clean is scanned once more', async () => {
      await seed([{ id: 'ms-a' }], [{ id: 'd1', quelle_id: 'ms-a' }], { d1: { n: 1 } });
      await PushCache.markClean(['ms-a']);
      expect(await new LocalWorkspaceSource().listIds()).toEqual([]);

      await PushCache.markDirty('ms-a');
      expect(await new LocalWorkspaceSource().listIds()).toEqual(['ms-a']);
    });

    it('never reads a clean manuscript\'s notes at all', async () => {
      await seed(
        [{ id: 'ms-a' }, { id: 'ms-b' }],
        [{ id: 'd1', quelle_id: 'ms-a' }, { id: 'd2', quelle_id: 'ms-b' }],
        { d1: { n: 1 }, d2: { n: 2 } }
      );
      await PushCache.markClean(['ms-a']);

      const src = new LocalWorkspaceSource();
      const ids = await src.listIds(); // what a real push loop would iterate
      for (const id of ids) await src.load(id);

      const touched = (localforage.getItem as jasmine.Spy).calls.allArgs().map(a => a[0]);
      expect(touched).not.toContain('monodi_notes_doc_d1'); // ms-a: skipped entirely
      expect(touched).toContain('monodi_notes_doc_d2');      // ms-b: still dirty, read normally
    });
  });
});
