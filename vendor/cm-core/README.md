# packages/core

State: 2026-11-02, both open questions decided. Baseline: first module `neume-tree` (used by `apps/monodi` and `apps/neume-docs`).

The place for code that several apps of this repository need, written once: an improvement made here reaches every
app that uses it. It is for the people who maintain the apps (and for tools that work on them). Start with
[the module list](#modules), then [how an app uses the package](#how-an-app-uses-it).

## Modules

| Module | What it does | Used by | Tests |
|---|---|---|---|
| [`src/neume-tree.ts`](src/neume-tree.ts) | The neume tree ("Zeichenbaum" of the *Corpus Monodicum* volumes): reads the code of a neume shape, arranges the codes as a tree (each pattern grows out of the shorter one it contains), goes on from a box, hides a box, places the boxes and lines. The header of the file explains the code notation. | `apps/monodi` (tree view and PDF of the notation documentation), `apps/neume-docs` (tree view and PDF of a project) | [`src/neume-tree.test.ts`](src/neume-tree.test.ts) |

`apps/transcription-equivalents` has no neume tree; its `buildPatternHierarchy` (`ui/src/utils/patternCode.js`)
groups patterns by direction, ligature and modifiers, which is a different structure, and stays in that app.

## Rules for the code here

- No Angular, Vue or browser-framework imports, and no imports of app code: plain TypeScript functions and data
  types. The components that show the data stay in the apps. A module here has no dependencies of its own; the
  package has no `node_modules`.
- The tests of a function live here, next to it, and cover what each app relied on. An app keeps only the tests of
  what it adds on top (for example the picture of a code in neume-docs).
- Write the TypeScript so that Node can run it without a build step: no enums, no parameter properties, `import`
  with the file ending (`./x.ts`), `import type` for types. A module is one file, or files that import each other
  with the ending; the apps import the package by its name only (`@monodi/core`).
- The apps build the package from source. It is not built or published on its own.

## How to check

```bash
cd packages/core && npm test
```

This runs the unit tests with Node's own test runner (Node 22.18 or newer runs TypeScript directly; there is nothing
to install). `.github/workflows/ci.yml` runs them in the job `core` when `packages/core` changes. The same change
also runs the build and unit tests of `apps/monodi` and `apps/neume-docs`, so a change that fits the tests here but
breaks an app is found in the same pull request. The types are checked by the apps' builds (Angular type-checks the
module in strict mode).

## How an app uses it

An app links the package into its own folder (`vendor/cm-core`) and imports `@monodi/core`; `scripts/sync-app.sh` replaces the link by a copy in the mirror. Adding it to an app, the settings Angular needs, the first trial and the merged behaviour: [docs/integration.md](docs/integration.md).
