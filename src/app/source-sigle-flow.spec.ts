import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import * as localforage from 'localforage';
import { APIService, Document, Source } from './api.service';
import { NotesStore } from './notes-store';
import { GithubService } from './github.service';
import { GithubSessionService } from './github-session.service';
import { LocalWorkspaceSource } from './workspace-source';
import { PushCache } from './push-cache';

/**
 * A siglum rename and a merge from the first write to the files on GitHub: what is stored, what the push cache keeps
 * for the next push, and in which order a push puts it on a (mocked) remote. The point of the order: the documents of
 * an absorbed source must be on GitHub in their new source before the old source's files are deleted, whatever
 * selection of manuscripts is pushed in between.
 */
describe('Renaming and merging a siglum, through to the push', () => {
  const TOKEN = 't';
  let mockStore: Map<string, any>;
  let api: APIService;
  let github: GithubService;
  let remoteFiles: Map<string, string>;
  /** Per commit, in order: the paths it uploads and the paths it deletes. */
  let commits: { uploads: string[]; deletes: string[] }[];

  function makeOctokit() {
    remoteFiles = new Map();
    commits = [];
    let n = 0;
    let pending: { uploads: string[]; deletes: string[] } = { uploads: [], deletes: [] };
    return {
      rest: {
        repos: { getBranch: async () => ({ data: { commit: { sha: 'c0', commit: { tree: { sha: 't0' } } } } }) },
        git: {
          getTree: async () => ({ data: { tree: [...remoteFiles.entries()].map(([path, content]) => ({ type: 'blob', path, sha: 'sha:' + content.length + ':' + hash(content) })), truncated: false } }),
          createTree: async (p: any) => {
            pending = { uploads: [], deletes: [] };
            for (const e of p.tree) {
              if (e.sha === null) { remoteFiles.delete(e.path); pending.deletes.push(e.path); }
              else if (e.content !== undefined) { remoteFiles.set(e.path, e.content); pending.uploads.push(e.path); }
            }
            return { data: { sha: 't' + (++n) } };
          },
          createBlob: async () => ({ data: { sha: 'b' + (++n) } }),
          createCommit: async () => { commits.push(pending); return { data: { sha: 'c' + (++n) } }; },
          updateRef: async () => ({ data: {} }),
        },
      },
    };
  }

  /** The push compares git blob SHAs it computes itself with the tree's; this mock cannot know them, so it never skips by SHA. */
  const hash = (s: string) => s.length;

  const source = (id: string, sigle: string, more: any = {}): Source => ({
    id, quellensigle: sigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '',
    bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...more,
  } as Source);
  const doc = (id: string, quelle_id: string): Document => ({
    id, quelle_id, dokumenten_id: id.toUpperCase(), gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '',
    bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
  } as Document);

  const stored = <T>(key: string) => mockStore.get(key) as T;
  const remoteMeta = (id: string) => JSON.parse(remoteFiles.get(`manuscripts/${id}.json`) ?? 'null');

  beforeEach(async () => {
    mockStore = new Map<string, any>();
    spyOn(localforage, 'getItem').and.callFake(async (key: string) => mockStore.has(key) ? mockStore.get(key) : null);
    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => { mockStore.set(key, JSON.parse(JSON.stringify(value))); return value; });
    spyOn(localforage, 'removeItem').and.callFake(async (key: string) => { mockStore.delete(key); });
    (NotesStore as any).migrationPromise = null;
    (PushCache as any).cleanIds = null;
    (PushCache as any).deletedIds = null;
    (PushCache as any).deletedAfter = null;

    const docs = [doc('da1', 'ms-a'), doc('da2', 'ms-a'), doc('db1', 'ms-b'), doc('db2', 'ms-b'), doc('dc1', 'ms-c')];
    mockStore.set('monodi_sources', [source('ms-a', 'S-a', { herkunftsort: 'Aachen' }), source('ms-b', 'S-b'), source('ms-c', 'S-c')]);
    mockStore.set('monodi_documents', docs);
    for (const d of docs) mockStore.set('monodi_notes_doc_' + d.id, { notes: d.id });
    mockStore.set('monodi_notes_index', docs.map((d) => d.id));
    mockStore.set('monodi_notes_migrated_v1', true);
    mockStore.set('monodi_settings', { quellensigle: ['S-a', 'S-b', 'S-c'], pdfScale: 0.5 });

    TestBed.configureTestingModule({ providers: [APIService] });
    api = TestBed.inject(APIService);
    await new Promise((r) => setTimeout(r, 30));      // the service's own start-up reads

    const toastr = jasmine.createSpyObj('ToastrService', ['error', 'success', 'info']);
    github = new GithubService(toastr, new GithubSessionService());
    (github as any).octokit = makeOctokit();
    (github as any).config = { token: 'x', owner: 'o', repo: 'r', branch: 'main' };
    expect(await github.pushDatabase(new LocalWorkspaceSource(), 'first')).toBeTrue();
    commits.length = 0;
  });

  const change = (sourceId: string, newSigle: string, choices?: any) => firstValueFrom(api.changeSigle(TOKEN, { sourceId, newSigle, choices }));

  describe('a rename', () => {
    it('stores the new siglum and the settings that repeat it, and no document is touched', async () => {
      const docsBefore = JSON.stringify(stored('monodi_documents'));
      const res = await change('ms-b', 'S-b2');
      expect(res.kind).toBe('SigleChanged');
      expect(stored<Source[]>('monodi_sources').map((s) => s.quellensigle)).toEqual(['S-a', 'S-b2', 'S-c']);
      expect(stored<any>('monodi_settings').quellensigle).toEqual(['S-a', 'S-b2', 'S-c']);
      expect(stored<any>('monodi_settings').pdfScale).toBe(0.5);
      expect(JSON.stringify(stored('monodi_documents'))).toBe(docsBefore);
    });

    it('marks that source, and only that one, for the next push, which uploads its file and nothing else', async () => {
      await change('ms-b', 'S-b2');
      expect(await PushCache.getCleanIds()).toEqual(new Set(['ms-a', 'ms-c']));
      expect(await PushCache.getPendingDeletions()).toEqual(new Set());
      await github.pushDatabase(new LocalWorkspaceSource(), 'rename');
      const uploaded = ([] as string[]).concat(...commits.map((c) => c.uploads)).filter((p) => !p.startsWith('manuscripts/ms-b/'));
      expect(uploaded.filter((p) => p !== 'settings.json')).toEqual(['manuscripts/ms-b.json']);
      expect(remoteMeta('ms-b').source.quellensigle).toBe('S-b2');
    });

    it('is followed by the settings when the siglum is edited in place, as the metadata grid does', async () => {
      await firstValueFrom(api.updateSourcesMetadata(TOKEN, [{ id: 'ms-b', fields: { quellensigle: 'S-b3' } }]));
      expect(stored<Source[]>('monodi_sources')[1].quellensigle).toBe('S-b3');
      expect(stored<any>('monodi_settings').quellensigle).toEqual(['S-a', 'S-b3', 'S-c']);
    });

    it('leaves the settings alone when sigla are swapped in place (they cannot be followed one after the other)', async () => {
      await firstValueFrom(api.updateSourcesMetadata(TOKEN, [{ id: 'ms-a', fields: { quellensigle: 'S-b' } }, { id: 'ms-b', fields: { quellensigle: 'S-a' } }]));
      expect(stored<any>('monodi_settings').quellensigle).toEqual(['S-a', 'S-b', 'S-c']);
    });

    it('reaches the next call: the API serves the new siglum', async () => {
      await change('ms-b', 'S-b2');
      const res: any = await firstValueFrom(api.getSigle(TOKEN, 'ms-b'));
      expect(res.sigle).toBe('S-b2');
    });
  });

  describe('a merge', () => {
    it('moves the documents to the source that stays and removes the other one, with the notes where they were', async () => {
      const res: any = await change('ms-b', 'S-a');
      expect(res.kind).toBe('SigleChanged');
      expect(stored<Source[]>('monodi_sources').map((s) => s.id)).toEqual(['ms-a', 'ms-c']);
      expect(stored<Document[]>('monodi_documents').map((d) => [d.id, d.quelle_id])).toEqual(
        [['da1', 'ms-a'], ['da2', 'ms-a'], ['db1', 'ms-a'], ['db2', 'ms-a'], ['dc1', 'ms-c']]);
      expect(stored<any>('monodi_notes_doc_db1')).toEqual({ notes: 'db1' });
      expect(stored<any>('monodi_settings').quellensigle).toEqual(['S-a', 'S-c']);
      expect((await firstValueFrom(api.listDocuments(TOKEN)) as any).documents.length).toBe(5);
    });

    it('marks the stayed source for upload and the absorbed one for deletion after it', async () => {
      await change('ms-b', 'S-a');
      expect(await PushCache.getCleanIds()).toEqual(new Set(['ms-c']));
      expect(await PushCache.getPendingDeletions()).toEqual(new Set(['ms-b']));
      expect(await PushCache.getDeletionOrder()).toEqual(new Map([['ms-b', 'ms-a']]));
    });

    it('applies the chosen value of a conflicting field', async () => {
      (stored<Source[]>('monodi_sources')[1] as any).herkunftsort = 'Bonn';
      api.invalidateCache();
      await change('ms-b', 'S-a', { herkunftsort: 'other' });
      expect(stored<Source[]>('monodi_sources')[0].herkunftsort).toBe('Bonn');
    });

    it('writes nothing when the merge is refused', async () => {
      const docs = stored<Document[]>('monodi_documents');
      docs.push({ ...docs[0], quelle_id: 'ms-b', textinitium: 'different' });
      api.invalidateCache();
      const before = JSON.stringify([...mockStore.entries()]);
      const res = await change('ms-b', 'S-a');
      expect(res.kind).toBe('SigleChangeRefused');
      expect(JSON.stringify([...mockStore.entries()])).toBe(before);
    });

    it('is not undone by a push of some other selection: the old files stay until the new source is uploaded', async () => {
      await change('ms-b', 'S-a');
      await github.pushDatabase(new LocalWorkspaceSource(), 'only c', undefined, new Set(['ms-c']));
      expect(remoteFiles.has('manuscripts/ms-b.json')).toBeTrue();
      expect([...remoteFiles.keys()].some((p) => p.startsWith('manuscripts/ms-b/'))).toBeTrue();
      expect(remoteMeta('ms-a').documents.length).toBe(2);       // not uploaded yet
      expect(await PushCache.getPendingDeletions()).toEqual(new Set(['ms-b']));   // still waiting
    });

    it('uploads the stayed source before it deletes the absorbed one, and then nothing is left waiting', async () => {
      await change('ms-b', 'S-a');
      await github.pushDatabase(new LocalWorkspaceSource(), 'only c', undefined, new Set(['ms-c']));
      commits.length = 0;
      await github.pushDatabase(new LocalWorkspaceSource(), 'merge', undefined, new Set(['ms-a']));

      expect(remoteMeta('ms-a').documents.map((d: any) => d.id)).toEqual(['da1', 'da2', 'db1', 'db2']);
      expect([...remoteFiles.keys()].filter((p) => p.includes('ms-b'))).toEqual([]);
      const lastUpload = commits.map((c, i) => c.uploads.length ? i : -1).reduce((a, b) => Math.max(a, b), -1);
      const firstDelete = commits.findIndex((c) => c.deletes.some((p) => p.includes('ms-b')));
      expect(firstDelete).toBeGreaterThan(-1);
      expect(firstDelete).toBeGreaterThan(lastUpload);
      expect(await PushCache.getPendingDeletions()).toEqual(new Set());
      expect(await PushCache.getCleanIds()).toContain('ms-a');
    });

    it('does the same in one push of everything', async () => {
      await change('ms-b', 'S-a');
      await github.pushDatabase(new LocalWorkspaceSource(), 'all');
      expect(remoteMeta('ms-a').documents.length).toBe(4);
      expect(remoteFiles.has('manuscripts/ms-b.json')).toBeFalse();
      expect(remoteFiles.get('manuscripts/ms-a/notes-0000.json')).toContain('db2');
    });

    it('does not delete the old files while the absorbed source still exists locally (a merge cut off half way)', async () => {
      await PushCache.markDirty('ms-a');
      await PushCache.markDeleted('ms-b', 'ms-a');      // as a merge writes it first; the lists are not changed yet
      await github.pushDatabase(new LocalWorkspaceSource(), 'cut off');
      expect(remoteFiles.has('manuscripts/ms-b.json')).toBeTrue();
      expect(await PushCache.getPendingDeletions()).toEqual(new Set(['ms-b']));
    });
  });
});
