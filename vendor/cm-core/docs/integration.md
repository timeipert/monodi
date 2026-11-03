# Using packages/core in an app, and what the first merge found

For maintainers who add the package to an app or change a module. State 2026-11-02. The rules for the code are in [README.md](../README.md).

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
- **An Angular app needs three more settings** (found on 2026-11-02, see below): `"paths": { "@monodi/core":
  ["vendor/cm-core/src/neume-tree.ts"] }` in its `tsconfig.json`, and `"preserveSymlinks": true` in the `build` and
  the `test` options of `angular.json`. Without them the production build passes, but the development build, which
  the browser tests run against, contains the module empty. A Vite app needs none of this.
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
| Development server | not run (this was the gap, see the first finding) | serves the module (`vite`, HTTP 200) |

Findings:

- **Angular: the first trial was wrong about `preserveSymlinks`.** The production build (AOT) and the unit tests passed
  without any setting, so the trial concluded that none is needed. The development build (`aot: false`) compiled
  `@monodi/core` to an **empty module**: TypeScript treats a package found through `node_modules` as an external
  library, whose source Angular does not compile, even when the link points into the repository. The result was
  `buildNeumeTree is not a function` in the browser tests of `apps/monodi` after the merge (pull request #10), caught
  by the mirror's CI before the deploy (the deploy job was skipped; https://monodi.app kept its earlier version).
  Fix: map the name with `paths` to the file in `vendor/cm-core` (no longer a library import), and set
  `preserveSymlinks` so that webpack and the TypeScript program name the file alike (without it the loader reports
  that the file "is missing from the TypeScript compilation"). With both, development build, production build, unit
  tests and all 18 browser test scripts of the CI pass, in the monorepo and in a `scripts/sync-app.sh` copy.
  `.github/workflows/ci.yml` now builds the development bundle in the Monodi job and checks that it contains the
  module, so a pull request fails on this.
- **Vite needs no setting for building.** It follows the link too; the one addition is that Vitest must not run the
  package's tests a second time (see above).
- `apps/monodi/angular.json` and `tsconfig.json` carry the settings of the first finding.
- The browser tests of Monodi run in the mirror's CI after the sync; they were not run in the first trial, which is
  why that finding was missed.

## Behaviour differences found when the copies were merged

State 2026-11-02. Compared: `apps/monodi/src/app/neume-tree.ts` (copied on 2026-10-19, commit `41969153`) and
`apps/neume-docs/ui/src/utils/neumeTree.js`, which received three later changes on 2026-10-22 that Monodi's copy
never got. `apps/transcription-equivalents` has no copy. Column "Core" is what the shared module does.

| # | Difference | Monodi (before) | neume-docs (before) | Core | Effect on the apps |
|---|---|---|---|---|---|
| 1 | Where a line bends (neume-docs commit `edc91f63`, "Keep the lines of the neume tree off the boxes") | one S-curve from box to box, which can cross a box when a pattern skips a column | level out of the box, curve in the gap after the parent's column, level into the box | neume-docs behaviour; edges carry `xa`, `xb` and the path `d` | **Monodi's lines change** on screen and in the PDF (a fix) |
| 2 | The root (neume-docs commit `605ace7b`, "start the neume tree at its single notes") | the root has a column and a box (a dot), and a line to each single note | the root is not drawn; the single notes start the tree | not drawn, in both apps (decision 1) | **Monodi's dot and the lines from it are gone** on screen and in the PDF; the tree begins at the single notes |
| 3 | Special signs (neume-docs commit `b025dc61`) | no `hasSpecialSign` | `hasSpecialSign(code)`, for leaving special signs out of the tree | `hasSpecialSign` | none: Monodi does not call it |
| 4 | Going on from a box, hiding a box, allowing only some boxes (`grown`, `hidden`, `allow`, `continuations`, `treeCode`, `treeNotation`; fields `chosen`, `grown`, `canGrow`) | not there | there | there | none: Monodi's calls use the defaults, which give the former result |
| 5 | Reading a code that has blanks around it | `baseCode`: blanks around are dropped, any white space ends the code (`" *u"` is `*u`) | `getBaseCode`: only the first space ends the code, nothing is trimmed (`" *u"` is empty and the pattern is dropped without a word) | Monodi's reading (decision 2) | neume-docs now accepts a code with leading blanks in the tree that its table (`getBaseCode`) still ignores |
| 6 | No list of codes (`null`) | throws | treated as empty | treated as empty | none |
| 7 | Layout call | `layoutNeumeTree(tree, size, columnGap, rowGap)` and a separate `edgePath(edge)` | `layoutNeumeTree(tree, size, { columnGap, rowGap })`, the path is `edge.d` | neume-docs form; `edgePath` is gone | Monodi's three callers are changed |
| 8 | Key of the virga | the constant `V` | `DEFAULT_SIGNS[0].key` (also `V`) | the constant `VIRGA = 'V'` | `neumeTree.test.js` fails if neume-docs ever changes its first default sign |

What stays in neume-docs and is not shared: the picture of a code (`treePicture`), the size of a box (`nodeSize`,
`LABEL`, `THUMB`) and the line colour (`TREE_INK`), because they depend on that app's SVG renderer and PDF export.
`apps/neume-docs/ui/src/utils/neumeTree.js` re-exports the shared functions, so the app's imports did not change.

### Decisions

State 2026-11-02. Both were open questions after the first merge of the copies and were decided by the repository
owner on 2026-11-02.

1. **No root dot in Monodi.** The tree begins at the single notes (`*`, `*V`) in both apps, as neume-docs has drawn it
   since 2026-10-22. The layout has no option for a root: `layoutNeumeTree` never asks for the size of the root, has
   no column for it and no line from it. Monodi's tree view (`nd-tree.component.ts`) and PDF (`notation-doc-draw.ts`)
   draw no dot; the end-to-end check `scripts/notation-set-e2e.mjs` expects a line for every box except the single
   notes.
2. **Blanks around a code are ignored.** `baseCode` trims them and ends the code at the first white space
   (`" *u"` is `*u`). The tree therefore keeps a code that has blanks around it. The table of neume-docs
   (`getBaseCode`) still drops such a code; whether any stored code has blanks around it has not been checked in the
   data of either app.
