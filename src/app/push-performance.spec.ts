import * as localforage from 'localforage';
import { NotesStore } from './notes-store';
import { GithubService } from './github.service';
import { LocalWorkspaceSource } from './workspace-source';
import { PushCache } from './push-cache';

/**
 * End-to-end proof of the actual complaint: "pushing again right after a
 * push still takes far too long." These drive the real GithubService against
 * a mocked Octokit (no network) and assert on *how many requests it made and
 * what they touched* — not just that the result is correct, but that a
 * repeat push with nothing changed does effectively no work, and that an
 * edit to one manuscript only ever touches that one manuscript.
 */
describe('Push performance (repeat pushes and dirty tracking)', () => {
  let mockStore: Map<string, any>;
  let github: GithubService;
  let calls: { getTree: number; getBranch: number; createTree: any[]; createBlob: any[]; commits: number };
  let remoteFiles: Map<string, string>; // path -> raw content, keyed by a synthetic sha
  let shaCounter: number;

  function makeOctokitMock() {
    remoteFiles = new Map();
    shaCounter = 0;
    calls = { getTree: 0, getBranch: 0, createTree: [], createBlob: [], commits: 0 };

    return {
      rest: {
        repos: {
          getBranch: async () => {
            calls.getBranch++;
            return { data: { commit: { sha: 'c0', commit: { tree: { sha: 't0' } } } } };
          },
        },
        git: {
          getTree: async () => {
            calls.getTree++;
            const tree = Array.from(remoteFiles.entries()).map(([path, content]) => ({
              type: 'blob', path, sha: 'sha:' + path, size: content.length
            }));
            return { data: { tree, truncated: false } };
          },
          getBlob: async (p: any) => {
            const path = [...remoteFiles.keys()].find(k => 'sha:' + k === p.file_sha)!;
            return { data: { content: btoa(unescape(encodeURIComponent(remoteFiles.get(path)!))) } };
          },
          createTree: async (p: any) => {
            calls.createTree.push({ entries: p.tree.length, bytes: JSON.stringify(p.tree).length });
            for (const e of p.tree) {
              if (e.sha === null) remoteFiles.delete(e.path);
              else if (e.content !== undefined) remoteFiles.set(e.path, e.content);
            }
            return { data: { sha: 't' + (++shaCounter) } };
          },
          createBlob: async (p: any) => {
            calls.createBlob.push({ bytes: p.content.length });
            return { data: { sha: 'b' + (++shaCounter) } };
          },
          createCommit: async () => { calls.commits++; return { data: { sha: 'c' + (++shaCounter) } }; },
          updateRef: async () => ({ data: {} }),
        }
      }
    };
  }

  beforeEach(() => {
    mockStore = new Map<string, any>();
    spyOn(localforage, 'getItem').and.callFake(async (key: string) =>
      mockStore.has(key) ? mockStore.get(key) : null);
    spyOn(localforage, 'setItem').and.callFake(async (key: string, value: any) => {
      mockStore.set(key, value); return value;
    });
    spyOn(localforage, 'removeItem').and.callFake(async (key: string) => { mockStore.delete(key); });

    (NotesStore as any).migrationPromise = null;
    (PushCache as any).cleanIds = null;
    (PushCache as any).deletedIds = null;

    const toastr = jasmine.createSpyObj('ToastrService', ['error', 'success', 'info']);
    github = new GithubService(toastr);
    (github as any).octokit = makeOctokitMock();
    (github as any).config = { token: 'x', owner: 'o', repo: 'r', branch: 'main' };
  });

  /** Seeds a workspace with `n` manuscripts, one document/note each. */
  async function seedWorkspace(n: number) {
    const sources = [], documents = [];
    for (let i = 0; i < n; i++) {
      const id = 'ms-' + i;
      sources.push({ id, quellensigle: 'S' + i });
      documents.push({ id: 'd' + i, quelle_id: id, dokumenten_id: 'Doc ' + i });
      mockStore.set('monodi_notes_doc_d' + i, { n: 'v1' });
    }
    mockStore.set('monodi_sources', sources);
    mockStore.set('monodi_documents', documents);
    mockStore.set('monodi_notes_migrated_v1', true);
    mockStore.set('monodi_notes_index', documents.map(d => d.id));
  }

  it('a second push with nothing changed touches no manuscript notes and makes no upload calls', async () => {
    await seedWorkspace(20);

    const ok1 = await github.pushDatabase(new LocalWorkspaceSource(), 'first push');
    expect(ok1).toBeTrue();
    expect(calls.createBlob.length + calls.createTree.length).toBeGreaterThan(0); // did real work

    // Reset call counters and IndexedDB-read tracking, then push again with
    // nothing changed.
    (localforage.getItem as jasmine.Spy).calls.reset();
    calls.createTree = []; calls.createBlob = []; calls.commits = 0;

    const ok2 = await github.pushDatabase(new LocalWorkspaceSource(), 'second push');
    expect(ok2).toBeTrue();

    // The whole point: no notes were read, and nothing was uploaded or
    // committed — this is what makes the repeat push fast.
    const touchedNotes = (localforage.getItem as jasmine.Spy).calls.allArgs()
      .map(a => a[0]).filter(k => k.startsWith('monodi_notes_doc_'));
    expect(touchedNotes).toEqual([]);
    expect(calls.createBlob.length).toBe(0);
    expect(calls.createTree.length).toBe(0);
    expect(calls.commits).toBe(0);
  });

  it('editing one manuscript only rescans that one on the next push', async () => {
    await seedWorkspace(20);
    await github.pushDatabase(new LocalWorkspaceSource(), 'first push');

    // Simulate an edit to exactly one manuscript's notes, the way
    // api.service's updateDocument would (write + markDirty).
    mockStore.set('monodi_notes_doc_d5', { n: 'v2-edited' });
    await PushCache.markDirty('ms-5');

    (localforage.getItem as jasmine.Spy).calls.reset();
    const ok = await github.pushDatabase(new LocalWorkspaceSource(), 'second push');
    expect(ok).toBeTrue();

    const touchedNotes = (localforage.getItem as jasmine.Spy).calls.allArgs()
      .map(a => a[0]).filter(k => k.startsWith('monodi_notes_doc_'));
    expect(touchedNotes).toEqual(['monodi_notes_doc_d5']); // only the edited one

    // And the remote actually reflects the edit.
    expect(remoteFiles.get('manuscripts/ms-5/notes-0000.json')).toContain('v2-edited');
  });

  it('marks manuscripts clean only after the push actually completes', async () => {
    await seedWorkspace(3);

    // Always fails; pushDatabase's outer retry (3 attempts, real backoff
    // delays) will exhaust and report failure — this test's job is to check
    // that nothing got marked clean along the way, so the slower run time
    // is expected and the timeout below is sized for it.
    const alwaysFailingOctokit = makeOctokitMock();
    alwaysFailingOctokit.rest.repos.getBranch = async () => { throw Object.assign(new Error('down'), { status: 400 }); };
    (github as any).octokit = alwaysFailingOctokit;

    const ok = await github.pushDatabase(new LocalWorkspaceSource(), 'doomed push');
    expect(ok).toBeFalse();
    expect(await PushCache.getCleanIds()).toEqual(new Set());
  }, 25000);

  it('a manuscript deleted locally is removed from the remote on the next push', async () => {
    await seedWorkspace(3);
    await github.pushDatabase(new LocalWorkspaceSource(), 'first push');
    expect(remoteFiles.has('manuscripts/ms-1.json')).toBeTrue();

    // Simulate api.service.deleteSources: drop it locally, record the deletion.
    const sources = (mockStore.get('monodi_sources') as any[]).filter(s => s.id !== 'ms-1');
    const documents = (mockStore.get('monodi_documents') as any[]).filter(d => d.quelle_id !== 'ms-1');
    mockStore.set('monodi_sources', sources);
    mockStore.set('monodi_documents', documents);
    await PushCache.markDeleted(['ms-1']);

    await github.pushDatabase(new LocalWorkspaceSource(), 'deletion push');

    expect(remoteFiles.has('manuscripts/ms-1.json')).toBeFalse();
    expect(remoteFiles.has('manuscripts/ms-0.json')).toBeTrue(); // untouched
    expect(await PushCache.getPendingDeletions()).toEqual(new Set());
  });
});
