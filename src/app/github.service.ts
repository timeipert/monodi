import { Injectable } from '@angular/core';
import { Octokit } from '@octokit/rest';
import { ToastrService } from 'ngx-toastr';
import * as localforage from 'localforage';

export interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  /** What is being worked on right now, e.g. a manuscript sigle. */
  detail?: string;
  /** Payload progress, so the bar reflects real work rather than file counts. */
  bytesDone?: number;
  bytesTotal?: number;
  /** How many manuscripts were already up to date and skipped. */
  skipped?: number;
  /** Rough seconds remaining, derived from throughput so far. */
  etaSeconds?: number;
}

export type ProgressCallback = (p: SyncProgress) => void;

/**
 * Supplies the workspace to the sync layer lazily, one manuscript at a time,
 * so a multi-GB corpus never has to exist in memory all at once.
 */
export interface ManuscriptSource {
  listIds(): Promise<string[]>;
  /** Source record + document records only — small, no note payloads. */
  loadMeta(id: string): Promise<{ source: any | null; documents: any[] }>;
  /**
   * Hands over one document's notes at a time. Lets the push chunk a
   * manuscript whose full note payload would be far too big to hold, let
   * alone send in one request.
   */
  streamNotes(id: string, onNote: (docId: string, note: any) => Promise<void>): Promise<void>;
  load(id: string): Promise<Bundle>;
  loadSettings(): Promise<any>;
}

/**
 * Runs `worker` over every item with at most `concurrency` promises in flight.
 * Reports progress as each item settles. Keeps large syncs responsive and
 * gives the UI something to show instead of an opaque spinner.
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onSettled?: () => void
): Promise<void> {
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
      if (onSettled) onSettled();
    }
  };
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    runners.push(runNext());
  }
  await Promise.all(runners);
}

/** A single entry in a Git tree: inline `content`, an existing `sha`, or `sha: null` to delete. */
type TreeEntry =
  | { path: string; mode: '100644'; type: 'blob'; content: string }
  | { path: string; mode: '100644'; type: 'blob'; sha: string | null };

/**
 * Payload budget for one createTree request. The Trees API creates blobs
 * inline, so one request can carry many files — the number of API calls
 * scales with total bytes instead of file count. Starts here and halves
 * automatically if a request fails, so a connection that can't cope with a
 * given payload size backs off instead of failing forever.
 */
const PUSH_BATCH_BYTES_START = 2 * 1024 * 1024;

/** Never shrink adaptive batches below this. */
const PUSH_BATCH_BYTES_MIN = 128 * 1024;

/**
 * Target size for one notes chunk file.
 *
 * A whole manuscript's neume data can run to hundreds of MB, which is far
 * too much for a single HTTP request — that is what "works for the metadata,
 * breaks on the documents" was. Notes are therefore split across
 * `manuscripts/<id>/notes-NN.json` files of roughly this size, so no single
 * request is ever large. File *count* is cheap now that batches are sized by
 * bytes, but we still chunk by size rather than one-file-per-chant: tens of
 * thousands of entries would overflow the recursive tree listing (~7 MB)
 * and come back truncated.
 */
const PUSH_NOTES_CHUNK_BYTES = 1024 * 1024;

/** Above this, a file is sent as its own blob rather than inline in a tree. */
const PUSH_BIG_FILE_BYTES = 4 * 1024 * 1024;

/** How much serialized content pass 1 may keep, to avoid serializing twice. */
const PUSH_CACHE_BUDGET_BYTES = 48 * 1024 * 1024;

/** Deletions carry no payload, so they batch far more aggressively. */
const PUSH_DELETE_BATCH = 500;

/** Abort a single request after this long, so a stalled socket can't hang the sync. */
const REQUEST_TIMEOUT_MS = 120000;

/** Path prefix holding one manuscript's notes chunks. */
function notesChunkPath(manuscriptId: string, index: number): string {
  return `manuscripts/${manuscriptId}/notes-${String(index).padStart(4, '0')}.json`;
}

/**
 * Runs a request under a timeout. Octokit/fetch will otherwise wait forever
 * on a half-open connection, which the user experiences as a frozen sync
 * rather than an error that could be retried.
 */
function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fn(ctrl.signal).finally(() => clearTimeout(timer));
}

/** UTF-8 byte length of a string (not the same as `.length` for non-ASCII). */
function byteLength(s: string): number {
  return new Blob([s]).size;
}

/**
 * Computes the Git blob SHA-1 for a UTF-8 string, exactly as Git/GitHub does:
 * sha1("blob " + byteLength + "\0" + bytes). Lets us tell which files already
 * exist unchanged on the remote so we can skip re-uploading them.
 */
