# packages/core

State: 2026-11-03. Modules: `neume-tree` (used by `apps/monodi` and `apps/neume-docs`), and, since 2026-11-03, the MEI export and the pattern code of a neume (used by `apps/monodi`). The two open questions of the neume tree were decided on 2026-11-02.

The place for code that several apps of this repository need, written once: an improvement made here reaches every
app that uses it. It is for the people who maintain the apps (and for tools that work on them). Start with
[the module list](#modules), then [how an app uses the package](#how-an-app-uses-it).

## Modules

| Module | What it does | Used by | Tests |
|---|---|---|---|
| [`src/neume-tree.ts`](src/neume-tree.ts) | The neume tree ("Zeichenbaum" of the *Corpus Monodicum* volumes): reads the code of a neume shape, arranges the codes as a tree (each pattern grows out of the shorter one it contains), goes on from a box, hides a box, places the boxes and lines. The header of the file explains the code notation. | `apps/monodi` (tree view and PDF of the notation documentation), `apps/neume-docs` (tree view and PDF of a project) | [`src/neume-tree.test.ts`](src/neume-tree.test.ts) |
| [`src/mei/`](src/mei/) (import `@monodi/core/mei`) | The MEI export (MEI is the Music Encoding Initiative's XML format for music): `emitter.ts` turns a document into an MEI string (`emitMei`); `mapping.model.ts` is the export profile (which MEI element and attribute each part of the data becomes, `defaultMeiProfile`); `annotations.ts` evaluates the annotation rules of a profile; `header.ts`, `header-mapped.ts`, `header-writer.ts` write the `<meiHead>` from the shared metadata mapping; `metadata-mapping.generated.ts` is that mapping (generated in the CM-hub repository); `comment-tree.ts` writes comments; `schema-catalog.ts` answers which attribute an MEI element allows; `meta.ts` holds the metadata types of a document, a source and the project. | `apps/monodi` (export button, headless batch export `scripts/export-mei-batch.mjs`, annotation rules and mapping editor) | `src/mei/*.test.ts` (no DOM, see [the decision on the DOM](#why-the-tests-of-the-emitted-mei-stay-in-the-app)); the emitted MEI is tested by the specs in `apps/monodi/src/app/mei/` |
| [`src/document/`](src/document/) (import `@monodi/core/document`) | The transcription document as the shared code reads it: `model.ts` (type-only copies of the document types plus the constant objects of the kinds), `pattern.ts` (the pattern code of a neume, `extractPattern`, and the analysis of a whole document), `note-flags.ts` (user-defined note flags such as the virga), `flag-patterns.ts` (search for a pattern and set a flag on the matches). | `apps/monodi` (editor, statistics, search, MEI export) | `src/document/*.test.ts` |

`apps/transcription-equivalents` has no neume tree; its `buildPatternHierarchy` (`ui/src/utils/patternCode.js`)
groups patterns by direction, ligature and modifiers, which is a different structure, and stays in that app.

## Rules for the code here

- No Angular, Vue or browser-framework imports, and no imports of app code: plain TypeScript functions and data
  types. The components that show the data stay in the apps. A module here has no dependencies of its own; the
  package has no `node_modules`. The one browser feature the MEI export uses is the DOM (see
  [the decision on the DOM](#why-the-tests-of-the-emitted-mei-stay-in-the-app)); it is taken from the global
  `document`, never imported.
- The tests of a function live here, next to it, and cover what each app relied on. An app keeps only the tests of
  what it adds on top (for example the picture of a code in neume-docs) and the tests that need a browser DOM.
- Write the TypeScript so that Node can run it without a build step: no enums (use a constant object, see
  `src/document/model.ts`), no parameter properties, `import type` for types, `export type` for type re-exports.
  `tsconfig.json` checks this (`erasableSyntaxOnly`, `verbatimModuleSyntax`).
- **Imports between the files of the package have no file ending** (`from './model'`), apart from the tests, which
  import the file they test with the ending (`from './emitter.ts'`). State 2026-11-03: the first version of this rule
  asked for the ending (`./x.ts`), which works for a single file. It does not work for several files in Angular: the
  `browser` builder of `apps/monodi` rejects `allowImportingTsExtensions` (it needs `noEmit`, and with `noEmit` the
  build emits empty modules), and `rewriteRelativeImportExtensions` turns `./x.ts` into `./x.js`, which webpack cannot
  resolve to `x.ts`. Vite and esbuild (neume-docs, the batch export) resolve both forms. Node does not resolve the
  form without ending, so `npm test` loads [`src/resolve-ts.mjs`](src/resolve-ts.mjs), a ten-line resolve hook that
  adds `.ts` (and `/index.ts` for a folder). It is used by the tests only.
- A folder with an `index.ts` is an entry point: `@monodi/core` is `src/neume-tree.ts`, `@monodi/core/mei` is
  `src/mei/index.ts`, `@monodi/core/document` is `src/document/index.ts` (`exports` in `package.json`; an Angular app
  maps them with `paths`, see below). The apps import by these names only.
- The apps build the package from source. It is not built or published on its own.

### The data types are structural copies

The apps keep their own document types (`apps/monodi/src/app/types/model.ts`, with string enums such as
`LinePartKind`). The shared code does not import them; `src/document/model.ts` declares the fields it reads as
type-only interfaces, with the kinds as string literals (`kind: 'Syllable'`) and the same string values as the app's
enums. An app type is assignable to the shared type, so the app passes its documents unchanged, and the app's build
fails if the app's type stops matching (a renamed field or enum value). Where a shared function returns part of its
input to the app, it is generic in that part (`firstNoteOf`), so the app gets its own type back. The same holds for
the metadata of a document, a source and the project (`src/mei/meta.ts`). `types/model.ts` of the app stays
authoritative for the data format.

### Why the tests of the emitted MEI stay in the app

Decision of 2026-11-03 (role: maintainer of the MEI export; the export was moved into this package on that date):
the emitter builds the MEI with the browser DOM (`document.implementation.createDocument`, `querySelector`,
`XMLSerializer`), and the specs read the result with `DOMParser`. Node has none of this. Options: (a) add a DOM library
(`linkedom`, `@xmldom/xmldom`) to the package, (b) run the tests in a browser from here, (c) keep the tests that need
a DOM in the app's Karma run, which already has a real browser. Chosen: (c).

- (a) would give the package a `node_modules`, and a library's DOM differs from Chrome's in details (namespaces,
  `:scope` selectors) that the specs check. The export would then be tested against a DOM that no user has.
- (b) needs a browser and a runner here, which the rule "nothing to install" excludes.
- (c) costs nothing new: `apps/monodi/src/app/mei/mei-emitter.spec.ts`, `mei-conformant.spec.ts`, `mei-header.spec.ts`
  and `mei-annotations.spec.ts` import the emitter from `@monodi/core/mei` and run in headless Chrome (`ng test`, job
  `monodi` of the CI). They include the three rules that Verovio and MEI-Friend need (`notationtype="neume"` on the
  `staffDef`, a section of its own for each further line, annotations inside the `layer`, in `mei-conformant.spec.ts`).
  The headless batch export runs the same emitter in headless Chrome.
- What needs no DOM is tested here: the pattern code, the note flags, the export profile and its migration, the rule
  engine of the annotations, the helpers of the emitter (clef line, fields of a note) and the coverage of the header
  mapping (`src/mei/*.test.ts`, `src/document/*.test.ts`), and `src/exports.test.ts` loads every module in Node.

When a DOM is needed from another place (a second app that exports MEI), the emitter still takes it from the global
`document`; a caller without one has to provide it first.

## How to check

```bash
cd packages/core && npm test
```

This runs the unit tests with Node's own test runner (Node 22.18 or newer runs TypeScript directly; there is nothing
to install). `.github/workflows/ci.yml` runs them in the job `core` when `packages/core` changes. The same change
also runs the build and unit tests of `apps/monodi` and `apps/neume-docs`, so a change that fits the tests here but
breaks an app is found in the same pull request. The types are checked by the apps' builds (Angular type-checks the
modules in strict mode). To check the package on its own, with the TypeScript of an app:

```bash
cd packages/core && ../../apps/monodi/node_modules/.bin/tsc -p tsconfig.json --typeRoots ../../apps/monodi/node_modules/@types
```

Output of the export before and after a change must stay identical:
`node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip> --level 3` in `apps/monodi`, run on the commit
before and on the commit after, and compared file by file (state 2026-11-03: identical for 4987 documents at level 3,
300 documents at levels 1 and 2 and with `--legacy-structure`, before and after the move of the export into this package).

## How an app uses it

An app links the package into its own folder (`vendor/cm-core`) and imports `@monodi/core`; `scripts/sync-app.sh` replaces the link by a copy in the mirror. Adding it to an app, the settings Angular needs (including the sub-paths `@monodi/core/mei` and `@monodi/core/document`), the first trial and the merged behaviour: [docs/integration.md](docs/integration.md).

## Open items

State 2026-11-03.

| # | Item | Context and options | Who decides |
|---|---|---|---|
| 1 | The generator of `src/mei/metadata-mapping.generated.ts` writes a line the package no longer accepts | The file is generated in the CM-hub repository (`python -m cmhub.mapping --ts <path>`, `src/cmhub/mapping.py`). Its import line is `import { MetadataMapping } from './metadata-mapping.model';`; here it is `import type { MetadataMapping } from './metadata-mapping.model';`, because Node strips types but keeps a plain import of a type and then fails when the file loads (`src/exports.test.ts` fails on it). Until the generator writes `import type`, the line has to be corrected by hand after each regeneration. Option: change the one line in `mapping.py` (a change in another repository), and name the new path `packages/core/src/mei/metadata-mapping.generated.ts` in `docs/METADATA-STANDARDS.md` of CM-hub, which still names `monodi-light/src/app/mei/`. | maintainer of CM-hub |
| 2 | The DOM-dependent specs of the export are not run by `npm test` here | Decided on 2026-11-03 to stay in the app's Karma run (see [the decision on the DOM](#why-the-tests-of-the-emitted-mei-stay-in-the-app)). A reason to revisit: a second app that exports MEI would need the same specs, or a package-level way to run them in a browser. | maintainer of the MEI export |
