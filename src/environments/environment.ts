// This file can be replaced during build by using the `fileReplacements` array.
// `ng build ---prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  apiPrefix: "http://localhost:9070/api/",
  // "Sign in with GitHub" (GitHub App + sign-in proxy). See GITHUB-LOGIN.md.
  // For local development put your own values here (do not commit a secret —
  // there is none in this file: the client id is public).
  githubClientId: "",
  githubAuthProxyUrl: "",
  githubAppUrl: ""
};

/*
 * In development mode, to ignore zone related error stack frames such as
 * `zone.run`, `zoneDelegate.invokeTask` for easier debugging, you can
 * import the following file, but please comment it out in production mode
 * because it will have performance impact when throw error
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
