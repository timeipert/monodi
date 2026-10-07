#!/usr/bin/env node
/**
 * Writes the "Sign in with GitHub" settings into src/environments/environment.prod.ts
 * before a production build. Values come from the environment:
 *
 *   MONODI_GH_CLIENT_ID       Client ID of the GitHub App (public)
 *   MONODI_GH_PROXY_URL  URL of the sign-in proxy (Cloudflare Worker)
 *   MONODI_GH_APP_URL         https://github.com/apps/<name>  (optional, "Install" button)
 *
 * Unset variables leave the file untouched, so a build without them simply has
 * no "Sign in with GitHub" button (the token fallback still works).
 * The client SECRET never appears here — it lives only in the proxy.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');
let src = fs.readFileSync(file, 'utf8');

const map = {
  githubClientId: process.env.MONODI_GH_CLIENT_ID,
  githubAuthProxyUrl: process.env.MONODI_GH_PROXY_URL,
  githubAppUrl: process.env.MONODI_GH_APP_URL,
};

for (const [key, value] of Object.entries(map)) {
  if (!value) continue;
  const clean = String(value).trim().replace(/["\\\n\r]/g, '');
  src = src.replace(new RegExp(`(${key}:\\s*)"[^"]*"`), `$1"${clean}"`);
  console.log(`inject-github-env: ${key} set`);
}
fs.writeFileSync(file, src);