async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header, 0);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Retries a request with exponential backoff + jitter. Covers GitHub's
 * secondary rate limits (403/429) and transient server errors (5xx), but
 * crucially ALSO plain network failures (dropped wifi, DNS hiccup, a fetch
 * that throws `TypeError: Failed to fetch`) — those errors carry no HTTP
 * status at all, so a naive "retry only on 403/429/5xx" check silently lets
 * them straight through and kills a long sync on a single blip. Over a sync
 * making thousands of requests, at least one such blip is close to certain.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status;
      // A response-less error (network failure, aborted fetch, CORS hiccup)
      // has `status === undefined` — treat it as retriable too.
      const retriable = status === undefined || status === 403 || status === 429
        || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retriable || attempt === attempts - 1) throw e;
      const retryAfter = Number(e?.response?.headers?.['retry-after']);
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * Math.pow(2, attempt), 30000);
      const jitter = backoff * (0.75 + Math.random() * 0.5); // ±25%, avoids thundering herd
      await new Promise(res => setTimeout(res, jitter));
    }
  }
  throw lastErr;
}

export interface Db {
  sources: any[];
  documents: any[];
  notes: { [docId: string]: any };
  settings: any;
}

/** One manuscript's slice of the database, stored as a single file on GitHub. */
export interface Bundle {
  source: any | null;
  documents: any[];
  notes: { [docId: string]: any };
}

/** Flattens a manuscript bundle back into the flat database being assembled. */
function mergeBundleIntoDb(bundle: Bundle, db: Db): void {
  if (bundle.source) db.sources.push(bundle.source);
  if (Array.isArray(bundle.documents)) {
    for (const doc of bundle.documents) db.documents.push(doc);
  }
  if (bundle.notes) {
    for (const docId of Object.keys(bundle.notes)) db.notes[docId] = bundle.notes[docId];
  }
}

@Injectable({
  providedIn: 'root'
})
export class GithubService {
  private octokit: Octokit | null = null;
  public config: GithubConfig | null = null;

  constructor(private toastr: ToastrService) {
    this.loadConfig();
  }

  private async loadConfig() {
    const saved = localStorage.getItem('monodi_github_config');
    if (saved) {
      this.config = JSON.parse(saved);
      this.initOctokit();
    } else {
      try {
        const backup = await localforage.getItem<string>('monodi_github_config_backup');
        if (backup) {
          this.config = JSON.parse(backup);
          localStorage.setItem('monodi_github_config', backup);
          this.initOctokit();
        }
      } catch (e) {
        console.error('Failed to load GitHub config backup from localforage:', e);
      }
    }
  }

  public saveConfig(config: GithubConfig) {
    this.config = config;
    const configStr = JSON.stringify(config);
    localStorage.setItem('monodi_github_config', configStr);
    localforage.setItem('monodi_github_config_backup', configStr).catch(err => {
      console.error('Failed to save GitHub config backup to localforage:', err);
    });
    this.initOctokit();
  }

  public clearConfig() {
    this.config = null;
    this.octokit = null;
    localStorage.removeItem('monodi_github_config');
    localforage.removeItem('monodi_github_config_backup').catch(err => {
      console.error('Failed to clear GitHub config backup from localforage:', err);
    });
  }

  private initOctokit() {
    if (this.config && this.config.token) {
      this.octokit = new Octokit({ auth: this.config.token });
    }
  }

  public get isConnected(): boolean {
    return this.octokit !== null && this.config !== null;
  }

  public async testConnection(): Promise<boolean> {
    if (!this.octokit || !this.config) return false;
    try {
      await this.octokit.rest.repos.get({
        owner: this.config.owner,
        repo: this.config.repo
      });
      return true;
    } catch(e) {
      return false;
    }
  }

  private decodeContent(content: string): string {
    return decodeURIComponent(escape(atob(content)));
  }

  private encodeContent(content: string): string {
    return btoa(unescape(encodeURIComponent(content)));
  }

  /**
   * Lists the manuscript ids currently stored on the remote (v2 layout).
   * Cheap — reads only the tree, no blobs — so the selection dialog can offer
   * manuscripts that exist remotely but aren't held locally.
   */
  public async listRemoteManuscriptIds(): Promise<string[]> {
    if (!this.octokit || !this.config) return [];
    try {
      const treeResp = await withRetry(() => this.octokit!.rest.git.getTree({
        owner: this.config!.owner,
        repo: this.config!.repo,
        tree_sha: this.config!.branch,
        recursive: 'true'
      }));
      return treeResp.data.tree
        .filter(i => i.type === 'blob' && i.path?.startsWith('manuscripts/') && i.path.endsWith('.json')
          && !/\/notes-\d+\.json$/.test(i.path)) // chunk files aren't manuscripts
        .map(i => i.path!.replace('manuscripts/', '').replace(/\.json$/, ''));
    } catch (e: any) {
      if (e.status === 404 || e.status === 409) return [];
      console.error(e);
      return [];
    }
  }

