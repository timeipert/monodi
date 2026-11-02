# packages/core

State: 2026-11-02. Baseline: first module `neume-tree` (used by `apps/monodi` and `apps/neume-docs`).

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

Each mirror repository must build on its own, without the monorepo. So an app gets the package through a symbolic
link inside its own folder and depends on it as a local file:

| App | Link (committed in git) | Entry in `package.json` | Import |
|---|---|---|---|
| `apps/monodi` | `vendor/cm-core -> ../../../packages/core` | `"@monodi/core": "file:vendor/cm-core"` | `from '@monodi/core'` |
| `apps/neume-docs` | `ui/vendor/cm-core -> ../../../../packages/core` | `"@monodi/core": "file:vendor/cm-core"` in `ui/package.json` | `from '@monodi/core'` |

- In the monorepo the link points here. `scripts/sync-app.sh` replaces a link that points outside the app folder by a
  copy of what it points to, so the mirror receives the files themselves in `vendor/cm-core/` and builds without the
  monorepo. `package-lock.json` names `vendor/cm-core` in both places and stays valid in both.
- `npm ci` in the app folder makes `node_modules/@monodi/core` a link to `vendor/cm-core`. There are no npm
  workspaces at the root (see `CLAUDE.md`).
- **Adding the package to a further app:** create the link (`mkdir vendor && ln -s <relative path to packages/core>
  vendor/cm-core`), add the line to the `dependencies` of `package.json` **by hand**, run `npm install` in the app
  folder, and add the app to the `LIST` in the step "Find the apps this change touches" of `.github/workflows/ci.yml`.
  Do not run `npm install --save @monodi/core@file:vendor/cm-core`: npm follows the link and writes the real path
  (`file:../../packages/core`), which does not exist in a mirror.
- A test runner of the app must not pick up the tests of `vendor/cm-core`: `apps/neume-docs/ui/vite.config.js`
  excludes `vendor/**`; Karma in `apps/monodi` takes only `*.spec.ts` and ignores the package's `*.test.ts`.
- Edit the code in `packages/core`, never in a `vendor/cm-core` of a mirror (a mirror is never edited, see
  `docs/sync.md`).

### Result of the first trial (2026-11-02)

Tried with `apps/monodi` first, then `apps/neume-docs`. Each was built and tested twice: in the monorepo (link) and
in a copy made by `scripts/sync-app.sh` into an empty Git repository (the state of a mirror), with `npm ci` there.

| Check | `apps/monodi` | `apps/neume-docs` |
|---|---|---|
| Unit tests, monorepo | 1142 passed (`ng test`) | 1460 passed (`npm test` in `ui/`) |
| Production build, monorepo | passed (`ng build --configuration production`) | passed (`npm run build` in `ui/`) |
| Same three checks in the `sync-app.sh` copy | passed | passed |
| Development server | not run | serves the module (`vite`, HTTP 200) |

Findings:

- **Angular needs no `preserveSymlinks`.** The build and the tests pass with the default and with
  `--preserve-symlinks`. Without the option the compiler follows the link and treats the TypeScript source as part of
  the app, in the monorepo (`packages/core/src`) and in a copy (`vendor/cm-core/src`). The default is kept.
- **Vite needs no setting for building.** It follows the link too; the one addition is that Vitest must not run the
  package's tests a second time (see above).
- `apps/monodi/angular.json` and `src/tsconfig*.json` are unchanged.
- Not run: the browser tests of Monodi (`npm run test:notation`), which run in the mirror's CI after the sync.

## Behaviour differences found when the copies were merged

State 2026-11-02. Compared: `apps/monodi/src/app/neume-tree.ts` (copied on 2026-10-19, commit `41969153`) and
`apps/neume-docs/ui/src/utils/neumeTree.js`, which received three later changes on 2026-10-22 that Monodi's copy
never got. `apps/transcription-equivalents` has no copy. Column "Core" is what the shared module does.

| # | Difference | Monodi (before) | neume-docs (before) | Core | Effect on the apps |
|---|---|---|---|---|---|
| 1 | Where a line bends (neume-docs commit `edc91f63`, "Keep the lines of the neume tree off the boxes") | one S-curve from box to box, which can cross a box when a pattern skips a column | level out of the box, curve in the gap after the parent's column, level into the box | neume-docs behaviour; edges carry `xa`, `xb` and the path `d` | **Monodi's lines change** on screen and in the PDF (a fix) |
| 2 | The root (neume-docs commit `605ace7b`, "start the neume tree at its single notes") | the root has a column and a box (a dot), and a line to each single note | the root is not drawn; the single notes start the tree | both, by the option `showRoot` (default: not drawn) | none: Monodi passes `showRoot: true` and keeps its dot; see open question 1 |
| 3 | Special signs (neume-docs commit `b025dc61`) | no `hasSpecialSign` | `hasSpecialSign(code)`, for leaving special signs out of the tree | `hasSpecialSign` | none: Monodi does not call it |
| 4 | Going on from a box, hiding a box, allowing only some boxes (`grown`, `hidden`, `allow`, `continuations`, `treeCode`, `treeNotation`; fields `chosen`, `grown`, `canGrow`) | not there | there | there | none: Monodi's calls use the defaults, which give the former result |
| 5 | Reading a code that has blanks around it | `baseCode`: blanks around are dropped, any white space ends the code (`" *u"` is `*u`) | `getBaseCode`: only the first space ends the code, nothing is trimmed (`" *u"` is empty and the pattern is dropped without a word) | Monodi's reading; see open question 2 | neume-docs now accepts a code with leading blanks in the tree that its table (`getBaseCode`) still ignores |
| 6 | No list of codes (`null`) | throws | treated as empty | treated as empty | none |
| 7 | Layout call | `layoutNeumeTree(tree, size, columnGap, rowGap)` and a separate `edgePath(edge)` | `layoutNeumeTree(tree, size, { columnGap, rowGap })`, the path is `edge.d` | neume-docs form, plus `showRoot`; `edgePath` is gone | Monodi's three callers are changed |
| 8 | Key of the virga | the constant `V` | `DEFAULT_SIGNS[0].key` (also `V`) | the constant `VIRGA = 'V'` | `neumeTree.test.js` fails if neume-docs ever changes its first default sign |

What stays in neume-docs and is not shared: the picture of a code (`treePicture`), the size of a box (`nodeSize`,
`LABEL`, `THUMB`) and the line colour (`TREE_INK`), because they depend on that app's SVG renderer and PDF export.
`apps/neume-docs/ui/src/utils/neumeTree.js` re-exports the shared functions, so the app's imports did not change.

### Open questions

State 2026-11-02. Both are decided by the repository owner.

1. **Root of the tree in Monodi.** Monodi draws a dot as the root, with a line to each single note, on screen
   (`nd-tree.component.ts`) and in the PDF (`notation-doc-draw.ts`). neume-docs dropped the root on 2026-10-22 so the
   tree begins at the single notes, and the header of the former Monodi copy says its rules are those of
   neume-docs. Options: (a) keep the dot in Monodi (the present state, `showRoot: true`); (b) drop it in Monodi as
   well and make `showRoot` obsolete: change the two callers, remove the option and its tests.
2. **Blanks around a code.** Options: (a) keep Monodi's reading in core (the present state); (b) use neume-docs's
   reading (`" *u"` is dropped), which makes the tree agree with the table of neume-docs but discards a code that
   Monodi accepted. Whether any stored code has blanks around it has not been checked in the data of either app. The
   reading is the one function `baseCode` in `src/neume-tree.ts`.
