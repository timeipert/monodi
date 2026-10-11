# Monodi-Zero ⇄ Neumen-Editor — one workflow, two apps

Status: **plan, revision 3** (2026-10-04). Decisions taken: file exchange first, Monodi owns the
catalogue, the old Viewer is retired. **Phase 1 is built on both sides**: the Editor (branch `monodi-exchange` in
`cm-neumen-editor`) writes and reads the exchange file, Monodi imports it (Settings → Workspace →
*Import annotations*). Both uncommitted. **Phase 2 is built**: "Show in manuscript" in Monodi and the linking assistant in the Editor, so level A
(exact snippet) no longer depends on linking by hand.
Revision 1 was written against the wrong app (the published *Neume Viewer*); this one is
based on `cm-neumen-editor`. Where something is inferred rather than read in code it is
marked **(verify)**.

**The three apps**

| | repo | what it is | sync with Monodi today |
|---|---|---|---|
| **Monodi-Zero** | `monodi-light` | transcription editor (Angular) | — |
| **Neumen-Editor** | `cm-neumen-editor` | **new, unpublished** successor of the Viewer; the annotation tool going forward. Starts empty, loads a corpus from files, local-first, nothing leaves the browser | **none** (file import only, one way) |
| Neume Viewer | `cm-transkriptionseq` | published predecessor (`neume.monodi.app`) | an uncommitted GitHub bridge — **source to port from**, then retire |

[NEUME-VIEWER-INTERNALS.md](NEUME-VIEWER-INTERNALS.md) describes the *old* Viewer. Its field
model and bridge are the starting point; the Editor needs its own equivalent doc once built.

---

## 1. The workflow we are designing for

```
 MONODI-ZERO                              NEUMEN-EDITOR
 ───────────                              ─────────────
 1 catalogue sources, IIIF URL
 2 transcribe                  ──load──►  3 neume table: which patterns, which Ref-IDs
                                          4 page images: draw lines, mark snippets
                                          5 link snippets to the transcription (uuid)
 6 import annotations         ◄──send───
 7 transcribe more             ──update─►  8 refine; new / changed patterns appear
 9 PAYOFF: right-click a neume in the transcription → see it in the manuscript
```

A **loop**, so the design goal is a cheap hop: *update from Monodi* and *send to Monodi* are
each one gesture and lose nothing.

---

## 2. What I found

The Editor is a good base: it derives everything from the loaded corpus, keeps annotations
in a workspace separate from the corpus (re-importing a source replaces it by name and
leaves annotations alone — they are keyed `source_folio`), has a project-folder autosave,
restore points and a tested pure core. What is missing is the *return path* and the details
below.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **E1** | **No way back to Monodi.** Exports are the Editor's own workspace shapes (`neumen-editor-backup`, `cm-manuscript-export`); nothing writes Monodi's `Source` fields and Monodi can't import them. | `composables/useDataManagement.js`; no sync code in `ui/src`. | The loop is open: annotations can't reach the transcription. |
| **E2** | **The reader throws away what Monodi already knows about annotations.** It keeps plain-valued source fields only (`pickSourceFields` skips objects), so `annotationRegions`, `annotationItems`, `equivalents` are dropped; occurrences are `[documentId, folio, line, syllable, notes]` — **no note `uuid`, no line `uuid`**. | `services/corpus/corpusReader.js`, `analysis.js`. | Existing Monodi annotations don't show up, and nothing can be linked to a note. |
| **E3** | **Page identity differs three ways.** Editor: the transcription's normalised folio (`"113r"`); page images come from a manifest, *or* from documents' `iiifs` image addresses (no canvas at all), *or* local scans. Monodi: **canvas index** (`"7"`). | Editor `stores/iiif.js`, `services/corpus/iiif.js`; Monodi `iiif-viewer.component.ts` (`folio: String(currentCanvasIndex)`). | A region drawn on one side lands on the wrong page, or none, on the other. |
| **E4** | **Folio drift.** If a transcriber corrects a folio in Monodi, updating the source silently orphans the annotations of the old folio key. | `stores/annotations.js` keys; `analysis.js` folio markers. | "Update from Monodi" must detect and re-home, not just replace. |
| **E5** | **Updating one manuscript is heavy by file**: re-drop and re-read files (the full CM takes ~15 s, but you want *one* source). | `corpusImport.js`, `corpusReader.js`. | Needs a per-source update. |
| **E6** | **Conflicts are per whole `Source` record in Monodi; deletes don't propagate; the Editor has no stamps.** | Monodi `app.component.ts` (`_.isEqual` on source); Editor stores have no `updatedAt`. | The same trouble as soon as annotations travel both ways. |
| **E7** | **Metadata is an overlay** (`manuscriptMeta` over the corpus) and never written back. | `stores/manuscriptMeta.js`. | Good: Monodi owns catalogue fields. Only the IIIF link needs a way back. |
| **E8** | **No format version** on any exchanged file or the repo. | — | Either side can write what the other can't read. |
| **E9** | Monodi's own "Show in manuscript" is half-built: `ManuscriptLinePopupComponent` is declared but used in no template, with a guessed image URL. | `notationsdokumentation.module.ts` | The payoff needs building (Monodi side). |

