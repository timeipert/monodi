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
}

export type ProgressCallback = (p: SyncProgress) => void;

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

const ORPHAN_BUNDLE_ID = '__unassigned__';

/**
 * Regroups the flat database into one bundle per manuscript (keyed by source
 * id / document `quelle_id`). Documents with no source and notes with no
 * document land in a single `__unassigned__` bundle so nothing is lost.
 */
function groupIntoBundles(db: Db): Map<string, Bundle> {
  const bundles = new Map<string, Bundle>();
  const bundleFor = (id: string): Bundle => {
    let b = bundles.get(id);
    if (!b) { b = { source: null, documents: [], notes: {} }; bundles.set(id, b); }
    return b;
  };

  for (const source of db.sources) {
    if (source && source.id) bundleFor(source.id).source = source;
  }
  const docToBundle = new Map<string, string>();
  for (const doc of db.documents) {
    const key = (doc && doc.quelle_id) ? doc.quelle_id : ORPHAN_BUNDLE_ID;
    bundleFor(key).documents.push(doc);
    if (doc && doc.id) docToBundle.set(doc.id, key);
  }
  for (const docId of Object.keys(db.notes)) {
    const key = docToBundle.get(docId) || ORPHAN_BUNDLE_ID;
    bundleFor(key).notes[docId] = db.notes[docId];
  }
  return bundles;
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
        .filter(i => i.type === 'blob' && i.path?.startsWith('manuscripts/') && i.path.endsWith('.json'))
        .map(i => i.path!.replace('manuscripts/', '').replace(/\.json$/, ''));
    } catch (e: any) {
      if (e.status === 404 || e.status === 409) return [];
      console.error(e);
      return [];
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
  public async pushDatabase(db: Db, message: string, onProgress?: ProgressCallback, only?: Set<string>): Promise<boolean> {
    if (!this.octokit || !this.config) return false;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.pushDatabaseOnce(db, message, onProgress, only);
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

  private async pushDatabaseOnce(db: Db, message: string, onProgress?: ProgressCallback, only?: Set<string>): Promise<void> {
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

        // Store one bundle per manuscript instead of one file per chant. This
        // turns tens of thousands of tiny files into a few hundred, which is
        // the only way the initial upload of a large corpus stays feasible.
        const files: { path: string, content: string }[] = [];

        // A scoped push (only certain manuscripts) leaves everything else on
        // the remote untouched — including settings and other manuscripts.
        if (db.settings && !only) {
          files.push({ path: 'settings.json', content: JSON.stringify(db.settings, null, 2) });
        }
        const bundles = groupIntoBundles(db);
        for (const [id, bundle] of bundles.entries()) {
          if (only && !only.has(id)) continue;
          files.push({ path: `manuscripts/${id}.json`, content: JSON.stringify(bundle, null, 2) });
        }

        // Fetch the current remote tree so we can skip files that are already
        // identical (matching Git blob SHA) — on a re-sync most files are
        // unchanged and don't need uploading at all.
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

        if (onProgress) onProgress({ phase: 'Checking for changes…', current: 0, total: files.length });

        // Decide per file whether it needs uploading. Unchanged files are
        // referenced by their existing SHA; changed/new ones get uploaded.
        type TreeItem = { path: string, mode: '100644', type: 'blob', sha: string | null };
        const treeItems: TreeItem[] = new Array(files.length);
        const toUpload: number[] = [];
        for (let i = 0; i < files.length; i++) {
          const localSha = await gitBlobSha(files[i].content);
          const remoteSha = remoteShaByPath.get(files[i].path);
          if (remoteSha === localSha) {
            treeItems[i] = { path: files[i].path, mode: '100644', type: 'blob', sha: remoteSha };
          } else {
            toUpload.push(i);
          }
        }

        // Remove leftover legacy per-chant files (sources/documents/notes) once
        // we've migrated to the manuscripts/ layout, so the repo isn't left with
        // stale duplicates. A null sha deletes the path in the tree API.
        const deletions: TreeItem[] = [];
        if (!only) {
          for (const path of remoteShaByPath.keys()) {
            if (path.startsWith('sources/') || path.startsWith('documents/') || path.startsWith('notes/')) {
              deletions.push({ path, mode: '100644', type: 'blob', sha: null });
            }
          }
        }

        // Upload only the changed blobs, in "stacks" via a bounded worker pool
        // with retry/backoff so a large push rides out rate limits.
        let uploaded = 0;
        if (onProgress) onProgress({ phase: 'Uploading files', current: 0, total: toUpload.length });
        await runPool(toUpload, 6, async (index) => {
          const file = files[index];
          const blob = await withRetry(() => this.octokit!.rest.git.createBlob({
            owner: this.config!.owner,
            repo: this.config!.repo,
            content: this.encodeContent(file.content),
            encoding: 'base64'
          }));
          treeItems[index] = { path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha };
        }, () => {
          uploaded++;
          if (onProgress) onProgress({ phase: 'Uploading files', current: uploaded, total: toUpload.length });
        });

        // Commit in batches so progress is persisted incrementally: if the
        // process is interrupted, everything committed so far survives and a
        // later push resumes from there (skipping the unchanged files). The
        // manuscript writes come first, legacy deletions last.
        const ops: TreeItem[] = [...treeItems, ...deletions];
        const BATCH_SIZE = 100;
        let currentTreeSha = baseTreeSha!;
        let currentCommitSha = latestCommitSha!;
        const totalBatches = Math.ceil(ops.length / BATCH_SIZE) || 1;

        for (let b = 0; b < totalBatches; b++) {
          const batch = ops.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
          if (batch.length === 0) break;

          if (onProgress) onProgress({ phase: `Committing (batch ${b + 1}/${totalBatches})…`, current: b, total: totalBatches });

          const newTreeResp = await withRetry(() => this.octokit!.rest.git.createTree({
            owner: this.config!.owner,
            repo: this.config!.repo,
            base_tree: currentTreeSha,
            tree: batch as any
          }));

          // Skip an empty commit if this batch changed nothing.
          if (newTreeResp.data.sha === currentTreeSha) continue;

          const commitLabel = totalBatches > 1 ? `${message} (${b + 1}/${totalBatches})` : message;
          const newCommitResp = await withRetry(() => this.octokit!.rest.git.createCommit({
            owner: this.config!.owner,
            repo: this.config!.repo,
            message: commitLabel,
            tree: newTreeResp.data.sha,
            parents: [currentCommitSha]
          }));

          await withRetry(() => this.octokit!.rest.git.updateRef({
            owner: this.config!.owner,
            repo: this.config!.repo,
            ref: `heads/${this.config!.branch}`,
            sha: newCommitResp.data.sha
          }));

          currentTreeSha = newTreeResp.data.sha;
          currentCommitSha = newCommitResp.data.sha;
        }

        if (onProgress) onProgress({ phase: 'Done', current: totalBatches, total: totalBatches });
  }

  /**
   * Reads a single manuscript bundle directly via the Contents API — no tree
   * walk, no batching. This is the entry point a tool that only ever needs
   * one manuscript at a time (e.g. a neume editor working on a single piece)
   * should use instead of pullDatabase.
   */
  public async getManuscript(id: string): Promise<Bundle | null> {
    if (!this.octokit || !this.config) return null;
    try {
      const resp = await withRetry(() => this.octokit!.rest.repos.getContent({
        owner: this.config!.owner,
        repo: this.config!.repo,
        path: `manuscripts/${id}.json`,
        ref: this.config!.branch
      }));
      const data: any = resp.data;
      if (Array.isArray(data) || data.type !== 'file' || !data.content) return null;
      return JSON.parse(this.decodeContent(data.content.replace(/\n/g, '')));
    } catch (e: any) {
      if (e.status === 404) return null;
      console.error(e);
      this.toastr.error('Failed to load manuscript from GitHub');
      return null;
    }
  }

  /**
   * Writes a single manuscript bundle directly via the Contents API (one
   * request to read the current sha, one to write) — the cheap, simple path
   * for saving one manuscript's worth of edits, as opposed to a full
   * database sync. Also the entry point future tools (e.g. a neume editor)
   * should use for "save this one piece".
   */
  public async putManuscript(id: string, bundle: Bundle, message: string): Promise<boolean> {
    if (!this.octokit || !this.config) return false;
    try {
      let sha: string | undefined;
      try {
        const existing = await withRetry(() => this.octokit!.rest.repos.getContent({
          owner: this.config!.owner,
          repo: this.config!.repo,
          path: `manuscripts/${id}.json`,
          ref: this.config!.branch
        }));
        sha = Array.isArray(existing.data) ? undefined : (existing.data as any).sha;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await withRetry(() => this.octokit!.rest.repos.createOrUpdateFileContents({
        owner: this.config!.owner,
        repo: this.config!.repo,
        path: `manuscripts/${id}.json`,
        message,
        content: this.encodeContent(JSON.stringify(bundle, null, 2)),
        branch: this.config!.branch,
        sha
      }));
      return true;
    } catch (e) {
      console.error(e);
      this.toastr.error('Failed to save manuscript to GitHub');
      return false;
    }
  }
}
