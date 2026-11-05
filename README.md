<img width="1440" height="530" alt="grafik" src="https://github.com/user-attachments/assets/4e8d914a-9c46-48de-8f3d-a93c44f88f03" />

**A local-first digital workbench for the transcription, edition, and analysis of medieval monophonic chant.**

[Monodi-Zero](https://monodi.app) runs in the browser, with no server and no account: a keyboard-driven notation editor, a IIIF (manuscript image) viewer, a critical apparatus, corpus search and synopsis, and export to PDF, MEI (Music Encoding Initiative XML), HTML and ZIP.

**The browser owns the storage: clearing its site data deletes the workspace, so make regular backups.**

- **Using it:** open the app and read *Manual* in its navigation bar. All features: [FEATURES.md](documentation/FEATURES.md).
- **Developing it:** Angular, no backend. Rules for changes: [CLAUDE.md](CLAUDE.md).

```bash
npm ci
npx ng serve           # development server at http://localhost:4200
npx ng test --watch=false --browsers=ChromeHeadless
```

Desktop packaging (Electron) and related projects: [FEATURES.md](documentation/FEATURES.md).

## Documentation

Markdown documents of `apps/monodi`. `README.md` and `CLAUDE.md` stay in the app folder because tools look for them there; the other documents are in `documentation/` (for people) and `LLM/` (for agents and developers who work on the bridge to the Neume Viewer).

| Document | What it is for |
|---|---|
| [FEATURES.md](documentation/FEATURES.md) | Full description of all features for users and developers; Electron packaging and related projects. |
| [CLAUDE.md](CLAUDE.md) | Rules for changes (shared code, headless exports, deployment of monodi.app) and the project-wide writing rules. |
| [CHANT-SVG.md](documentation/CHANT-SVG.md) | How the headless SVG export draws a chant like the PDF export (`scripts/export-svg-batch.mjs`). |
| [GITHUB-LOGIN.md](documentation/GITHUB-LOGIN.md) | How "Sign in with GitHub" works (GitHub App, PKCE, proxy) and how it is configured. |
| [INTEGRATION-PLAN.md](documentation/INTEGRATION-PLAN.md) | Plan for the file exchange between Monodi-Zero and the Neume Viewer (annotation exchange). |
| [NEUME-VIEWER-INTERNALS.md](LLM/NEUME-VIEWER-INTERNALS.md) | Description of the Neume Viewer (the sibling app) as seen from Monodi-Zero: what it reads and writes. |

Files that were taken out of the app because they were unused or broken are in `archive/monodi/` at the root of the
monorepo (list: `archive/monodi/README.md`).

## npm scripts

Run in this folder with `npm run <name>`.

- **Develop:** `start` (development server, port 4200), `build` (production build with relative base href), `ng`
  (Angular CLI), `fixtures` (regenerate the test data in `src/app/testdata`).
- **Test:** `test` (unit tests, watch mode), `test:ci` (unit tests once, headless Chrome), `check:templates` (every
  member a template uses exists on its component), `check:mei-header` (MEI header check).
- **Browser tests** (headless Chrome against a running development server, see the header of each script in
  `scripts/`): `test:smoke`, `test:pdf`, `test:pdf-perf`, `test:layout`, `test:cover`, `test:description`,
  `test:fields`, `test:notation`, `test:metadata`, `test:svg-batch`.
- **Electron (desktop app):** `build:electron`, `electron:start`, `pack` (unpacked app), `dist:electron` (installers).

Not maintained since 2026-11-05: `ng lint` (TSLint, no lint target) and `ng e2e` (Protractor, end of life); their
files are in `archive/monodi/`.

---

> **Where this code is edited.** The source of this app is the folder `apps/monodi` of [timeipert/monodi-platform](https://github.com/timeipert/monodi-platform/tree/main/apps/monodi). The repository [timeipert/monodi](https://github.com/timeipert/monodi) receives a copy of that folder and deploys it; it is not edited directly (a commit there stops the copy). How the copy works: `docs/sync.md` in monodi-platform.
