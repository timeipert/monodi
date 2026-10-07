/**
 * Small GitHub REST helpers used by the sign-in screen (who am I, which
 * repositories may I write to, which branches). Reading and writing the actual
 * workspace stays in GithubService.
 */
import { FetchFn } from './github-auth';

export interface GithubRepo {
  /** "owner/name" */
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

export class GithubApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const API = 'https://api.github.com';

async function get(path: string, token: string, fetchFn: FetchFn): Promise<any> {
  const res = await fetchFn(API + path, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new GithubApiError(res.status === 401 ? 'GitHub rejected the sign-in.' : `GitHub answered HTTP ${res.status}.`, res.status);
  }
  return res.json();
}

export async function getUser(token: string, fetchFn: FetchFn): Promise<{ login: string }> {
  const u = await get('/user', token, fetchFn);
  return { login: u.login };
}

/**
 * Every repository the App is installed on that the person may write to,
 * merged over all installations, sorted by name.
 */
export async function listRepositories(token: string, fetchFn: FetchFn): Promise<GithubRepo[]> {
  const inst = await get('/user/installations?per_page=100', token, fetchFn);
  const byName = new Map<string, GithubRepo>();
  for (const i of inst.installations || []) {
    for (let page = 1; ; page++) {
      const r = await get(`/user/installations/${i.id}/repositories?per_page=100&page=${page}`, token, fetchFn);
      const repos: any[] = r.repositories || [];
      for (const x of repos) {
        if (x.permissions && x.permissions.push === false) continue;
        byName.set(x.full_name, {
          fullName: x.full_name,
          owner: x.owner?.login ?? x.full_name.split('/')[0],
          name: x.name,
          private: !!x.private,
          defaultBranch: x.default_branch || 'main',
        });
      }
      if (repos.length < 100) break;
    }
  }
  return [...byName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listBranches(repo: string, token: string, fetchFn: FetchFn): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; ; page++) {
    const r: any[] = await get(`/repos/${repo}/branches?per_page=100&page=${page}`, token, fetchFn);
    names.push(...r.map(b => b.name));
    if (r.length < 100) break;
  }
  return names;
}
