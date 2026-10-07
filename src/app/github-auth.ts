/**
 * "Sign in with GitHub" — the pure part (authorization code + PKCE for a
 * GitHub App, user-to-server flow).
 *
 * Nothing here touches the DOM, the network or the clock on its own: fetch,
 * storage, crypto and time are all passed in, so every function is unit-testable.
 *
 * GitHub still wants the client secret at the token exchange and the token
 * endpoint is not CORS-enabled, so the exchange and the refresh go through a
 * tiny proxy (see GITHUB-LOGIN.md). The browser never sees the secret.
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface PendingLogin {
  state: string;
  verifier: string;
  redirectUri: string;
  /** Route to return to after login, e.g. "#/settings?tab=github". */
  returnHash: string;
}

export interface TokenSet {
  accessToken: string;
  /** Empty when GitHub did not send one (token expiry switched off). */
  refreshToken: string;
  /** Epoch ms; 0 = never expires. */
  expiresAt: number;
}

export type CallbackResult =
  | { error: string }
  | { code: string; verifier: string; redirectUri: string; returnHash: string };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const PENDING_KEY = 'githubLoginPending';

/** Refresh this long before the token really ends. */
const SAFETY_MARGIN_MS = 60_000;

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomState(cryptoApi: Crypto = crypto): string {
  return base64Url(cryptoApi.getRandomValues(new Uint8Array(16)));
}

export async function createPkce(cryptoApi: Crypto = crypto): Promise<PkcePair> {
  const verifier = base64Url(cryptoApi.getRandomValues(new Uint8Array(32)));
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

/**
 * Where GitHub sends the person back to: origin + path, no hash (a hash route
 * cannot receive the code). Must equal a callback URL registered on the App.
 */
export function callbackUrl(loc: Pick<Location, 'origin' | 'pathname'>): string {
  return loc.origin + loc.pathname;
}

/** Stores the pending login and returns the GitHub URL to send the browser to. */
export async function beginLogin(opts: {
  clientId: string;
  redirectUri: string;
  returnHash: string;
  storage: StorageLike;
  cryptoApi?: Crypto;
}): Promise<string> {
  const cryptoApi = opts.cryptoApi ?? crypto;
  const { verifier, challenge } = await createPkce(cryptoApi);
  const state = randomState(cryptoApi);
  const pending: PendingLogin = { state, verifier, redirectUri: opts.redirectUri, returnHash: opts.returnHash };
  opts.storage.setItem(PENDING_KEY, JSON.stringify(pending));
  return authorizeUrl({ clientId: opts.clientId, redirectUri: opts.redirectUri, state, challenge });
}

/**
 * Reads what GitHub sent back. Returns null when this is not a login return.
 * The pending entry is consumed on every call, so a state works exactly once.
 */
export function takeCallback(search: string, storage: StorageLike): CallbackResult | null {
  const q = new URLSearchParams(search);
  const code = q.get('code');
  const ghError = q.get('error');
  if (!code && !ghError) return null;

  let pending: PendingLogin | null = null;
  try {
    const raw = storage.getItem(PENDING_KEY);
    pending = raw ? JSON.parse(raw) : null;
  } catch { pending = null; }
  storage.removeItem(PENDING_KEY);

  const state = q.get('state');
  if (!pending || !pending.state || !state || state !== pending.state) {
    return { error: 'The sign-in could not be verified (the state did not match). Please try again.' };
  }
  if (ghError) {
    return { error: ghError === 'access_denied' ? 'Sign-in was cancelled.' : (q.get('error_description') || ghError) };
  }
  return { code: code!, verifier: pending.verifier, redirectUri: pending.redirectUri, returnHash: pending.returnHash };
}

/** Returns the saved return route of a pending login without consuming it. */
export function peekReturnHash(storage: StorageLike): string {
  try {
    const raw = storage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw).returnHash || '') : '';
  } catch { return ''; }
}

async function postProxy(proxyUrl: string, path: string, body: object, fetchFn: FetchFn): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(proxyUrl.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the sign-in service. Check your connection and try again.');
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!json) throw new Error(`The sign-in service answered with HTTP ${res.status}.`);
  return json;
}

export async function exchangeCode(
  p: { proxyUrl: string; code: string; verifier: string; redirectUri: string; now?: number },
  fetchFn: FetchFn,
): Promise<TokenSet> {
  const json = await postProxy(p.proxyUrl, '/token', {
    code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri,
  }, fetchFn);
  return readTokenResponse(json, p.now ?? Date.now());
}

export async function refreshToken(
  p: { proxyUrl: string; refreshToken: string; now?: number },
  fetchFn: FetchFn,
): Promise<TokenSet> {
  const json = await postProxy(p.proxyUrl, '/refresh', { refresh_token: p.refreshToken }, fetchFn);
  return readTokenResponse(json, p.now ?? Date.now());
}

/** GitHub answers 200 with {error} for refusals — check the body, not the status. */
export function readTokenResponse(json: any, now: number): TokenSet {
  if (!json || json.error || !json.access_token) {
    throw new Error(json?.error_description || json?.error || 'GitHub did not return a token.');
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || '',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : 0,
  };
}

export function isFresh(session: { accessToken: string; expiresAt: number } | null, now: number): boolean {
  if (!session || !session.accessToken) return false;
  return session.expiresAt === 0 || session.expiresAt - SAFETY_MARGIN_MS > now;
}
