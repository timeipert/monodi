# The Neume Viewer, from the inside

For agents working in **monodi-light** (Monodi-Zero). This describes the sibling
app that runs at **https://neume.monodi.app**, so you can reason about what it
reads, what it writes, and where the two apps touch. It is written from the Neume
Viewer's code as of October 2026; when in doubt, the code wins.

* Repository: `/Users/timeipert/Documents/Antigrav/cm-transkriptionseq`
  (GitHub: `timeipert/CM-Transcription-Equivalents`). Everything of interest is in `ui/`.
* Other docs there: `README.md` (what it does), `ARCHITECTURE.md` (how it is built).
  Paths below are relative to that repository.
* Stack: Vue 3 + Pinia + Vite, plain JavaScript (JSDoc types), no server. Like
  monodi-light it is local-first: the user's work lives in their browser.

## 1. What it is for

Monodi-Zero is where chant is **transcribed**. The Neume Viewer is where the
**graphical shapes** of neumes in the manuscript images are catalogued against
those transcriptions:

1. Read how often each neume pattern occurs in each source (statistics computed
   from the transcriptions by a Python script, shipped as static JSON).
2. For each source, give each pattern a stable **reference id** (an "equivalents"
   table: pattern → Ref-ID, plus notes).
3. Open the manuscript through its IIIF manifest, draw **line regions** on a page,
   and mark **snippets** (a neume's bounding polygon, tagged with a pattern and an
   optional variant letter) inside each line.
4. Publish the result as read-only "Notation Documentation" pages: a pattern
   table, line galleries, a neume table, and a static HTML/ZIP export.

It never edits transcriptions. It consumes them (via the static build) and exchanges
**source metadata, equivalents and annotations** with monodi-light.

## 2. Where its data comes from

### Static data (built, shipped in the app)

`scripts/analyze_transcriptions.py` reads a corpus of monodi transcriptions and
writes, into `ui/public/`:

* `index.json` — `{ stats, overallMax, glyphs, manifests, sourceFolios, sources }`
  * `stats`: pattern code → `{ count, length }` over the whole corpus
  * `manifests`: `{ "<source>": { url } }` IIIF manifest per source
  * `sourceFolios`: `{ "<source>": ["107v", "108r", …] }`
  * `sources`: the source ids, e.g. `"Aa 13"`
* `sources/<source>.json` — `{ "<pattern>": [ occurrence, … ] }`, where an
  occurrence is `[documentId, folio, line, syllable, pitch]`,
  e.g. `["Aa 13-113-7", "113r", "7", "Pa-", "G4"]`.

The app fetches these at runtime (`services/pipeline/adapters/legacyStaticAdapter.js`,
`services/metadata/metadataProvider.js`). Folio labels are normalised by the script
(`normalize_folio`, plain numbers get an `r`). **A "source" is identified by its
siglum string** (`Aa 13`, `Pa 1107`, `WiSch 4_5`) — the same string as monodi's
`quellensigle`.

### Pattern codes

A pattern is a short string describing a neume's note sequence, not a name:
`*` start note, `u`/`d`/`e` up/down/same-pitch step, uppercase letters are shapes or
custom signs (`L` liquescent, …), `[ … ]` marks graphically connected notes.
`*` is one note, `*u` two notes ascending, `[*u]` the same connected, `*uVd` three
notes with custom sign `V` on the middle one. Grammar and helpers:
`utils/patternCode.js`, `utils/signs.js`. A legacy pattern may carry a trailing
variant (`"*dd b"`); the current model keeps the variant in its own field.

## 3. What the user creates (the data model)

All of this is plain JSON, held in Pinia stores. Shapes (see `stores/*.js`):

```
regions      { "<source>_<folio>": [ { id, name, points, ommrLineId?, unassigned? } ] }
regionItems  { "<regionId>":      [ { id, pattern, points, variant?, linkData?, … } ] }
manualLines  { "<source>_<folio>": [ lineNumber, … ] }

personalTables  [ { id, name, source, notes, isPublished?, patterns: [code],
                    rows: [ { pattern, customId, notes? } ] } ]      // the equivalents
iiifLinks       { "<source>": "<manifest url>" }
settings        sourceMeta { "<source>": { fieldKey: value } }, sourceMetaFields,
                customSigns, codeVariants, snippetVariants, sourceAlignments,
                displayMode, … (the list is `PERSISTED_SETTINGS` in stores/settings.js)
patternLibrary  labels / notes / MEI templates per pattern
ommrSettings    calibrations, folioOffsets, indexModes (for OMMR4all imports)
directSnippets  hand-cut image snippets (carry base64 images; IndexedDB)
```