| **E10** | **Monodi's in-app analyzer and the Editor differ in unit.** Monodi's `analyzeDocument` (`transcription-analyzer-core.ts`) emits one pattern per ligature *group*; the Editor (like the old Python pipeline) one per whole *neume* (`[*u]dd` is one occurrence there, several in Monodi). | read in both `analysis.js` / `transcription-analyzer-core.ts` | Monodi's link-candidate list and the Editor's items don't line up by pattern. For "Show in manuscript" use `extractPattern` on the whole `NonSpaced` (Monodi has it), not the analyzer. |
| **E11** | **Snippets already link to occurrences** in the Editor: `linkData.sysId` = `[documentId, folio, line, syllable, notes].join('\|')`. | `ManagerWorkspace.vue:172` | Nothing had to be invented: with the first-note `uuid` kept beside each occurrence, existing links export as `uuid` (this also means the occurrence arrays must keep exactly five fields). |

**Good news:** the pattern suffix grammar already agrees (the *unit* does not — E10). The Editor's `analysis.js` and Monodi's
`extractPattern` use the same suffixes (`O Q S LA LD L`), and the Editor was checked against
the old pipeline record for record. A shared fixture still guards it (§4.9).

---

## 3. Principles

1. **File exchange first, GitHub second.** Both carry the *same* payload and use the *same*
   merge function; files need no token and no origin tricks, and fit the Editor's "nothing
   leaves the browser" stance.
2. **Merge by id, not by record**, with one owner per field (§4.2).
3. **Everything additive** in shared formats, and every shared format gets a version.
4. **Degrade gracefully:** "Show in manuscript" works at three precision levels.
5. **The Editor is the annotation tool.** Monodi's annotate tab is **frozen** (bug fixes
   only). The Editor is unpublished, so its data model can still change freely — now is the
   cheapest moment to add ids, stamps and versions.
6. The user's work must not be lost: use the Editor's restore points before any
   "update from Monodi".

---

## 4. Design pieces

### 4.1 Identity of a page (E3, E4)

A region says where it is in several ways; readers try them in this order:

| field | meaning |
|---|---|
| `canvasId` | IIIF canvas id (manifest-based pages): exact, reorder-proof |
| `imageId` | **IIIF Image API base** of the page's image. Exists for manifest *and* document-`iiifs` pages, so it is the one reference that works in every case |
| `folioLabel` | the transcription's normalised folio, `"113r"`: the Editor's key |
| `folio` | legacy: Monodi's canvas index (kept so existing data keeps working) |

Editor: stamp `folioLabel` + `imageId` (+ `canvasId` when it has one) on every region; write
`folio = String(canvasIndex)` only when it knows the manifest index. Monodi: the resolver
already does `canvasId → folioLabel → folio` (§5); add `imageId` (match a canvas' image
service id). **Drift check** in the Editor: after an update, any page key not in the
source's new folio list is reported; if its regions carry `imageId`/`canvasId`, they are
offered a new home — the folio that now shows that image.

### 4.2 Ownership and merge (E6)