  /**
   * Streams remote manuscript bundles one at a time.
   *
   * Each bundle is handed to `onBundle` and then released, so the caller can
   * merge a multi-GB corpus without the whole remote side ever being resident
   * in memory. Blobs are prefetched a few at a time for network throughput,
   * but callbacks run strictly sequentially — they write to IndexedDB, and
   * NotesStore's index row is read-modify-write, so concurrent callbacks
   * would race and lose entries.
   *
   * Returns false if the repository still uses the legacy per-chant layout,
   * in which case the caller should fall back to `pullDatabase`.
   */
  public async streamManuscripts(
    onBundle: (id: string, bundle: Bundle) => Promise<void>,
    onProgress?: ProgressCallback,
    only?: Set<string>
  ): Promise<boolean> {
    if (!this.octokit || !this.config) return false;

    if (onProgress) onProgress({ phase: 'Reading repository index…', current: 0, total: 0 });

    let treeResp;
    try {
      treeResp = await withRetry(() => this.octokit!.rest.git.getTree({
        owner: this.config!.owner,
        repo: this.config!.repo,
        tree_sha: this.config!.branch,
        recursive: 'true'
      }));
    } catch (e: any) {
      if (e.status === 404 || e.status === 409) return true; // empty repo: nothing to stream
      throw e;
    }

    // A manuscript is a metadata file plus zero or more notes chunks. Older
    // pushes kept the notes inside the metadata file; both are read here.
    const metaFiles = treeResp.data.tree.filter(i =>
      i.type === 'blob' && i.sha && i.path?.startsWith('manuscripts/') &&
      i.path.endsWith('.json') && !/\/notes-\d+\.json$/.test(i.path));

    const chunksByManuscript = new Map<string, any[]>();
    for (const i of treeResp.data.tree) {
      if (i.type !== 'blob' || !i.sha || !i.path) continue;
      const m = /^manuscripts\/(.+)\/notes-\d+\.json$/.exec(i.path);
      if (!m) continue;
      const list = chunksByManuscript.get(m[1]) || [];
      list.push(i);
      chunksByManuscript.set(m[1], list);
    }
    for (const list of chunksByManuscript.values()) {
      list.sort((a, b) => a.path.localeCompare(b.path));
    }

    // Legacy repo (one file per chant): caller falls back to the old path.
    if (metaFiles.length === 0) {
      const hasLegacy = treeResp.data.tree.some(i =>
        i.type === 'blob' && (i.path?.startsWith('sources/') || i.path?.startsWith('documents/') || i.path?.startsWith('notes/')));
      if (hasLegacy) return false;
      return true;
    }

    const wanted = metaFiles.filter(i => {
      if (!only) return true;
      const id = i.path!.replace('manuscripts/', '').replace(/\.json$/, '');
      return only.has(id);
    });

    // The tree carries each blob's size, so the bar can track real bytes.
    const bytesTotal = wanted.reduce((sum, i) => {
      const id = i.path!.replace('manuscripts/', '').replace(/\.json$/, '');
      const chunkBytes = (chunksByManuscript.get(id) || []).reduce((s, c) => s + (c.size || 0), 0);
      return sum + (i.size || 0) + chunkBytes;
    }, 0);
    let bytesDone = 0;
    let done = 0;
    const startedAt = Date.now();

    const report = (detail?: string) => {
      if (!onProgress) return;
      const elapsed = (Date.now() - startedAt) / 1000;
      const etaSeconds = bytesDone > 0 && bytesTotal > bytesDone
        ? Math.round(elapsed * (bytesTotal - bytesDone) / bytesDone)
        : undefined;
      onProgress({
        phase: 'Merging from GitHub', detail,
        current: done, total: wanted.length,
        bytesDone, bytesTotal, etaSeconds
      });
    };

    report();

    const fetchBlob = async (sha: string): Promise<string> => {
      const r = await withRetry(() => withTimeout(signal => this.octokit!.rest.git.getBlob({
        owner: this.config!.owner,
        repo: this.config!.repo,
        file_sha: sha,
        request: { signal }
      })));
      return this.decodeContent(r.data.content);
    };

    const PREFETCH = 4;
    for (let i = 0; i < wanted.length; i += PREFETCH) {
      const group = wanted.slice(i, i + PREFETCH);
      const metas: (string | null)[] = await Promise.all(group.map(item => fetchBlob(item.sha!)));

      for (let j = 0; j < group.length; j++) {
        const id = group[j].path!.replace('manuscripts/', '').replace(/\.json$/, '');
        const raw = metas[j]!;
        metas[j] = null; // release the encoded copy before parsing
        const parsed = JSON.parse(raw);

        const bundle: Bundle = {
          source: parsed.source ?? null,
          documents: parsed.documents ?? [],
          // Pushes before notes were split out kept them inline.
          notes: parsed.notes ?? {}
        };
        bytesDone += group[j].size || 0;
        report(id);

        // Pull this manuscript's notes chunks in sequence, merging as we go.
        for (const c of (chunksByManuscript.get(id) || [])) {
          const chunkRaw = await fetchBlob(c.sha!);
          Object.assign(bundle.notes, JSON.parse(chunkRaw));
          bytesDone += c.size || 0;
          report(id);
        }

        await onBundle(id, bundle);
        done++;
        report(id);
      }
    }

    report();
    return true;
  }

