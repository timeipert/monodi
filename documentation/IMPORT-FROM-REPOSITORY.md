# Import from Repository

**What it is for.** The function *Import / Export → From the web → Repository* of Monodi-Zero loads transcriptions from a
public GitHub repository into the workspace, after the person has filtered what is needed, so that little browser
storage is used. **Who it is for.** Developers who change or reuse the function (neume-docs is a planned second
client) and maintainers who need to know what the function writes into the workspace. **Where to start.** "How it
works", then "Where the code is". **State.** 2026-11-14: built on the branch `monodi/feat/import-from-repository`
(layout version 1 of the catalogue); checked by the specs named under "How it is checked" and by hand against the
published repository.

**Terms.** *Source*: a manuscript (a handwritten book). *Chant* or *document*: one chant as transcribed from a source.
*Catalogue*: the file `catalog.json` that lists the datasets of a repository. *Index*: a small file that describes many
large files, so that the filters run before anything large is downloaded. *SHA-256*: a checksum of a file; two files
with the same value are identical. *Volpiano*: a text notation for chant melodies. *Manifest*: the record of what was
imported (below).

## How it works

1. The dialog reads `catalog.json` of the repository
   [corpus-monodicum/monodi-datasets](https://github.com/corpus-monodicum/monodi-datasets) (address in
   `DEFAULT_CATALOG_URL`, `packages/core/src/datasets/urls.ts`, fixed to the tag `v1`). A person can type another
   repository (`owner/name` or `owner/name@tag`) that has a catalogue in the same format.
2. The catalogue lists the datasets with the size and SHA-256 of each `dataset.json`; that file lists the same for its
   index files; the index lists them for every file that is imported. The client checks every file against the value
   it was promised (the chain of hashes, `docs/FORMAT.md` of the repository). A file that does not match is not stored.
3. The person filters the index in the browser and ticks sources. The dialog shows the number of sources and chants, the
   bytes to download, an estimate of the bytes in the workspace, and the browser storage that is free
   (`navigator.storage.estimate()`); an import that would not fit is refused, one that takes more than half of the free
   space is marked. If the GitHub sync is connected, the dialog adds that *Push* would upload the imported sources.
4. Reading uses `raw.githubusercontent.com`, which allows requests from any page and has no limit of 60 requests per
   hour (that limit applies to `api.github.com` for callers without sign-in).

| Dataset (state 2026-11-14) | Index | What is imported |
|---|---|---|
| Corpus Monodicum (114 sources, 6,870 chants) | filters by siglum, library, place, century, region; chants by text, genre | the source and chant metadata and the notes, unchanged, from the pinned commit of `corpus-monodicum/dataset` |
| CantusCorpus 1.0 (2,278 sources, 888,010 chants, 60,586 with melody) | filters by siglum, title, provenance, century, cursus, database, "only sources with melodies" | per chant: with melody (`with-melody`), without melody (`without-melody`, to transcribe) or all; a melody in Volpiano becomes notes (`volpianoToRoot`), a chant without melody becomes a document that holds its text split into syllables |

## What is written, and what is not

- The notes of a batch of chants are stored first, and the chants are listed afterwards, so a listed document always has its
  notes. The lists of sources and documents are **not held for the whole import**: each write reads the lists as they are
  at that moment and adds what the import staged, so a chant that a person creates or edits during a long import is not
  overwritten by an older copy. A write happens after a few hundred chants (a tenth of the listed documents if that is
  more), when 25 sources are staged, and at the end of the import, also after an error or a cancel. A source that an
  import added but that got no chant (an error came first) is not left behind.
- One import takes at most 50,000 chants (`MAX_DOCUMENTS_PER_IMPORT`): the workspace keeps the list of all documents in one
  row of the browser storage, and all of the Cantus Corpus (888,010 chants) would make that row too large.
- Files are read only over https and only from the host of the catalogue (the default catalogue and the Corpus Monodicum
  both come from `raw.githubusercontent.com`); a catalogue of a repository that a person typed cannot make the browser
  call another host. A catalogue or dataset file without licence or counts is shown with default values.
- A chant whose identifier already exists in the workspace is **kept as it is**. The checkbox *Replace chants that are
  already here* (off by default) replaces them. The same rule holds for the metadata of a source.
- The keys of the metadata are read by `sourceFromMeta` and `documentFromMeta` (`src/app/workspace-import.ts`), the same
  functions that the ZIP import uses; a key without a field goes to `custom`.
- The workspace backup (`.monodijson`) does not contain the manifest. After a restore of a backup, the list under
  *Imported* is empty, the imported sources are in the workspace as any other.

## Speed

Measured on 2026-11-14 from one computer over one connection, against the published repository (`raw.githubusercontent.com`
serves each file from a cache that is slower for a file nobody asked for recently, so the figures vary).

- **What limits the transfer is the delay of each request, not the bandwidth.** 80 chants of one source (160 files, about
  10 MB, not asked for recently) came with 4 requests at a time at 1.5 MB/s, with 8 at 2.6 MB/s, with 16 at 4.1 MB/s and
  with 32 at 9.5 MB/s. The first version of the import fetched 8 chants (16 files) at a time and waited for the slowest of
  each group before it stored them and asked for the next group.
- **The import therefore fetches ahead** (`prefetch` in `packages/core/src/datasets/client.ts`): up to 24 chants of the
  Corpus Monodicum (two files each; a source file counts as one) run ahead of the chant that is being stored, across the
  border of two sources, and up to 12 sources of the Cantus Corpus (the chunks of one source are asked for together).
  The results are handed out in order; the first failed file stops all the others.
- **Writes are batched.** The notes of 25 chants are stored in one step (the index row of the notes store is written once per
  step), and the lists of sources and documents are written when a few hundred chants are staged.
