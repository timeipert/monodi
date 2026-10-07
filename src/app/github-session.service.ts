import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../environments/environment';
import {
  FetchFn, StorageLike, TokenSet, beginLogin, callbackUrl, exchangeCode, isFresh,
  peekReturnHash, refreshToken, takeCallback,
} from './github-auth';
import { getUser } from './github-api';

const LOCAL_KEY = 'githubSession';
const REFRESH_KEY = 'githubRefresh';
export const DEFAULT_RETURN_HASH = '#/settings?tab=github';

export interface SessionDeps {
  clientId: string;
  proxyUrl: string;
  fetchFn: FetchFn;
  now: () => number;
  local: StorageLike;
  /** Per-tab storage: holds the pending login and the refresh token. */
  session: StorageLike;
  cryptoApi: Crypto;
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash' | 'protocol'>;
  history: Pick<History, 'replaceState'>;
  navigate: (url: string) => void;
}

interface Stored { accessToken: string; expiresAt: number; login: string; }

export interface LoginOutcome { login?: string; error?: string; }

/**
 * The only holder of the GitHub sign-in token.
 *
 * It lives in its own localStorage key and is deliberately NOT part of the
 * workspace, settings, exports or backups. The refresh token is kept in
 * sessionStorage only, so it dies with the tab.
 */
@Injectable({ providedIn: 'root' })
export class GithubSessionService {
  /** Replaceable in tests. */
  deps: SessionDeps = defaultDeps();

  /** Fires after sign-in, sign-out or a forced sign-out. */
  readonly changes = new Subject<void>();

  private stored: Stored | null = null;
  private inflightRefresh: Promise<string> | null = null;

  constructor() {
    this.stored = this.read();
  }

  /** The build has a client id and a proxy, and we run where a redirect can come back. */
  get configured(): boolean {
    const d = this.deps;
    return !!(d.clientId && d.proxyUrl) && /^https?:$/.test(d.location.protocol);
  }

  get signedIn(): boolean { return !!this.stored; }
  get login(): string { return this.stored?.login ?? ''; }

  /** A valid token, renewed through the proxy when it is about to end. */
  async token(): Promise<string> {
    if (!this.stored) throw new Error('Please sign in again');
    if (isFresh(this.stored, this.deps.now())) return this.stored.accessToken;
    if (!this.inflightRefresh) {
      this.inflightRefresh = this.renew().finally(() => { this.inflightRefresh = null; });
    }
    return this.inflightRefresh;
  }

  private async renew(): Promise<string> {
    const d = this.deps;
    const rt = d.session.getItem(REFRESH_KEY);
    if (!rt) { this.signOut(); throw new Error('Please sign in again'); }
    try {
      const t = await refreshToken({ proxyUrl: d.proxyUrl, refreshToken: rt, now: d.now() }, d.fetchFn);
      this.save(t, this.stored!.login);
      return t.accessToken;
    } catch {
      this.signOut();
      throw new Error('Please sign in again');
    }
  }

  /** Sends the browser to GitHub. Returns after the navigation was started. */
  async startLogin(returnHash: string = DEFAULT_RETURN_HASH): Promise<void> {
    const d = this.deps;
    if (!this.configured) throw new Error('Sign-in with GitHub is not set up in this build.');
    const url = await beginLogin({
      clientId: d.clientId,
      redirectUri: callbackUrl(d.location),
      returnHash,
      storage: d.session,
      cryptoApi: d.cryptoApi,
    });
    d.navigate(url);
  }

  /**
   * Call once at app start. When the address carries ?code=/?error= from
   * GitHub: clean the address bar first (the code must not stay in the
   * history), then exchange the code. Returns null when this is a normal start.
   */
  async completeLogin(): Promise<LoginOutcome | null> {
    const d = this.deps;
    const returnHash = peekReturnHash(d.session) || DEFAULT_RETURN_HASH;
    const cb = takeCallback(d.location.search, d.session);
    if (!cb) return null;

    d.history.replaceState(null, '', d.location.pathname + ('error' in cb ? DEFAULT_RETURN_HASH : returnHash));
    if ('error' in cb) return { error: cb.error };

    try {
      const t = await exchangeCode(
        { proxyUrl: d.proxyUrl, code: cb.code, verifier: cb.verifier, redirectUri: cb.redirectUri, now: d.now() },
        d.fetchFn,
      );
      const user = await getUser(t.accessToken, d.fetchFn);
      this.save(t, user.login);
      return { login: user.login };
    } catch (e: any) {
      return { error: e?.message || 'Sign-in failed.' };
    }
  }

  signOut(): void {
    const d = this.deps;
    this.stored = null;
    try { d.local.removeItem(LOCAL_KEY); } catch { /* storage unavailable */ }
    try { d.session.removeItem(REFRESH_KEY); } catch { /* storage unavailable */ }
    this.changes.next();
  }

  private save(t: TokenSet, login: string): void {
    const d = this.deps;
    this.stored = { accessToken: t.accessToken, expiresAt: t.expiresAt, login };
    try { d.local.setItem(LOCAL_KEY, JSON.stringify(this.stored)); } catch { /* storage unavailable */ }
    try {
      if (t.refreshToken) d.session.setItem(REFRESH_KEY, t.refreshToken);
      else d.session.removeItem(REFRESH_KEY);
    } catch { /* storage unavailable */ }
    this.changes.next();
  }

  private read(): Stored | null {
    try {
      const raw = this.deps.local.getItem(LOCAL_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && typeof s.accessToken === 'string' && s.accessToken
        ? { accessToken: s.accessToken, expiresAt: Number(s.expiresAt) || 0, login: String(s.login || '') }
        : null;
    } catch { return null; }
  }
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike {
  const mem = new Map<string, string>();
  const fallback: StorageLike = {
    getItem: k => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: k => { mem.delete(k); },
  };
  try {
    const s = window[kind];
    s.getItem('x');
    return s;
  } catch { return fallback; }
}

function defaultDeps(): SessionDeps {
  return {
    clientId: environment.githubClientId,
    proxyUrl: environment.githubAuthProxyUrl,
    fetchFn: (input, init) => window.fetch(input, init),
    now: () => Date.now(),
    local: safeStorage('localStorage'),
    session: safeStorage('sessionStorage'),
    cryptoApi: window.crypto,
    location: window.location,
    history: window.history,
    navigate: url => window.location.assign(url),
  };
}