* **`points`** is an SVG-style string `"x,y x,y x,y …"` in **percent of the page
  image (0–100 on both axes)**, so it is independent of image resolution. This is
  the same convention as monodi-light's `AnnotationRegion.points` / `AnnotationItem.points`.
  Helpers: `utils/geometry.js`.
* A **region** is one line of the page (name like `"Line 3"`). A **snippet/item**
  always belongs to a region. Items reference their region by id only.
* **`unassigned`** regions are a holding pen: whole-page snippets from older builds
  that fitted no line were folded into one per page (`id` starting `r_unassigned_`).
  They are *not* manuscript lines. The bridge never sends them to monodi (§6).
* Ids come from `utils/id.js` (`newId('r')` → `r_<random>`); older data has
  `Date.now()`-style ids. Treat ids as opaque strings.
* **Folio** labels are strings (`"113r"`). Stored keys always use the **transcription's
  folio**, never an IIIF canvas label (`"fol. 18v"`, `"(0339)"`); older data keyed by a canvas
  label is moved onto folios automatically (`services/alignment/pageKeys.js`). A region may
  carry `canvas: { index, label }` — the scan it was drawn on (Viewer-only, not pushed). Matching canvases of a IIIF manifest to
  folios is non-trivial (`utils/folioAlignment.js`, `utils/folioMath.js`); per-source
  corrections live in `settings.sourceAlignments`.

### Composite keys, and the underscore trap

Page-level maps are keyed `"<source>_<folio>"`. Sigla can contain underscores
(`WiSch 4_5`); folios and pattern codes cannot. So a key is **always split from the
right** (`utils/keys.js`: `pageKey`, `parsePageKey`, `isPageKeyOf`). Never
`key.split('_')[0]` and never `key.startsWith(source + '_')`. If you ever read a
Viewer backup yourself, do the same.

## 4. Persistence and file formats

### In the browser

Each store implements `serialize()`, `hydrate(data)`, `reset()`. They are registered in
`services/persistence/storeRegistry.js`, which mirrors each one to its own
localStorage key (`globalSettings`, `annotations_v3`, `personalTables`, `iiifLinks`,
`patternLibrary_v1`, `ommrSettings_v1`; direct snippets in IndexedDB), tolerating
corrupt entries (kept as `<key>__corrupt`) and reading older key layouts. One change
signal per store (`services/persistence/changeTracker.js`) drives the mirror, the
folder autosave and the "back up your work" reminder.

### The workspace folder (File System Access API, Chromium)

The user can bind a local folder; the app autosaves into it:

* `workspace.json` — envelope `{ schemaVersion: 2, type, data: { … } }`
* `direct-snippets.json` — the image snippets, written separately because they are heavy
* safety copies it may leave: `workspace.backup-external.json` (replaced after being
  changed elsewhere), `workspace.pre-v<N>.json` (before an upgrade),
  `workspace.replaced-<time>.json` (displaced by choosing a folder)

It **never overwrites a file it cannot read or that was written by a newer version**;
saving switches off with a message instead (`services/persistence/workspaceStorage.js`).

### Exports (the formats that can reach you)

`services/persistence/workspaceSchema.js` owns the format. Envelope `type`:
`cm-workspace-backup` (everything), `cm-manuscript-export` (chosen manuscripts),
`cm-transcription-config` (settings only). **Schema version 2** =
`{ schemaVersion: 2, type, data: { settings, regions, regionItems, manualLines,
personalTables, iiifLinks, patternLibrary, ommrSettings, directSnippets } }`.
`migrate()` upgrades older files (version 1 had a legacy `annotations` map keyed
`Source_Folio_Pattern`, folded into regions on upgrade; the pre-schema
`{ version, content }` envelope is also accepted) and refuses newer ones.
If you write or read these files, go through that module's rules rather than copying shapes.

> monodi-light has its own workspace/export formats (`WORKSPACE_SCHEMA_VERSION`,
> the `sourceAnnotations` block in `document.component.ts`). They are separate;
> only the shared repository (§6) and the field names there are common ground.

## 5. IIIF handling