- **Results** (first version, then this version; different sources, so only the order of magnitude compares): a Corpus
  Monodicum source of 395 chants and 45.9 MB took 18 s (2.5 MB/s); a source of 261 chants and 28.8 MB took 4.6 s (6.3 MB/s);
  32 small sources (147 chants, 6.2 MB) took 3.1 s; 11,038 Cantus melodies of 16 sources took 9.1 s; 8,375 Cantus
  chants without melody took 6 s. The longest block of the main thread during these imports was 57 to 154 ms.
- **Chants that exist already are not downloaded.** An import of a source that is in the workspace already took 0.4 s and
  one request (the source `Pa 1871`, 395 chants, 45.9 MB, before: 18 s and the whole download); with *Replace* ticked the same
  source took 4.3 s (the files were in the cache of the server by then).
- **The filters and plans are fast enough** and are not cached: on the real indexes a filter of the 2,278 Cantus sources takes
  3 ms, a plan of all 6,870 chants of the Corpus Monodicum 1 to 4 ms, and reading and parsing both indexes about 0.5 s.

## The manifest

`monodi_dataset_imports` (IndexedDB, next to the workspace lists) holds one record per imported source: dataset,
source, the source in the workspace, version (commit or release), a fingerprint (SHA-256 over the hashes of the files
of the source), the identifiers of the chants that the import wrote, and the date. It serves two functions:

- *Check for updates* (Corpus Monodicum): reads only the indexes and compares the fingerprint of each imported source with
  the one at the import. *Update* then replaces the chants of that source after a confirmation (edits to them are lost).
- *Remove*: deletes the chants that the import wrote and their notes, and the source if no other chant belongs to it. Chants
  that a person added to the same source stay, and so does the source.

The in-app manual describes the dialog in the section *Import from Repository* of the page *Import / Export*
(`src/app/manual/pages/import-export/`).

## Where the code is

| What | Where |
|---|---|
| Client, catalogue, filters, plans, record of imports (framework-free, tested in Node) | `packages/core/src/datasets/` (import `@monodi/core/datasets`; [README of the package](../../../packages/core/README.md)) |
| Writing into the workspace, manifest, removal | `src/app/repository-import.service.ts` |
| Notation of a Cantus chant (melody or text only) | `src/app/repository-documents.ts` |
| Records from `meta.json` (shared with the ZIP import) | `src/app/workspace-import.ts` |
| Dialog | `src/app/repository-import/` (component `app-repository-import`, opened from `import-export.component`) |

## How it is checked

- `cd packages/core && npm test`: `src/datasets/datasets.test.ts` (fetch with checksum, repetitions, cancel, the chain of
  hashes, hosts and https, default values, filters, plans, manifest) with a repository served from memory.
- `cd apps/monodi && npx ng test --watch=false --browsers=ChromeHeadless`: `repository-import.service.spec.ts` (import of both
  datasets into the real IndexedDB of the test browser, kept and replaced chants and sources, a chant created during the
  import, the limit, a tampered file, update check, removal), `repository-documents.spec.ts` (text-only documents),
  `repository-import.component.spec.ts` (the dialog: filters, size, storage, limit, another repository) and
  `workspace-import.spec.ts`. State 2026-11-14: 1388 of 1388 specs pass.
- By hand on 2026-11-14 against the published repository (tag `v1`): the Corpus Monodicum source `Abb 7` (4 chants, 79 KB)
  and the Cantus source `CDN-Mrb MS Medieval 0025` (16 chants, 7 KB) imported, opened in the editor, update check
  ("up to date"), removal. Larger imports for timing: the Corpus Monodicum source `Pa 1871` (395 chants, 45.9 MB downloaded)
  took 18 s and the Cantus source `F-AS 465` (8,375 chants, all without melody) 6 s; the page stayed responsive (the longest
  block of the main thread was 34 ms and 56 ms). There is no automated browser test that reads the real repository: it would fail whenever
  GitHub is not reachable.

## Open questions

| No. | Question | Context | Options | Who decides |
|---|---|---|---|---|
| 1 | Imports and the GitHub sync | A workspace that is connected to a GitHub repository pushes every source, including imported ones, with the button *Push* (the button *Auswahl…* pushes only chosen sources). An import of the whole Corpus Monodicum (468 MB of notes) would fill the repository of the person. State 2026-11-14: the dialog warns, with the size, when the sync is connected; nothing else is done. | keep the warning; mark imported sources as "do not sync" in the push (changes `github.service.ts`); ask before the first push of imported sources | maintainer of Monodi-Zero |
| 2 | Fixed tag in the default address | `DEFAULT_CATALOG_URL` points to the tag `v1`. A dataset added to the catalogue, or an upstream version that changes the layout, reaches users only with a release of the app (state 2026-11-14). | keep the tag (stable); read `main` (immediate, but a change in the repository reaches everyone at once) | maintainer of Monodi-Zero with the maintainer of the repository |
| 3 | Estimates of the storage of imports | The constants `CM_STORED_RATIO`, `ESTIMATED_BYTES_PER_DOCUMENT` and `ESTIMATED_BYTES_PER_MELODY` are measured on four sources (state 2026-11-14, values in the comments of `packages/core/src/datasets/cm.ts` and `cantus.ts`). Longer melodies take more. | measure on a larger sample of the corpus | maintainer of Monodi-Zero |
| 4 | neume-docs | The core module has no framework code; the dialog and the writing into the storage of neume-docs are not built. | build them in `apps/neume-docs` on top of `@monodi/core/datasets` | maintainer of neume-docs |
| 5 | Updates of the Cantus Corpus | The Cantus data is a snapshot (release 1.0), so the update check covers the Corpus Monodicum only. | add it when a second release is published | maintainer of the repository |
