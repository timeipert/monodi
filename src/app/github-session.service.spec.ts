import { GithubSessionService, SessionDeps } from './github-session.service';
import { memoryStorage } from './github-test-helpers';

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function make(over: Partial<SessionDeps> = {}) {
  const local = memoryStorage();
  const session = memoryStorage();
  const calls: string[] = [];
  const navigated: string[] = [];
  const replaced: string[] = [];
  let now = 1_000_000;
  const loc = { origin: 'https://monodi.app', pathname: '/', search: '', hash: '', protocol: 'https:' };
  const svc = new GithubSessionService();
  svc.deps = {
    clientId: 'cid', proxyUrl: 'https://p.example',
    fetchFn: async (url: string) => {
      calls.push(url);
      if (url.endsWith('/token')) return json({ access_token: 'at1', refresh_token: 'rt1', expires_in: 28800 });
      if (url.endsWith('/refresh')) return json({ access_token: 'at2', refresh_token: 'rt2', expires_in: 28800 });
      if (url.endsWith('/user')) return json({ login: 'ada' });
      return json({}, 404);
    },
    now: () => now, local, session, cryptoApi: crypto, location: loc,
    history: { replaceState: (_d: any, _t: string, u?: any) => { replaced.push(String(u)); } },
    navigate: u => navigated.push(u),
    ...over,
  };
  return { svc, local, session, calls, navigated, replaced, loc, advance: (ms: number) => { now += ms; } };
}

describe('GithubSessionService', () => {
  it('is not configured without client id / proxy, or on file://', () => {
    expect(make({ clientId: '' }).svc.configured).toBeFalse();
    const { svc, loc } = make();
    expect(svc.configured).toBeTrue();
    loc.protocol = 'file:';
    expect(svc.configured).toBeFalse();
  });

  it('startLogin sends the browser to GitHub and stores a pending login', async () => {
    const { svc, session, navigated } = make();
    await svc.startLogin('#/settings?tab=github');
    expect(navigated[0]).toContain('https://github.com/login/oauth/authorize');
    expect(navigated[0]).toContain('redirect_uri=' + encodeURIComponent('https://monodi.app/'));
    expect(session.data.size).toBe(1);
  });

  it('completes a login: cleans the address first, exchanges, stores the token', async () => {
    const { svc, local, session, loc, replaced, calls } = make();
    await svc.startLogin('#/sources');
    const state = JSON.parse(session.data.get('githubLoginPending')!).state;
    loc.search = `?code=abc&state=${state}`;
    const outcome = await svc.completeLogin();
    expect(outcome).toEqual({ login: 'ada' });
    expect(replaced).toEqual(['/#/sources']);
    expect(calls[0]).toBe('https://p.example/token');
    expect(svc.signedIn).toBeTrue();
    expect(svc.login).toBe('ada');
    expect(await svc.token()).toBe('at1');
    // refresh token only in sessionStorage
    expect(session.data.get('githubRefresh')).toBe('rt1');
    expect(local.data.get('githubSession')!).not.toContain('rt1');
  });

  it('ignores a wrong state: no exchange, a message', async () => {
    const { svc, session, loc, calls } = make();
    await svc.startLogin();
    expect(session.data.size).toBe(1);
    loc.search = '?code=abc&state=forged';
    const outcome = await svc.completeLogin();
    expect(outcome!.error).toBeTruthy();
    expect(calls.length).toBe(0);
    expect(svc.signedIn).toBeFalse();
  });

  it('returns null on a normal start', async () => {
    expect(await make().svc.completeLogin()).toBeNull();
  });

  it('renews an ended token through the proxy, once for parallel callers', async () => {
    const { svc, loc, session, advance, calls } = make();
    await svc.startLogin();
    loc.search = `?code=abc&state=${JSON.parse(session.data.get('githubLoginPending')!).state}`;
    await svc.completeLogin();
    advance(8 * 3600 * 1000);
    const [a, b] = await Promise.all([svc.token(), svc.token()]);
    expect(a).toBe('at2');
    expect(b).toBe('at2');
    expect(calls.filter(c => c.endsWith('/refresh')).length).toBe(1);
    expect(session.data.get('githubRefresh')).toBe('rt2');
  });

  it('signs out when renewal fails', async () => {
    const { svc, loc, session, local, advance } = make();
    await svc.startLogin();
    loc.search = `?code=abc&state=${JSON.parse(session.data.get('githubLoginPending')!).state}`;
    await svc.completeLogin();
    svc.deps.fetchFn = async () => json({ error: 'bad_refresh_token' }, 400);
    advance(9 * 3600 * 1000);
    await expectAsync(svc.token()).toBeRejectedWithError('Please sign in again');
    expect(svc.signedIn).toBeFalse();
    expect(local.data.has('githubSession')).toBeFalse();
    expect(session.data.has('githubRefresh')).toBeFalse();
  });

  it('signs out when the tab was closed and no refresh token is left', async () => {
    const { svc, loc, session, advance } = make();
    await svc.startLogin();
    loc.search = `?code=abc&state=${JSON.parse(session.data.get('githubLoginPending')!).state}`;
    await svc.completeLogin();
    session.data.delete('githubRefresh');
    advance(9 * 3600 * 1000);
    await expectAsync(svc.token()).toBeRejectedWithError('Please sign in again');
  });

  it('the access token is stored under its own key only', async () => {
    const { svc, loc, session, local } = make();
    await svc.startLogin();
    loc.search = `?code=abc&state=${JSON.parse(session.data.get('githubLoginPending')!).state}`;
    await svc.completeLogin();
    // only the one dedicated key holds the access token
    expect([...local.data.keys()]).toEqual(['githubSession']);
    expect(local.data.get('githubSession')).toContain('at1');
    expect(session.data.get('githubRefresh')).toBe('rt1');
  });
});