* One manifest URL per source (`iiifLinks`, seeded from `index.json`'s `manifests`).
* `services/iiif/manifestParser.js` normalises IIIF Presentation **v2 and v3** into a
  list of pages `[{ label, imgUrl, serviceUrl, w, h }]` (one per canvas label; a
  per-source label rule from `config/iiifRules.js` can map a library's label to the
  edition's folio, or one canvas to several folios); `manifestFetch.js` downloads with
  a timeout, retries and backoff (no retry on 401/403/404).
* `services/iiif/imageUrl.js` builds Image API URLs; snippets are cut with a
  percent region (`pct:x,y,w,h`) computed from the polygon's bounding box, so
  cropping needs no knowledge of pixel size.

## 6. The bridge to monodi

This is the contract that matters for monodi-light. Code: `services/sync/`
(`githubClient.js`, `monodiSchema.js`, `sharedDataChannel.js`), `services/pipeline/`
(adapters + normalised model), `stores/sharedSync.js`, `components/GithubSyncPanel.vue`.
UI: **Settings → Shared Sync (monodi.app)**. At the time of writing the bridge is new
and has not been tried against the real shared repository.

### What it does

* **Pull**: reads the shared GitHub repository, turns each `source` record into the
  Viewer's model (equivalents → personal table, regions/items, IIIF URL, catalogue
  metadata → `sourceMeta`) and applies it through the same import code as a backup
  import, with the **"merge" strategy** (see the rules below): a pull adds and updates, it
  never removes local work.
  **Documents** are also read, but only to feed the overview's
  filters (initium, feast, genre); they are not stored in the workspace.
* **Push**: converts the Viewer's workspace into monodi's source shape, merges it onto
  the records currently in the repository, and writes **only what changed** in **one
  commit**, in the layout the repository already has (see "Repository layout").
* **File exchange**: the same database as a single JSON file
  (`{ sources, documents, notes, settings }`), for use without a repository.
* The connection config is `{ token, owner, repo, branch }` under localStorage key
  `monodi_github_config` — the same key monodi-light uses. **localStorage is per
  origin and the apps live on different origins** (`monodi.app`, `neume.monodi.app`),
  so a connection made in one is *not* visible in the other; the user enters it in each
  (the two Viewer versions on `neume.monodi.app` do share it).
  The token is stored in plain localStorage in both apps.

### Field mapping (monodi `Source` ↔ Viewer)

| monodi source field | Viewer |
|---|---|
| `quellensigle` (else `id`) | source id (the key everywhere) |
| `herkunftsregion` `herkunftsort` `herkunftsinstitution` `ordenstradition` `quellentyp` `bibliotheksort` `bibliothek` `bibliothekssignatur` `datierung` `kommentar` | `sourceMeta[source]` keys `region place institution tradition type libraryPlace library shelfmark date comment` |
| `custom` (map) | extra `sourceMeta` keys |
| `iiifManifestUrl` | `iiifLinks[source]` |
| `equivalents[]` `{ pattern, refId, notes }` | one personal table per source: rows `{ pattern, customId: refId, notes }` |
| `annotationRegions[]` `{ id, name, points, folio, lineUUID? }` | `regions["<source>_<folio>"]` entries `{ id, name, points, lineUUID }` |
| `annotationItems[]` `{ id, regionId, pattern, variant?, points, uuid? }` | `regionItems[regionId]` entries |
| `documents[]` (`quelle_id`, `textinitium`, `festtag`, `gattung1`, …) | overview filter facets only |

These are exactly the `RootContainer` / `AnnotationRegion` / `AnnotationItem` /
`EquivalentMetadata` types in monodi-light's `src/app/types/model.ts`. **Those types and
the Viewer's `monodiSchema.js` have to change together.**

### Repository layout

Both layouts monodi-light has used are understood; a repository that has any
`manuscripts/<id>.json` is read as the current one, exactly as monodi-light does:

* **`manuscripts/<source.id>.json`** (current): `{ source, documents }`, compact JSON; the notes
  live in `manuscripts/<id>/notes-NNNN.json` chunks. The Viewer reads the bundles (never the
  chunks — it needs no notes), and on push rewrites a bundle only when its source changed,
  keeping the bundle's documents and any other property. `settings.json` and the chunks are
  never touched. A new source gets a new bundle `manuscripts/<id>.json` with `id = siglum`.
  An empty repository gets this layout.
* **`sources/`, `documents/`, `notes/`, `settings.json`** (older): read and written as before.

The file list GitHub returns can be truncated for a very large repository; the Viewer then
refuses to sync rather than work from a partial list.

### Rules the bridge follows

* The Viewer owns **equivalents, regions, items, IIIF URL and the metadata fields above**.
  On push it replaces the arrays on the monodi record with its own version, with three
  protections: an array the Viewer has **nothing for** is left as it is in the repository
  (a source known to the Viewer only by its IIIF link cannot wipe monodi-light's regions);
  regions with a **`lineUUID`** and items with a **`uuid`** that exist only in the repository
  are kept; and every other field of the record is kept (`...existing`).
* `lineUUID` (a region's link to a transcription line) and item `uuid` (link to a
  NonSpaced) are **created in monodi-light only**. The Viewer carries them through
  but never generates or edits them; items it creates have no `uuid`.
* Items drawn in the Viewer get a pattern and an optional `variant` letter. Viewer-only
  fields (`linkData`, `ommrLineId`, `unassigned`, snippet extras) are **dropped** on push
  (the repository record has no place for them) but **kept locally** on pull.
* Regions flagged `unassigned` and their items are **not pushed** (they are not lines).
  Several equivalents tables of one source are pushed as one list, without duplicates.
* **Neither direction deletes.** A push never removes anything in the repository; a pull
  never removes anything locally. A pull merges by id: regions and items present on both
  sides take the repository's values and keep Viewer-only fields (a missing value does not
  erase a local one), entries on one side only are kept, equivalents rows are merged by
  pattern, an existing local IIIF link is kept, and `sourceMeta` is merged key by key.
  (Consequence: something deleted on one side comes back from the other.)
* The push is never forced: if someone else pushed in between, GitHub refuses it and the
  Viewer shows the error. If the repository cannot be read, nothing is pushed.
* Sources are matched by `quellensigle || id`.

### ⚠ Known gaps (read before changing either side)

1. **No conflict detection per source.** There is no record of what was last synced, so
   edits made on both sides to the same region/item between syncs resolve as "the pulled/pushed
   side wins for shared fields", not as a conflict.
2. **Deletions do not propagate** (see above); cleaning up a source means doing it on both sides.
3. **The shared repository format has no version field.** Keep changes to it additive.
4. **Notes are not synchronised by the Viewer at all**; it neither reads nor writes them.

## 7. How the Viewer is built (enough to navigate it)

```
views/ components/            Vue SFCs (views/settings/*, views/ommr/* are split screens)
composables/                  shared behaviour (useDataManagement, useManagerWorkspace, ommr/*, …)
stores/                       Pinia: annotations, personalTables, settings, iiif, patternLibrary,
                              ommrSettings, directSnippets, saveReminder, sharedSync
services/persistence/         schema + migrations, store registry, change tracker, workspace folder
services/iiif/ services/ommr/ IIIF URL/manifest logic; OMMR4all export import
services/pipeline/ sync/ metadata/   the monodi bridge and its adapters (§6)
utils/                        keys, ids, geometry, pattern codes, folio math (pure, tested)
```

Routes (all lazy): `/` overview, `/equivalents`, `/annotations/:id?`, `/polygons`,
`/ommr` (OMMR4all import), `/patterns` (pattern library, MEI templates),
`/custom-manuscripts`, `/settings`, `/setup`, and the public read-only
`/public`, `/public/table`, `/public/:source`, `/public/custom/:source`.

* **Adding a setting**: one line in `PERSISTED_SETTINGS`; it is then saved, exported,
  imported and migrated. **Changing a stored shape**: bump `SCHEMA_VERSION` in
  `workspaceSchema.js`, add an upgrade step (non-mutating) and a fixture test.
  (`ARCHITECTURE.md` has the full checklist.)
* **The pipeline**: every input format has an adapter (`services/pipeline/adapters/`) that
  produces a `NormalizedDataset` (`normalizedModel.js`): sources with metadata, IIIF URL,
  equivalents, regions, items, documents. `toWorkspaceState()` projects it onto the stores.
  Add a new input format by adding an adapter; do not special-case it in a store.
* **OMMR4all**: an exported OMMR4all project folder can be imported
  (`services/ommr/folderImport.js`); its line boxes become regions and its neumes snippets.

## 8. Running and changing it

```bash
cd /Users/timeipert/Documents/Antigrav/cm-transkriptionseq/ui
npm install
npm run dev          # http://localhost:5173
npm test             # vitest (≈430 tests: persistence, stores, schema migrations, bridge)
npm run lint         # eslint
npm run typecheck    # tsc over the core modules
npm run build        # writes ../docs (gitignored) and verifies nothing from public/ is missing
```

* Deployment: GitHub Actions lints, tests, builds `ui/` and publishes it to GitHub Pages at
  `neume.monodi.app` (`.github/workflows/pages.yml`); the built site is not committed. The
  app it replaced is tagged `legacy-site-2026-10-04`; its saved data is read by the current app.
* The static data (`ui/public/index.json`, `sources/`) comes from
  `python scripts/analyze_transcriptions.py` over a corpus export; it is committed.

### Working agreements

* **Language**: English for UI strings, docs and replies.
* **One place per function**: each function in the UI has one entry point; settings live
  in the Settings view, not scattered. (One known exception: `discriminateSigns`.)
* **The user's work is the one thing that must not be lost.** Persistence code is held to
  a higher standard than the rest: validate what is read, never overwrite what cannot be
  read, add a test for every format change.
* When you change anything that crosses the bridge (§6) — a field on `Source`,
  `AnnotationRegion`, `AnnotationItem`, `EquivalentMetadata`, or the repository layout —
  tell the user it needs a matching change in the Neume Viewer's `services/sync/`
  and `services/pipeline/`, and the reverse.
