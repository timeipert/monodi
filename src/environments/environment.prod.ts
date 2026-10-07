export const environment = {
  production: true,
  apiPrefix: "/api/",
  // Filled in at build time by scripts/inject-github-env.js from the
  // MONODI_GH_CLIENT_ID / MONODI_GH_PROXY_URL / MONODI_GH_APP_URL variables.
  githubClientId: "",
  githubAuthProxyUrl: "",
  githubAppUrl: ""
};