  /** Reads just `settings.json` (small) without pulling the rest of the repo. */
  public async getRemoteSettings(): Promise<any | null> {
    if (!this.octokit || !this.config) return null;
    try {
      const resp = await withRetry(() => this.octokit!.rest.repos.getContent({
        owner: this.config!.owner,
        repo: this.config!.repo,
        path: 'settings.json',
        ref: this.config!.branch
      }));
      const data: any = resp.data;
      if (Array.isArray(data) || data.type !== 'file' || !data.content) return null;
      return JSON.parse(this.decodeContent(data.content.replace(/\n/g, '')));
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Pulls the whole (or a scoped subset of the) database. Wraps the actual
   * work in an outer retry: if the operation fails partway (typically a
   * transient network error mid-way through hundreds of requests), the whole
   * pull is simply re-attempted rather than surfacing a "frozen"/dead sync to
   * the user. This is cheap to redo — nothing was mutated remotely — and far
   * more robust than expecting every individual request to never fail.
   */
  public async pullDatabase(onProgress?: ProgressCallback, only?: Set<string>): Promise<Db | null> {
    if (!this.octokit || !this.config) return null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.pullDatabaseOnce(onProgress, only);
      } catch (e: any) {
        if (e?.status === 404 || e?.status === 409) {
          // Repository is empty or branch doesn't exist yet — not an error.
          return { sources: [], documents: [], notes: {}, settings: null };
        }
        if (e?.nonRetriable) {
          this.toastr.error(e.message);
          return null;
        }
        console.error(`Pull attempt ${attempt}/${maxAttempts} failed`, e);
        if (attempt === maxAttempts) {
          this.toastr.error('Pull failed after several attempts. Please check your connection and try again.');
          return null;
        }
        const waitMs = 4000 * attempt;
        if (onProgress) onProgress({ phase: `Connection issue — retrying whole pull in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})…`, current: 0, total: 0 });
        await new Promise(res => setTimeout(res, waitMs));
      }
    }
    return null;
  }

  private async pullDatabaseOnce(onProgress?: ProgressCallback, only?: Set<string>): Promise<Db> {
      const db: Db = { sources: [] as any[], documents: [] as any[], notes: {} as any, settings: null as any };

      if (onProgress) onProgress({ phase: 'Reading repository index…', current: 0, total: 0 });

      const treeResp = await withRetry(() => this.octokit!.rest.git.getTree({
        owner: this.config!.owner,
        repo: this.config!.repo,
        tree_sha: this.config!.branch,
        recursive: "true"
      }));

      if (treeResp.data.truncated) {
        // GitHub caps the recursive tree response; beyond that limit files are
        // silently omitted, so a partial pull would look like data loss. This
        // is permanent for this repo size, so don't waste attempts retrying it.
        const err: any = new Error('Repository is too large to pull in one request (GitHub truncated the file list). Try a selective pull of specific manuscripts instead.');
        err.nonRetriable = true;
        throw err;
      }

      // v2 layout stores one bundle per manuscript under `manuscripts/`.
      // Legacy layout stored one file per chant under sources/documents/notes.
      // We read whichever is present (v2 wins) so old repos still open.
      const hasV2 = treeResp.data.tree.some(item =>
        item.type === 'blob' && item.path?.startsWith('manuscripts/') && item.path.endsWith('.json'));

      const blobs = treeResp.data.tree.filter(item => {
        if (item.type !== 'blob' || !item.path || !item.sha) return false;
        if (item.path === 'settings.json') return true;
        if (hasV2) {
          if (!(item.path.startsWith('manuscripts/') && item.path.endsWith('.json'))) return false;
          if (only) {
            const id = item.path.replace('manuscripts/', '').replace(/\.json$/, '');
            return only.has(id);
          }
          return true;
        }
        return (
          (item.path.startsWith('sources/') && item.path.endsWith('.json')) ||
          (item.path.startsWith('documents/') && item.path.endsWith('.json')) ||
          (item.path.startsWith('notes/') && item.path.endsWith('.json'))
        );
      });

      const total = blobs.length;
      let done = 0;
      if (onProgress) onProgress({ phase: 'Downloading files', current: 0, total });

      await runPool(blobs, 6, async (item) => {
        const file = await withRetry(() => this.octokit!.rest.git.getBlob({
          owner: this.config!.owner,
          repo: this.config!.repo,
          file_sha: item.sha!
        }));
        const parsed = JSON.parse(this.decodeContent(file.data.content));
        const path = item.path!;
        if (path === 'settings.json') {
          db.settings = parsed;
        } else if (/^manuscripts\/.+\/notes-\d+\.json$/.test(path)) {
          // A notes chunk: a plain { docId: notes } map, not a bundle.
          Object.assign(db.notes, parsed);
        } else if (path.startsWith('manuscripts/')) {
          mergeBundleIntoDb(parsed as Bundle, db);
        } else if (path.startsWith('sources/')) {
          db.sources.push(parsed);
        } else if (path.startsWith('documents/')) {
          db.documents.push(parsed);
        } else if (path.startsWith('notes/')) {
          const docId = path.replace('notes/', '').replace('.json', '');
          db.notes[docId] = parsed;
        }
      }, () => {
        done++;
        if (onProgress) onProgress({ phase: 'Downloading files', current: done, total });
      });

      return db;
  }

