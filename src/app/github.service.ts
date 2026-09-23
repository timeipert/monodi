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

        // Upload each file as its own blob, in "stacks" via a small worker
        // pool, instead of stuffing every file's content into one giant
        // createTree request. This is far more reliable for large workspaces
        // and lets us report real progress.
        const treeItems: any[] = new Array(files.length);
        let uploaded = 0;
        if (onProgress) onProgress({ phase: 'Uploading files', current: 0, total: files.length });

        await runPool(files, 6, async (file, index) => {
          const blob = await this.octokit!.rest.git.createBlob({
            owner: this.config!.owner,
            repo: this.config!.repo,
            content: this.encodeContent(file.content),
            encoding: 'base64'
          });
          treeItems[index] = {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blob.data.sha
          };
        }, () => {
          uploaded++;
          if (onProgress) onProgress({ phase: 'Uploading files', current: uploaded, total: files.length });
        });

        if (onProgress) onProgress({ phase: 'Committing…', current: files.length, total: files.length });

        // We can't use base_tree if it's the initial commit.
        // Wait, if we use base_tree, GitHub creates a delta tree. 
        // If we want to DELETE files that were removed locally, we need to explicitly delete them in the Tree API,
        // or just recreate the entire tree without a base_tree (which replaces the repo contents entirely).
        // Since we want `sources/`, `documents/`, `notes/`, `settings.json` to be exactly what we send, 
        // passing no base_tree means the new commit will only contain what we send.
        // Let's create an isolated tree to replace the repository content completely.

        const newTreeResp = await this.octokit.rest.git.createTree({
            owner: this.config.owner,
            repo: this.config.repo,
            base_tree: baseTreeSha,
            tree: treeItems
        });

        const commitParams: any = {
             owner: this.config.owner,
             repo: this.config.repo,
             message: message,
             tree: newTreeResp.data.sha,
        };

        if (!isInitialCommit && latestCommitSha) {
          commitParams.parents = [latestCommitSha];
        }

        const newCommitResp = await this.octokit.rest.git.createCommit(commitParams);

        if (isInitialCommit) {
           await this.octokit.rest.git.createRef({
               owner: this.config.owner,
               repo: this.config.repo,
               ref: `refs/heads/${this.config.branch}`,
               sha: newCommitResp.data.sha
           });
        } else {
           await this.octokit.rest.git.updateRef({
               owner: this.config.owner,
               repo: this.config.repo,
               ref: `heads/${this.config.branch}`,
               sha: newCommitResp.data.sha
           });
        }
        
        return true;
     } catch(e) {
         console.error(e);
         this.toastr.error('Failed to push to GitHub');
         return false;
     }
  }
}
