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

  public async pullDatabase(): Promise<{ sources: any[], documents: any[], notes: any, settings: any } | null> {
    if (!this.octokit || !this.config) return null;
    try {
      const db = { sources: [] as any[], documents: [] as any[], notes: {} as any, settings: null as any };
      
      const treeResp = await this.octokit.rest.git.getTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree_sha: this.config.branch,
        recursive: "true"
      });

      for (const item of treeResp.data.tree) {
        if (item.type !== 'blob' || !item.path) continue;
        
        if (item.path === 'settings.json') {
           const file = await this.octokit.rest.git.getBlob({ owner: this.config.owner, repo: this.config.repo, file_sha: item.sha! });
           db.settings = JSON.parse(this.decodeContent(file.data.content));
        } else if (item.path.startsWith('sources/') && item.path.endsWith('.json')) {
           const file = await this.octokit.rest.git.getBlob({ owner: this.config.owner, repo: this.config.repo, file_sha: item.sha! });
           db.sources.push(JSON.parse(this.decodeContent(file.data.content)));
        } else if (item.path.startsWith('documents/') && item.path.endsWith('.json')) {
           const file = await this.octokit.rest.git.getBlob({ owner: this.config.owner, repo: this.config.repo, file_sha: item.sha! });
           db.documents.push(JSON.parse(this.decodeContent(file.data.content)));
        } else if (item.path.startsWith('notes/') && item.path.endsWith('.json')) {
           const file = await this.octokit.rest.git.getBlob({ owner: this.config.owner, repo: this.config.repo, file_sha: item.sha! });
           const docId = item.path.replace('notes/', '').replace('.json', '');
           db.notes[docId] = JSON.parse(this.decodeContent(file.data.content));
        }
      }

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

  public async pushDatabase(db: { sources: any[], documents: any[], notes: any, settings: any }, message: string): Promise<boolean> {
     if (!this.octokit || !this.config) return false;
     try {
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

        const treeItems: any[] = [];

        // settings.json
        if (db.settings) {
          treeItems.push({
            path: 'settings.json',
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(db.settings, null, 2)
          });
        }

        // sources
        for (const source of db.sources) {
          treeItems.push({
            path: `sources/${source.id}.json`,
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(source, null, 2)
          });
        }

        // documents
        for (const doc of db.documents) {
          treeItems.push({
            path: `documents/${doc.id}.json`,
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(doc, null, 2)
          });
        }

        // notes
        for (const docId of Object.keys(db.notes)) {
          treeItems.push({
            path: `notes/${docId}.json`,
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(db.notes[docId], null, 2)
          });
        }

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