  /**
   * Pushes the whole (or a scoped subset of the) database. Like
   * {@link pullDatabase}, this wraps the real work in an outer retry: the
   * batched-commit + SHA-skip design means a re-attempt after a mid-way
   * failure is cheap (unchanged manuscripts are simply skipped again) and
   * safe, so most transient failures now resolve themselves without the
   * user having to notice or press Push again.
   */
  public async pushDatabase(source: ManuscriptSource, message: string, onProgress?: ProgressCallback, only?: Set<string>): Promise<boolean> {
    if (!this.octokit || !this.config) return false;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.pushDatabaseOnce(source, message, onProgress, only);
        return true;
      } catch (e) {
        console.error(`Push attempt ${attempt}/${maxAttempts} failed`, e);
        if (attempt === maxAttempts) {
          this.toastr.error('Push failed after several attempts. Progress committed so far is saved on GitHub — press Push again to resume.');
          return false;
        }
        const waitMs = 5000 * attempt;
        if (onProgress) onProgress({ phase: `Connection issue — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})…`, current: 0, total: 0 });
        await new Promise(res => setTimeout(res, waitMs));
      }
    }
    return false;
  }

  private async pushDatabaseOnce(source: ManuscriptSource, message: string, onProgress?: ProgressCallback, only?: Set<string>): Promise<void> {
        if (!this.octokit || !this.config) throw new Error('Not connected to GitHub');
        if (onProgress) onProgress({ phase: 'Preparing…', current: 0, total: 0 });
        let latestCommitSha: string | undefined = undefined;
        let baseTreeSha: string | undefined = undefined;
        let isInitialCommit = false;

        try {
          const branchResp = await this.octokit.rest.repos.getBranch({
            owner: this.config.owner,
            repo: this.config.repo,
            branch: this.config.branch
          });
          latestCommitSha = branchResp.data.commit.sha;
          baseTreeSha = branchResp.data.commit.commit.tree.sha;
        } catch (e: any) {
          if (e.status === 404 || e.status === 409) {
            isInitialCommit = true; // Branch doesn't exist yet, we will create it
          } else {
            throw e;
          }
        }

        if (isInitialCommit) {
           // Initialize empty repo to avoid 409 error on createTree
           await this.octokit.rest.repos.createOrUpdateFileContents({
             owner: this.config.owner,
             repo: this.config.repo,
             path: 'README.md',
             message: 'Initial commit by Monodi-Light',
             content: btoa('Repository initialized by Monodi-Light'),
             branch: this.config.branch
           });
           
           // Fetch the newly created branch info
           const branchResp = await this.octokit.rest.repos.getBranch({
             owner: this.config.owner,
             repo: this.config.repo,
             branch: this.config.branch
           });
           latestCommitSha = branchResp.data.commit.sha;
           baseTreeSha = branchResp.data.commit.commit.tree.sha;
           isInitialCommit = false; // We now have a base commit!
        }

        // Fetch the current remote tree so we can skip manuscripts that are
        // already identical (matching Git blob SHA). On a re-sync most of the
        // corpus is unchanged and never needs to be sent at all.
        const remoteShaByPath = new Map<string, string>();
        try {
          const existing = await withRetry(() => this.octokit!.rest.git.getTree({
            owner: this.config!.owner,
            repo: this.config!.repo,
            tree_sha: baseTreeSha!,
            recursive: 'true'
          }));
          for (const item of existing.data.tree) {
            if (item.type === 'blob' && item.path && item.sha) {
              remoteShaByPath.set(item.path, item.sha);
            }
          }
        } catch (e) {
          // Non-fatal: without the remote tree we simply upload everything.
          console.warn('Could not read remote tree; uploading all files.', e);
        }

        // ---- Pass 1: scan ------------------------------------------------
        // Serialize each manuscript one at a time to get its Git SHA and
        // size, then throw the string away again. This tells us exactly what
        // changed and how many bytes are due — without ever holding the whole
        // workspace in memory. Small payloads are cached so the common case
        // doesn't pay for serializing twice.
        let ids = await source.listIds();
        if (only) ids = ids.filter(id => only.has(id));
        ids.sort();

        type Pending = { path: string; size: number; cached: string | null; manuscriptId: string; chunk: number };
        const pending: Pending[] = [];
        let cacheBudget = PUSH_CACHE_BUDGET_BYTES;
        let skipped = 0;
        let bytesTotal = 0;
        /** Every path this push intends the repo to end up with. */
        const expectedPaths = new Set<string>();

        const considerFile = async (path: string, content: string, manuscriptId = '', chunk = -1) => {
          expectedPaths.add(path);
          const size = byteLength(content);
          const localSha = await gitBlobSha(content);
          if (remoteShaByPath.get(path) === localSha) {
            skipped++;
            return; // already on GitHub, byte for byte
          }
          let cached: string | null = null;
          if (size <= cacheBudget) { cached = content; cacheBudget -= size; }
          pending.push({ path, size, cached, manuscriptId, chunk });
          bytesTotal += size;
        };

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (onProgress) onProgress({
            phase: 'Scanning workspace', current: i, total: ids.length,
            detail: id, skipped
          });

          // Metadata only — small, and separate from the heavy neume data so
          // a huge manuscript no longer produces one unsendable file.
          // Compact JSON: indentation can be a third of the bytes on deeply
          // nested data, and this payload is machine-written anyway.
          const meta = await source.loadMeta(id);
          await considerFile(`manuscripts/${id}.json`, JSON.stringify(meta));

          // Notes are packed into size-bounded chunks, streamed one document
          // at a time so the full manuscript is never resident.
          let chunkIndex = 0;
          let chunk: { [docId: string]: any } = {};
          let chunkBytes = 0;
          let chunkCount = 0;

          const flushChunk = async () => {
            if (chunkCount === 0) return;
            await considerFile(notesChunkPath(id, chunkIndex), JSON.stringify(chunk), id, chunkIndex);
            chunkIndex++;
            chunk = {}; chunkBytes = 0; chunkCount = 0;
          };

          await source.streamNotes(id, async (docId, note) => {
            const piece = JSON.stringify(note);
            const pieceBytes = piece.length + docId.length + 8;
            if (chunkCount > 0 && chunkBytes + pieceBytes > PUSH_NOTES_CHUNK_BYTES) {
              await flushChunk();
            }
            chunk[docId] = note;
            chunkBytes += pieceBytes;
            chunkCount++;
          });
          await flushChunk();
        }

        // A scoped push leaves everything else on the remote untouched,
        // including global settings and other manuscripts.
        if (!only) {
          const settings = await source.loadSettings();
          if (settings) await considerFile('settings.json', JSON.stringify(settings));
          expectedPaths.add('README.md');
        }

        const deletions: TreeEntry[] = [];
        for (const path of remoteShaByPath.keys()) {
          // Leftover legacy per-chant files from before the manuscripts/ layout.
          if (!only && (path.startsWith('sources/') || path.startsWith('documents/') || path.startsWith('notes/'))) {
            deletions.push({ path, mode: '100644', type: 'blob', sha: null });
            continue;
          }
          // Stale notes chunks: a manuscript that shrank, or one previously
          // written as a single bundle before notes were split out.
          const m = /^manuscripts\/(.+)\/notes-\d+\.json$/.exec(path);
          if (m && !expectedPaths.has(path)) {
            const owner = m[1];
            if (!only || only.has(owner)) {
              deletions.push({ path, mode: '100644', type: 'blob', sha: null });
            }
          }
        }

        if (pending.length === 0 && deletions.length === 0) {
          if (onProgress) onProgress({ phase: 'Already up to date', current: 1, total: 1, skipped });
          return;
        }

        // ---- Pass 2: upload ----------------------------------------------
        // Batch by *payload size*, not file count, and let the Trees API
        // create the blobs inline. One request carries many manuscripts, so
        // the call count scales with total bytes rather than file count —
        // and no single request is ever huge.
        let currentTreeSha = baseTreeSha!;
        let currentCommitSha = latestCommitSha!;
        let bytesDone = 0;
        let filesDone = 0;
        let commitIndex = 0;
        const startedAt = Date.now();

        // Batches shrink automatically when a request fails, so a connection
        // that can't cope with a given payload size adapts instead of
        // retrying the same doomed request over and over.
        let batchLimit = PUSH_BATCH_BYTES_START;

        const report = (phase: string, detail?: string) => {
          if (!onProgress) return;
          const elapsed = (Date.now() - startedAt) / 1000;
          // Only offer an ETA once there's a real sample. Extrapolating from
          // the first few seconds (which include connection setup) produced
          // alarming "6 hours remaining" guesses that were pure noise.
          const enoughSamples = elapsed >= 15 && bytesDone >= bytesTotal * 0.05;
          const etaSeconds = enoughSamples && bytesDone > 0 && bytesTotal > bytesDone
            ? Math.round(elapsed * (bytesTotal - bytesDone) / bytesDone)
            : undefined;
          onProgress({
            phase, detail,
            current: filesDone, total: pending.length,
            bytesDone, bytesTotal, skipped, etaSeconds
          });
        };

        const sendBatch = async (entries: TreeEntry[]) => {
          const newTree = await withRetry(() => withTimeout(signal => this.octokit!.rest.git.createTree({
            owner: this.config!.owner,
            repo: this.config!.repo,
            base_tree: currentTreeSha,
            tree: entries as any,
            request: { signal }
          })));

          // Nothing actually changed in this batch — don't make an empty commit.
          if (newTree.data.sha === currentTreeSha) return;

          commitIndex++;
          const newCommit = await withRetry(() => withTimeout(signal => this.octokit!.rest.git.createCommit({
            owner: this.config!.owner,
            repo: this.config!.repo,
            message: `${message} [${commitIndex}]`,
            tree: newTree.data.sha,
            parents: [currentCommitSha],
            request: { signal }
          })));
          // Advancing the branch after every batch is what makes the push
          // resumable: an interruption keeps everything committed so far.
          await withRetry(() => withTimeout(signal => this.octokit!.rest.git.updateRef({
            owner: this.config!.owner,
            repo: this.config!.repo,
            ref: `heads/${this.config!.branch}`,
            sha: newCommit.data.sha,
            request: { signal }
          })));
          currentTreeSha = newTree.data.sha;
          currentCommitSha = newCommit.data.sha;
        };

        /** Sends a batch, splitting it in half on failure rather than giving up. */
        const commitBatch = async (entries: TreeEntry[], batchBytes: number, depth = 0): Promise<void> => {
          if (entries.length === 0) return;
          try {
            await sendBatch(entries);
          } catch (e) {
            if (entries.length > 1 && depth < 8) {
              batchLimit = Math.max(PUSH_BATCH_BYTES_MIN, Math.floor(batchLimit / 2));
              console.warn(`Batch of ${entries.length} failed; splitting (limit now ${batchLimit} bytes)`, e);
              const mid = Math.ceil(entries.length / 2);
              await commitBatch(entries.slice(0, mid), Math.floor(batchBytes / 2), depth + 1);
              await commitBatch(entries.slice(mid), batchBytes - Math.floor(batchBytes / 2), depth + 1);
              return;
            }
            throw e;
          }

          bytesDone += batchBytes;
          // Deletions (sha: null) aren't "files uploaded", so don't count them.
          filesDone += entries.filter(e => !('sha' in e && e.sha === null)).length;
          report('Uploading');
        };

        /** Re-serializes one pending file when pass 1 couldn't cache it. */
        const materialize = async (item: Pending): Promise<string> => {
          if (item.cached !== null) return item.cached;
          if (item.path === 'settings.json') return JSON.stringify(await source.loadSettings());
          if (item.chunk < 0) {
            const id = item.path.replace('manuscripts/', '').replace(/\.json$/, '');
            return JSON.stringify(await source.loadMeta(id));
          }
          // Rebuild exactly the same chunk by replaying the same packing.
          const wanted = item.chunk;
          let index = 0, bytes = 0, count = 0;
          let chunk: { [docId: string]: any } = {};
          let result: string | null = null;
          await source.streamNotes(item.manuscriptId, async (docId, note) => {
            if (result !== null) return;
            const piece = JSON.stringify(note);
            const pieceBytes = piece.length + docId.length + 8;
            if (count > 0 && bytes + pieceBytes > PUSH_NOTES_CHUNK_BYTES) {
              if (index === wanted) { result = JSON.stringify(chunk); return; }
              index++; chunk = {}; bytes = 0; count = 0;
            }
            chunk[docId] = note;
            bytes += pieceBytes; count++;
          });
          if (result !== null) return result;
          return JSON.stringify(chunk);
        };

        let batch: TreeEntry[] = [];
        let batchBytes = 0;

        for (const item of pending) {
          report('Uploading', item.manuscriptId || item.path);
          const content = await materialize(item);
          item.cached = null; // release as soon as it's been used

          if (item.size > PUSH_BIG_FILE_BYTES) {
            // Still too big to ride along inline — flush what we have, then
            // send this one as its own blob.
            await commitBatch(batch, batchBytes);
            batch = []; batchBytes = 0;

            const blob = await withRetry(() => withTimeout(signal => this.octokit!.rest.git.createBlob({
              owner: this.config!.owner,
              repo: this.config!.repo,
              content: this.encodeContent(content),
              encoding: 'base64',
              request: { signal }
            })));
            await commitBatch([{ path: item.path, mode: '100644', type: 'blob', sha: blob.data.sha }], item.size);
            continue;
          }

          if (batchBytes + item.size > batchLimit && batch.length > 0) {
            await commitBatch(batch, batchBytes);
            batch = []; batchBytes = 0;
          }
          batch.push({ path: item.path, mode: '100644', type: 'blob', content });
          batchBytes += item.size;
        }
        await commitBatch(batch, batchBytes);

        // Legacy cleanup last: deletions carry no payload, so they can go in
        // large chunks.
        for (let i = 0; i < deletions.length; i += PUSH_DELETE_BATCH) {
          report('Cleaning up old files');
          await commitBatch(deletions.slice(i, i + PUSH_DELETE_BATCH), 0);
        }

        if (onProgress) onProgress({
          phase: 'Done', current: pending.length, total: pending.length,
          bytesDone, bytesTotal, skipped
        });
  }

  /**
   * Reads a single manuscript bundle directly via the Contents API — no tree
   * walk, no batching. This is the entry point a tool that only ever needs
   * one manuscript at a time (e.g. a neume editor working on a single piece)
   * should use instead of pullDatabase.
   */
  public async getManuscript(id: string): Promise<Bundle | null> {
    if (!this.octokit || !this.config) return null;
    let found: Bundle | null = null;
    try {
      const ok = await this.streamManuscripts(async (_id, bundle) => { found = bundle; },
        undefined, new Set([id]));
      if (!ok) return null; // legacy layout
      return found;
    } catch (e: any) {
      console.error(e);
      this.toastr.error('Failed to load manuscript from GitHub');
      return null;
    }
  }

  /**
   * Writes one manuscript — metadata file plus size-bounded notes chunks —
   * in a single commit. The cheap path for saving one manuscript's worth of
   * edits, and the entry point a tool that works on a single piece (e.g. a
   * neume editor) should use instead of a full database sync.
   */
  public async putManuscript(id: string, bundle: Bundle, message: string): Promise<boolean> {
    if (!this.octokit || !this.config) return false;
    try {
      const branch = await withRetry(() => this.octokit!.rest.repos.getBranch({
        owner: this.config!.owner,
        repo: this.config!.repo,
        branch: this.config!.branch
      }));
      const baseTreeSha = branch.data.commit.commit.tree.sha;

      const entries: TreeEntry[] = [{
        path: `manuscripts/${id}.json`,
        mode: '100644', type: 'blob',
        content: JSON.stringify({ source: bundle.source, documents: bundle.documents })
      }];

      // Same chunking the full push uses, so the two stay interchangeable.
      const written = new Set<string>();
      let index = 0, chunkBytes = 0, count = 0;
      let chunk: { [docId: string]: any } = {};
      const flush = () => {
        if (count === 0) return;
        const path = notesChunkPath(id, index);
        entries.push({ path, mode: '100644', type: 'blob', content: JSON.stringify(chunk) });
        written.add(path);
        index++; chunk = {}; chunkBytes = 0; count = 0;
      };
      for (const docId of Object.keys(bundle.notes || {}).sort()) {
        const pieceBytes = JSON.stringify(bundle.notes[docId]).length + docId.length + 8;
        if (count > 0 && chunkBytes + pieceBytes > PUSH_NOTES_CHUNK_BYTES) flush();
        chunk[docId] = bundle.notes[docId];
        chunkBytes += pieceBytes; count++;
      }
      flush();

      // Drop chunks this manuscript no longer needs.
      const existing = await withRetry(() => this.octokit!.rest.git.getTree({
        owner: this.config!.owner, repo: this.config!.repo,
        tree_sha: baseTreeSha, recursive: 'true'
      }));
      for (const item of existing.data.tree) {
        if (item.type !== 'blob' || !item.path) continue;
        const m = /^manuscripts\/(.+)\/notes-\d+\.json$/.exec(item.path);
        if (m && m[1] === id && !written.has(item.path)) {
          entries.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
        }
      }

      const newTree = await withRetry(() => this.octokit!.rest.git.createTree({
        owner: this.config!.owner, repo: this.config!.repo,
        base_tree: baseTreeSha, tree: entries as any
      }));
      const newCommit = await withRetry(() => this.octokit!.rest.git.createCommit({
        owner: this.config!.owner, repo: this.config!.repo,
        message, tree: newTree.data.sha, parents: [branch.data.commit.sha]
      }));
      await withRetry(() => this.octokit!.rest.git.updateRef({
        owner: this.config!.owner, repo: this.config!.repo,
        ref: `heads/${this.config!.branch}`, sha: newCommit.data.sha
      }));
      return true;
    } catch (e) {
      console.error(e);
      this.toastr.error('Failed to save manuscript to GitHub');
      return false;
    }
  }
}
