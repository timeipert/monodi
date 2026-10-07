# Sign in with GitHub

Settings → GitHub Sync offers **Sign in with GitHub** (GitHub App, authorization code + PKCE).
The old personal-access-token form is still there under "Advanced" and is the only option in the
desktop (Electron/`file://`) app, where a redirect cannot come back.

## How it works

```
Browser                         GitHub                    Proxy (Cloudflare Worker, shared with neume-docs)
1 Sign in ── PKCE challenge+state ─▶ /login/oauth/authorize
2 ◀── redirect  https://<site>/?code=…&state=…
3 POST <proxy>/token {code, code_verifier, redirect_uri} ─────────────▶ adds client_id + secret → GitHub
4 ◀── {access_token, refresh_token, expires_in}
5 api.github.com directly (Bearer): /user, /user/installations, … and all sync calls
6 token ended → POST <proxy>/refresh {refresh_token}
```

* The proxy only ever exchanges a code and refreshes a token. It is not in the path of reads/writes.
* The client **secret** exists only as a Worker secret — never in this repo or the bundle.
* Token store: `localStorage["githubSession"]` (access token, expiry, login). Refresh token:
  `sessionStorage["githubRefresh"]` only (dies with the tab). Neither is part of the workspace,
  exports, backups, or `monodi_github_config` (which holds only owner/repo/branch for sign-in mode).
* Access tokens last 8 h; `GithubService` attaches the token per request, so a long push survives
  the renewal. A failed renewal or a 401 signs out and disconnects sync ("Please sign in again").

## Setup checklist

1. **GitHub App**: add the callback URLs (exact, trailing slash) for every origin Monodi runs on:
   `https://monodi.app/` and `http://localhost:4200/` (+ `http://localhost:4299/` for the preview).
   Keep "Expire user authorization tokens" on, Contents: read & write only.
2. **Worker**: add `https://monodi.app` and `http://localhost:4200` (and `:4299`) to
   `ALLOWED_ORIGINS` in `wrangler.toml`, then `npx wrangler deploy`. No code change.
3. **Build variables** (GitHub → Settings → Secrets and variables → Actions → *Variables*):
   `MONODI_GH_CLIENT_ID`, `MONODI_GH_PROXY_URL`, optional `MONODI_GH_APP_URL`
   (`https://github.com/apps/<name>`). `scripts/inject-github-env.js` writes them into
   `src/environments/environment.prod.ts` during the Pages deploy. They are baked in at build time —
   change them, then re-run the workflow.
4. **Local dev**: put the same three values in `src/environments/environment.ts` (client id is public;
   don't commit a secret — there isn't one here).
5. Install the app on the repository you want to sync with.

Without client id + proxy URL the sign-in button is hidden and only the token form shows.

## Not done (yet)

* A Content-Security-Policy meta tag for production. The spec asks for one; it needs a pass over
  inline scripts/CDN loads (jsPDF etc.) first so it doesn't break exports.