| data | edited by | rule |
|---|---|---|
| Catalogue fields | **Monodi** | the Editor shows them (its overlay stays local) and sends none |
| `iiifManifestUrl` | either | set-once; non-empty wins |
| `equivalents` | Editor (Monodi's overview can too) | merge by `pattern`, per-row `updatedAt` |
| `annotationRegions`, `annotationItems` | **Editor** | union by id; per-object last-writer-wins on `updatedAt`; tombstones for deletes |
| `lineUUID`, item `uuid` | **Editor sets them; the ids are Monodi's** | the Editor reads note/line uuids from the corpus (§4.3), so it can link; Monodi needs no linking UI |
| `transcriptionAnnotations`, documents, notes | **Monodi** | untouched by the Editor |

Add `updatedAt` and `deleted` to regions, items and equivalent rows in the Editor's stores
now. One pure `mergeAnnotations(local, remote)` written twice (TS in Monodi, JS in the
Editor), driven by the same golden fixtures (§4.9). Monodi's `sync()` merges these fields
*before* its `_.isEqual(local, bundle.source)` test, so annotation changes stop being
"Source conflicts".

### 4.3 The reader keeps `uuid`s and existing annotations (E2)

Extend `corpusReader` / `analysis` so that
* every occurrence carries the NonSpaced `uuid` and its line's `uuid`
  (`[documentId, folio, line, syllable, notes, noteUuid, lineUuid]` — appended, so existing
  positions keep their index),
* a source's existing `annotationRegions`, `annotationItems`, `equivalents` and
  `iiifManifestUrl` are read into the import and offered ("found in this file — merge into
  your workspace?"), never silently overwriting what the user drew.

### 4.4 Transport (E1, E5)

1. **File, both directions — ships first.**
   * Monodi → Editor: what already works (`.monodijson`, or a single-source bundle
     `{source, documents, notes}`). Add **per-source update** in the Editor ("Update
     *Aa 13* from file"): replace the source, keep the workspace, run the drift check.
   * Editor → Monodi: a new **annotation exchange file**
     `{ "format": "cm-annotation-exchange", "version": 1, "sources": [{ id, quellensigle,
     iiifManifestUrl, equivalents[], annotationRegions[], annotationItems[] }] }`.
     Monodi gets **"Import annotations"** (source page and sources overview) with
     merge-by-id and a preview ("14 new snippets, 2 updated, 0 conflicts").
2. **GitHub — port from the Viewer** (`services/sync/*`, `services/pipeline/*`): incremental
   pull (only manuscripts whose blob sha changed, straight into the Editor's per-source
   store) and push of only the annotation fields into `manuscripts/<id>.json`. Same
   payload, same merge as the file route. A "connection code" button in Monodi avoids typing
   the token twice (the origins differ).
3. **Shared folder** (the Editor can bind a project folder; Monodi has
   `file-system.service.ts`): optional, later.

### 4.5 Deep links — the hop

Query parameters only; routes confirmed against each router **(verify)**:
* Monodi → Editor: `…/#/polygons?source=<sigle>&folio=<label>&line=<lineUuid>` ("Open in
  Neumen-Editor" on a line, a source, a pattern).
* Editor → Monodi: `…/document/<docId>?line=<lineUuid>&note=<noteUuid>`.

With files there is nothing to sync on arrival; with GitHub each hop starts with a pull.

### 4.6 Where-am-I chips (both apps)

Per manuscript: `IIIF ✓` · `12 chants` · `41 patterns` · `33/41 have a Ref-ID` · `8 lines` ·
`212 snippets` · `120 linked` · `3 drifted` — each clickable to the next action.

### 4.7 The payoff: "Show in manuscript" (E9) — Monodi side

Right-click a neume (Monodi's `context-menu` service); three levels, best available wins:

| level | needs | shows |
|---|---|---|
| **A exact** | item with `uuid` = this note | crop of that snippet, outlined, with its line |
| **B line** | region with `lineUUID` = this line | crop of the line |
| **C pattern** | equivalents row for this note's pattern | gallery of snippets of that pattern/Ref-ID ("Ref 12a, ×14") |

Rebuild `ManuscriptLinePopupComponent` on the existing `AnnotationCutoutComponent`; crop with
the IIIF Image API `pct:` region (the Editor's `snippetImages` is the reference — port the
few lines). Mirror in the Editor: snippet → "Open transcription". Level C works as soon as
equivalents and regions are imported, so the payoff is visible early.

### 4.8 Linking assistant and drift check — in the Editor

Because the Editor holds the notes and their `uuid`s (§4.3):
* **Auto-link lines:** per folio, regions ↔ transcription lines by order/name → propose.
* **Auto-link snippets:** inside a linked region, sort snippets left→right and align them
  with the line's neumes by pattern → suggested `uuid`s; mismatches flagged.
* **Pattern drift:** after an update, a linked snippet whose stored pattern no longer
  equals its note's pattern is listed with *update pattern* / *unlink*.

### 4.9 Contract kit (E8)

* `format` + `version` in the exchange file; a root `meta.json` in the repo for the GitHub route.
* `INTEGRATION-CONTRACT.md` + JSON Schema + `fixtures/` (empty, regions only, linked items,
  tombstones, sigle with underscore, sigle as array, reordered manifest, index-only region,
  note sequences → pattern codes), vendored into both repos and run by both test suites.

### 4.10 Optional: a drawing tool for staff lines and neume components

Monodi's frozen tab has one (`transcriptionAnnotations`: line, note, clefs, accidentals,
neume start). If wanted, build it in the Editor as a separate layer in the page-image view,
stored in its own additive field. Not on the critical path.

---

## 5. Phases

| Phase | Goal | Contains | Done when | Size |
|---|---|---|---|---|
| **0 — agree** | same meaning of "page" | §4.1 fields on both sides; §4.9 fixtures + round-trip tests | a region drawn in the Editor, exported, imported in Monodi, shows on the right page | S–M |
| **1 — file loop** | the whole workflow with drag & drop | §4.3 reader keeps uuids/annotations; per-source update + drift check in the Editor; exchange-file export; Monodi "Import annotations" with merge-by-id | transcribe → load → annotate → send → import → transcribe more → update, nothing lost | M–L |
| **2 — payoff** | the feature you asked for | §4.7 Show in manuscript (A–C); §4.8 linking assistant + drift | right-click a neume → crop of the sign | M–L |
| **3 — GitHub** | no more files | port the bridge; `updatedAt`/tombstones; Monodi merges annotations before its conflict test; connection code; deep links; chips | two people can work at once without manual conflicts | M |
| **4 — optional** | polish | §4.10 drawing tool; shared folder; same-origin hosting | — | L |

### Phase 0 progress

**Monodi side — done (uncommitted; 19 specs green):** `AnnotationRegion` has `canvasId?` /
`folioLabel?` ([model.ts](src/app/types/model.ts)); the pure resolver
[region-page.ts](src/app/notationsdokumentation/region-page.ts) places a region by
`canvasId → folioLabel → legacy folio` (so `"113r"` is no longer read as canvas 113), with
[a spec](src/app/notationsdokumentation/region-page.spec.ts); the frozen annotate tab uses it
for lookups, stamps regions it creates, and backfills `canvasId` on older regions (never
rewriting `folio`/`folioLabel`). Still to add: `imageId` matching. The gallery view and the
unused line popup still use `parseInt(folio)`; they are rebuilt in Phase 2.

**Editor side — built and exercised (branch `monodi-exchange`, uncommitted, 417 tests green):**

| piece | where |
|---|---|
| Reader keeps each occurrence's first-note `uuid` (parallel array, so `sysId` links are unaffected) and the `LineChange` uuid that ends each line | `services/corpus/analysis.js`, `corpusReader.js`, `corpusStore.js` |
| Reader keeps annotations already on a source (`annotationRegions/Items`, `equivalents`) instead of dropping them | `corpusReader.js` |
| Manifest pages carry `canvasId` / `canvasIndex` | `stores/iiif.js` |
| Pure exchange module: build the file, plan an import, drift check | `services/exchange/annotationExchange.js` (25 tests) |
| *Workspace → Exchange with Monodi-Zero*: send file / take annotations back, with a preview dialog and a restore point + Undo | `MonodiExchangePanel.vue`, `MonodiExchangeDialog.vue`, `useMonodiExchange.js` |
| *Corpus* page after an update: "came with annotations — review", and folio drift with "Move to 121r" | `CorpusFollowUp.vue`, `useCorpusImport.js` |

Walked through in the running app with a fixture: load a Monodi file that carries annotations →
review → add (region placed on `AugW 13_119r`, snippet keeps its `uuid`) → a snippet made the Editor's
way, linked by `sysId`, exports with the right note `uuid` → re-import with shifted folios flags the
page and moves it, with Undo. A region Monodi numbered only by canvas index is held back with
an instruction to link the manifest, never guessed.

**Not done on the Editor side:** `imageId` is sent but regions are not yet stamped with it at
creation (it is computed at export from the page list, so local scans have none); the linking
*assistant* (§4.8) — only links the person already made are exported, plus a region's
`lineUUID` when all its linked snippets lie on one line; `updatedAt`/tombstones (Phase 3).

**Monodi side of Phase 1 — done (uncommitted; full suite 332 specs green):**

| piece | where |
|---|---|
| Analyzer counts **one pattern per neume** (resolves E10); `firstNoteUuid`; `ANALYZER_VERSION = 2` so cached pattern stats from the per-group analyzer are recomputed; a note's pattern in the context menu is its whole neume's | `transcription-analyzer-core.ts`, `notes.component.ts`, `stats.component.ts`, spec |
| `imageId` on `AnnotationRegion`; resolver order is now `canvasId → imageId → folioLabel → folio` | `types/model.ts`, `region-page.ts` + spec |
| Pure merge module: parse `cm-annotation-exchange`, match sources by id then siglum, plan a merge by id (Editor's values win for geometry/names/patterns/Ref-IDs; Monodi's `lineUUID`/`uuid` never blanked; nothing deleted; items without a region dropped and counted) | `annotation-exchange.ts` + spec (24 cases) |
| *Settings → Workspace → Import annotations* opens the Sources page, picks a file, shows per-manuscript what would be added, writes through `updateSource` (which marks the manuscript for the next push) | `settings.component.html`, `sources-overview.component.{ts,html}` |

Walked through in the running app: plain workspace → import the file the Editor wrote earlier → dialog
"1 new line region, 2 new snippets, 1 new table row" and "Zz 9 not in this workspace" → stored
region (with `folioLabel`, `lineUUID`), both snippets with their note `uuid`, the table row; the same
file again says "Nothing new" and disables *Import*.

**"Show in manuscript" — built (Phase 2, Monodi side; uncommitted; full suite 356 specs green):**
right-click a note → *Show in manuscript* (only offered when the source has annotations).

| piece | where |
|---|---|
| Pure lookup: the neume of a note (pattern, every note uuid), the line it stands on (the `LineChange` that ends it), level **A exact** (a snippet whose `uuid` is *any* note of the neume — covers the old per-group links), **B line** (`lineUUID`), **C examples** of the same pattern (always listed beside A/B, capped, with the true total) | `manuscript-lookup.ts` + spec |
| Crop maths: bounds, padding, IIIF `pct:` request, polygon → crop space, CSS fallback for pages with no image service | `iiif-crop.ts` + spec |
| Which image a region sits on (own `imageId` — works with no manifest — else its canvas) and a readable page label | `region-page.ts` (`pageImageOf`, `pageLabelOf`) + spec |
| Service: the document view lends it the source and transcription; manifest fetched once and cached | `manuscript-view.service.ts` |
| Overlay: line crop with the sign outlined, a close-up, a Ref-ID badge with the equivalents note, example thumbnails; Esc closes | `notationsdokumentation/manuscript-view/` |
| The unused, mis-built `ManuscriptLinePopupComponent` is removed | module |

Tried in the running app against a local IIIF server (real `pct:` crops) and a manifest with one
canvas with an image service and one without: level A (the sign outlined in its line, close-up,
Ref-ID 12), level B ("This line", the line's own snippet now listed as an example), examples from
both kinds of page, and the "not linked yet / nothing marked yet" message. A bug found that way and
fixed: a server may return an image smaller than its frame, which pushed the outline off the sign —
the picture now always fills its frame.

**Not done:** the mirror in the Neumen-Editor (snippet → *Open transcription*); level C also on the
Stats/Equivalents views ("how does this sign look?"); a user-manual page.

**Linking assistant — built in the Editor (§4.8; branch `monodi-exchange`, uncommitted; 447 Editor tests green):**
*Workspace → Exchange with Monodi-Zero → Find links…*

| piece | where |
|---|---|
| The reader numbers the neumes in reading order (`noteOrder`, parallel to the occurrences), so a transcription line can be rebuilt; sources imported earlier must be loaded again | `corpusReader.js`, `corpusStore.js` (`loadNoteOrder`) |
| Pure logic: per line, the neumes in order; snippets sorted left→right aligned with them by pattern (matches first, then how well positions agree — a plain note repeats often); the line is taken from snippets already linked, else the best fit on the page, else the region's name; a line is given to one region only; confidence high / medium / low; clefs and custodes ignored | `services/exchange/linkAssistant.js` (27 cases) |
| Apply: sets `linkData.sysId` (the link the Editor always used) and the region's `lineUUID`; never replaces an existing link; snippets are addressed by **position** in the region with the id as a safeguard | same |
| Review dialog (ticked by default: high and medium), restore point + Undo | `LinkAssistantDialog.vue`, `useLinkAssistant.js` |
| New region and snippet ids are unique (they were `Date.now()`, so two made in one millisecond shared an id) | `stores/annotations.js` |

Tried in the running app on real neumes of the fixture: a region of 7 snippets + 1 bogus one (proposed
*low*, the 7 right ones linked to the right syllables, the bogus one left alone), a region drawn on
every second neume of a 14-neume line (*high*, positions agreeing), a region with no snippets (by name,
*low*); applying put the right `sysId` on each snippet and `lineUUID` on the lines that have an ending
marker, and the exported file then carried 14 of 15 snippets with their note `uuid`. Bug found that way:
matching snippets by id failed when two shared one — now by position, with a test for it.

**Limits:** an existing link is trusted as certain; a region that straddles two transcription lines
(or two regions for one line) is not handled — it falls to low confidence or is reported as unmatched;
the assistant never deletes or corrects a link a person made.

**Round trip is closed** (file in both directions). Not yet: deletions (a record removed on one side
returns from the other — tombstones are Phase 3), a restore point on the Monodi side (the dialog tells
the person to export a backup first), `imageId` stamping in Monodi's own tab (it stamps `canvasId` +
`folioLabel`).

**Watch out in Phase 2:** items Monodi's old per-group link list created carry a *group's* first-note
uuid and a group pattern. Look a note up against an item by *any* note uuid of its neume, not only the
first.

**Neume Viewer — nothing changed**, and it won't be (retired).

---

## 6. Risks / to verify

* **Does every Editor page have an `imageId`?** Manifest pages carry `serviceUrl`;
  document-`iiifs` pages store the image base; local scans (`public/scans`) have none —
  those regions fall back to `folioLabel` only **(verify)**.
* **Monodi push pruning:** a new repo file (`meta.json`) must be in `expectedPaths`, or a
  push may delete it **(verify)**.
* **Source identity:** both match by sigle/id; a renamed or array-valued `quellensigle`
  breaks the match. Carry Monodi's stable `id` in the exchange file and match on it first.
* **Cropping needs CORS-friendly image services**; fall back to the polygon over the full page.
* **Volume:** thousands of snippets per source — index by `uuid`/`regionId`, don't scan.
* **Token storage** (Phase 3) is plain `localStorage` in the old apps; keep the Editor's
  "nothing leaves the browser" promise explicit when GitHub is added.
* **Unpublished ≠ no data:** if Editor workspaces already exist on your machine, any change to
  its stores still needs a migration (it has `workspaceSnapshot` and restore points to lean on).

---

## 7. Decisions

**Taken:** file exchange first (GitHub in Phase 3) · Monodi owns catalogue fields; the Editor
sends only the IIIF link · the old Neume Viewer is retired (its bridge is ported in Phase 3, then it
is frozen) · the Editor is the annotation tool, Monodi's annotate tab is frozen.

Also taken: **E10** — Monodi's analyzer now counts one pattern per neume, like the Editor.

**Still open:**
1. **Optional line / neume-component drawing tool (§4.10):** wanted, and when?
2. **Where will the Editor be published** (its own domain?) — decides whether a connection code
   or same-origin hosting is worth doing in Phase 3.
3. **Next:** the mirror (*Open transcription* from a snippet in the Editor), the equivalents/stats
   "how does this sign look?" view in Monodi, or Phase 3 (GitHub transport, tombstones)?
