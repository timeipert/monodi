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
 * Retries a request with exponential backoff, chiefly to ride out GitHub's
 * secondary rate limits (HTTP 403/429) that otherwise abort a large push
 * partway through.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status;
      const retriable = status === 403 || status === 429 || status === 500 || status === 502 || status === 503;
      if (!retriable || attempt === attempts - 1) throw e;
      const retryAfter = Number(e?.response?.headers?.['retry-after']);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * Math.pow(2, attempt), 30000);
      await new Promise(res => setTimeout(res, waitMs));
    }
  }
  throw lastErr;
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

  public async pullDatabase(onProgress?: ProgressCallback): Promise<{ sources: any[], documents: any[], notes: any, settings: any } | null> {
    if (!this.octokit || !this.config) return null;
    try {
      const db = { sources: [] as any[], documents: [] as any[], notes: {} as any, settings: null as any };

      if (onProgress) onProgress({ phase: 'Reading repository index…', current: 0, total: 0 });

      const treeResp = await this.octokit.rest.git.getTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree_sha: this.config.branch,
        recursive: "true"
      });

      if (treeResp.data.truncated) {
        // GitHub caps the recursive tree response; beyond that limit files are
        // silently omitted, so a partial pull would look like data loss.
        this.toastr.error('Repository is too large to pull in one request (GitHub truncated the file list). Please split the data across branches.');
        return null;
      }

      // Collect the blobs we actually care about, then fetch them with a
      // small worker pool so a big workspace doesn't turn into hundreds of
      // serial round-trips (the old "frozen" behaviour).
      const blobs = treeResp.data.tree.filter(item =>
        item.type === 'blob' && !!item.path && !!item.sha && (
          item.path === 'settings.json' ||
          (item.path.startsWith('sources/') && item.path.endsWith('.json')) ||
          (item.path.startsWith('documents/') && item.path.endsWith('.json')) ||
          (item.path.startsWith('notes/') && item.path.endsWith('.json'))
        )
      );

      const total = blobs.length;
      let done = 0;
      if (onProgress) onProgress({ phase: 'Downloading files', current: 0, total });

      await runPool(blobs, 6, async (item) => {
        const file = await this.octokit!.rest.git.getBlob({
          owner: this.config!.owner,
          repo: this.config!.repo,
          file_sha: item.sha!
        });
        const parsed = JSON.parse(this.decodeContent(file.data.content));
        const path = item.path!;
        if (path === 'settings.json') {
          db.settings = parsed;
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
    } catch (e: any) {
      if (e.status === 404 || e.status === 409) {
        // Repository is empty or branch doesn't exist
        return { sources: [], documents: [], notes: {}, settings: null };
      }
      console.error(e);
      this.toastr.error('Failed to pull from GitHub');
      return null;
    }
  }

  public async pushDatabase(db: { sources: any[], documents: any[], notes: any, settings: any }, message: string, onProgress?: ProgressCallback): Promise<boolean> {
     if (!this.octokit || !this.config) return false;
     try {
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

        // Gather every file we intend to write as (path, content) pairs.
        const files: { path: string, content: string }[] = [];

        if (db.settings) {
          files.push({ path: 'settings.json', content: JSON.stringify(db.settings, null, 2) });
        }
        for (const source of db.sources) {
          files.push({ path: `sources/${source.id}.json`, content: JSON.stringify(source, null, 2) });
        }
        for (const doc of db.documents) {
          files.push({ path: `documents/${doc.id}.json`, content: JSON.stringify(doc, null, 2) });
        }
        for (const docId of Object.keys(db.notes)) {
          files.push({ path: `notes/${docId}.json`, content: JSON.stringify(db.notes[docId], null, 2) });
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
        const treeItems: { path: string, mode: '100644', type: 'blob', sha: string }[] = new Array(files.length);
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
        // later push resumes from there (skipping the unchanged files).
        const BATCH_SIZE = 100;
        let currentTreeSha = baseTreeSha!;
        let currentCommitSha = latestCommitSha!;
        const totalBatches = Math.ceil(treeItems.length / BATCH_SIZE) || 1;

        for (let b = 0; b < totalBatches; b++) {
          const batch = treeItems.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
          if (batch.length === 0) break;

          if (onProgress) onProgress({ phase: `Committing (batch ${b + 1}/${totalBatches})…`, current: b, total: totalBatches });

          const newTreeResp = await withRetry(() => this.octokit!.rest.git.createTree({
            owner: this.config!.owner,
            repo: this.config!.repo,
            base_tree: currentTreeSha,
            tree: batch
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
        return true;
     } catch(e) {
         console.error(e);
         this.toastr.error('Push interrupted — progress committed so far is saved on GitHub. Press Push again to resume.');
         return false;
     }
  }
}
