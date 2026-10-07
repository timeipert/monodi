import {
  PENDING_KEY, StorageLike, authorizeUrl, base64Url, beginLogin, callbackUrl, createPkce,
  exchangeCode, isFresh, peekReturnHash, readTokenResponse, refreshToken, takeCallback,
} from './github-auth';
import { memoryStorage } from './github-test-helpers';

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('github-auth', () => {
  describe('PKCE', () => {
    it('challenge is base64url(SHA-256(verifier))', async () => {
      const { verifier, challenge } = await createPkce();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      expect(challenge).toBe(base64Url(new Uint8Array(digest)));
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('verifiers differ per call', async () => {
      const a = await createPkce();
      const b = await createPkce();
      expect(a.verifier).not.toBe(b.verifier);
    });
  });

  it('builds the authorize URL with every parameter and S256', () => {
    const url = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'https://x.org/', state: 's1', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.org/');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('callbackUrl is origin + path, never the hash', () => {
    expect(callbackUrl({ origin: 'https://monodi.app', pathname: '/' })).toBe('https://monodi.app/');
  });

  describe('takeCallback', () => {
    async function pending(storage: StorageLike) {
      const url = await beginLogin({ clientId: 'c', redirectUri: 'https://x.org/', returnHash: '#/settings?tab=github', storage });
      return new URL(url).searchParams.get('state')!;
    }

    it('returns null when there is no code or error', () => {
      expect(takeCallback('?foo=1', memoryStorage())).toBeNull();
    });

    it('accepts a matching state once', async () => {
      const st = memoryStorage();
      const state = await pending(st);
      const first = takeCallback(`?code=abc&state=${state}`, st) as any;
      expect(first.code).toBe('abc');
      expect(first.redirectUri).toBe('https://x.org/');
      expect(first.returnHash).toBe('#/settings?tab=github');
      expect(first.verifier).toBeTruthy();
      expect((takeCallback(`?code=abc&state=${state}`, st) as any).error).toBeTruthy();
    });

    it('refuses a wrong state and still consumes the pending login', async () => {
      const st = memoryStorage();
      const state = await pending(st);
      expect((takeCallback('?code=abc&state=nope', st) as any).error).toBeTruthy();
      expect(st.data.has(PENDING_KEY)).toBeFalse();
      expect((takeCallback(`?code=abc&state=${state}`, st) as any).error).toBeTruthy();
    });

    it('refuses a missing state', async () => {
      const st = memoryStorage();
      await pending(st);
      expect((takeCallback('?code=abc', st) as any).error).toBeTruthy();
    });

    it('refuses when nothing is pending', () => {
      expect((takeCallback('?code=abc&state=x', memoryStorage()) as any).error).toBeTruthy();
    });

    it('reports a cancelled sign-in', async () => {
      const st = memoryStorage();
      const state = await pending(st);
      const r = takeCallback(`?error=access_denied&state=${state}`, st) as any;
      expect(r.error).toMatch(/cancel/i);
    });

    it('peekReturnHash does not consume', async () => {
      const st = memoryStorage();
      await pending(st);
      expect(peekReturnHash(st)).toBe('#/settings?tab=github');
      expect(st.data.has(PENDING_KEY)).toBeTrue();
    });
  });

  describe('proxy calls', () => {
    it('exchangeCode posts to <proxy>/token without any secret', async () => {
      let seen: { url: string; body: any } | null = null;
      const fetchFn = async (url: string, init?: RequestInit) => {
        seen = { url, body: JSON.parse(String(init!.body)) };
        return jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 28800 });
      };
      const t = await exchangeCode({ proxyUrl: 'https://p.example/', code: 'c', verifier: 'v', redirectUri: 'https://x.org/', now: 1000 }, fetchFn);
      expect(seen!.url).toBe('https://p.example/token');
      expect(seen!.body).toEqual({ code: 'c', code_verifier: 'v', redirect_uri: 'https://x.org/' });
      expect(JSON.stringify(seen)).not.toMatch(/secret/i);
      expect(t).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 + 28800 * 1000 });
    });

    it('refreshToken posts to <proxy>/refresh', async () => {
      let url = ''; let body: any;
      const fetchFn = async (u: string, init?: RequestInit) => {
        url = u; body = JSON.parse(String(init!.body));
        return jsonResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 10 });
      };
      const t = await refreshToken({ proxyUrl: 'https://p.example', refreshToken: 'rt', now: 0 }, fetchFn);
      expect(url).toBe('https://p.example/refresh');
      expect(body).toEqual({ refresh_token: 'rt' });
      expect(t.accessToken).toBe('at2');
    });

    it('turns a refusal into an error carrying GitHub\'s words', async () => {
      const fetchFn = async () => jsonResponse({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }, 400);
      await expectAsync(exchangeCode({ proxyUrl: 'https://p', code: 'c', verifier: 'v', redirectUri: 'r' }, fetchFn))
        .toBeRejectedWithError('The code passed is incorrect or expired.');
    });

    it('fails clearly when the proxy answers with no JSON', async () => {
      const fetchFn = async () => new Response('oops', { status: 502 });
      await expectAsync(exchangeCode({ proxyUrl: 'https://p', code: 'c', verifier: 'v', redirectUri: 'r' }, fetchFn))
        .toBeRejectedWithError(/HTTP 502/);
    });
  });

  describe('readTokenResponse / isFresh', () => {
    it('expiresAt is 0 when the token never expires', () => {
      expect(readTokenResponse({ access_token: 'a' }, 5).expiresAt).toBe(0);
    });

    it('isFresh keeps a 60 s safety margin', () => {
      const s = { accessToken: 'a', expiresAt: 100_000 };
      expect(isFresh(s, 30_000)).toBeTrue();
      expect(isFresh(s, 40_001)).toBeFalse();
      expect(isFresh({ accessToken: 'a', expiresAt: 0 }, 1e12)).toBeTrue();
      expect(isFresh(null, 0)).toBeFalse();
    });
  });
});
