import { GithubApiError, getUser, listBranches, listRepositories } from './github-api';

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('github-api', () => {
  it('sends the token as a Bearer header', async () => {
    let auth = '';
    const fetchFn = async (_u: string, init?: RequestInit) => {
      auth = (init!.headers as any).Authorization;
      return json({ login: 'ada' });
    };
    expect((await getUser('tok', fetchFn)).login).toBe('ada');
    expect(auth).toBe('Bearer tok');
  });

  it('reports a rejected sign-in with the status', async () => {
    const fetchFn = async () => json({}, 401);
    const err = await getUser('t', fetchFn).catch(e => e);
    expect(err instanceof GithubApiError).toBeTrue();
    expect(err.status).toBe(401);
  });

  it('listRepositories merges installations, drops read-only repos, sorts', async () => {
    const repo = (full: string, push: boolean, priv = false) => ({
      full_name: full, name: full.split('/')[1], owner: { login: full.split('/')[0] },
      private: priv, default_branch: 'main', permissions: { push },
    });
    const fetchFn = async (url: string) => {
      if (url.includes('/user/installations?')) return json({ installations: [{ id: 1 }, { id: 2 }] });
      if (url.includes('/installations/1/repositories')) return json({ repositories: [repo('zed/z', true), repo('ro/readonly', false)] });
      if (url.includes('/installations/2/repositories')) return json({ repositories: [repo('abe/a', true, true), repo('zed/z', true)] });
      return json({}, 404);
    };
    const repos = await listRepositories('t', fetchFn);
    expect(repos.map(r => r.fullName)).toEqual(['abe/a', 'zed/z']);
    expect(repos[0].private).toBeTrue();
  });

  it('listBranches pages through all branches', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
    const fetchFn = async (url: string) => json(url.includes('&page=1') ? page1 : [{ name: 'feature/x' }]);
    const names = await listBranches('o/r', 't', fetchFn);
    expect(names.length).toBe(101);
    expect(names[100]).toBe('feature/x');
  });
});
