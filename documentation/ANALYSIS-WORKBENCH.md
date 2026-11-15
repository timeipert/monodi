# Analysis workbench

State: 2026-11-15. Baseline: Monodi-Zero 0.9.1 with the workbench (merged as pull request 65) and the figure work of branch `monodi/feat/analysis-figures` (section 3c).

**What it is for.** The page *Analysis* (`#/analysis`; the menu entry *Analysis* also leads to the notation statistics, `#/stats`, which share its tab bar, see `src/app/analysis-tabs.component.ts`) lets a scholar choose a set of chants, tick the analysis methods to run on it, run them without freezing the page, and keep the outcome as a named *analysis* that is opened again later without computing anything. It also holds the selection tools shared by the search, source and statistics pages and the methods of the ChantDigger program (Max Haas, 2014) rebuilt for this editor.

**Who it is for.** Researchers working with the transcriptions of Monodi-Zero (musicologists, text philologists) and the people who maintain the code. The user guide is the manual page *Analysis & Statistics* in the application (`src/app/manual/pages/analysis/`); this file is the technical description.

**Where to start.**
- Use: open the search page, select documents or run a search, press **Analysis…**, tick methods, press **Run ticked methods**.
- Code: [`packages/core/src/analysis/`](../../../packages/core/src/analysis/) (the methods, no framework), [`src/app/analysis/`](../src/app/analysis/) (page, store, worker, runner), [`src/app/selection/`](../src/app/selection/) (selection tools).
- The authoritative list of methods is [`registry.ts`](../../../packages/core/src/analysis/registry.ts); the authoritative description of what a stored result is, is [`analysis-types.ts`](../src/app/analysis/analysis-types.ts).

## 1. Terms

| Term | Meaning |
|---|---|
| Source, document | A manuscript, and one transcribed chant in it (Monodi-Zero data model). |
| Corpus | The documents of one analysis: a fixed, sorted list of document ids. |
| Syllable segment | The notes sung on one syllable. ChantDigger calls it *Silbenstrecke*; every distinct segment of a corpus gets an id and a count. |
| Diatonic index | A pitch as `octave * 7 + step` (C = 0 … B = 6 within the octave of the Monodi data model). A difference of two indexes is a number of scale steps. |
| Fingerprint | A short content hash that tells whether the documents a result was computed from are unchanged (section 5). |
| Method | One analysis (n-gram frequencies, keyness …), a pure function from a corpus and parameters to a result. |
| View | A table, bar chart, matrix, dendrogram (tree of clusters), scatter plot or text block that a result consists of. |

## 2. The reading rule

Every method reads a document through one function, `extractFeatures` ([`features.ts`](../../../packages/core/src/analysis/features.ts)): only the first voice is read (a second voice, `additionalMelodies`, is ignored), latent notes (implied but not written) are skipped, and an accidental (flat, sharp, natural) is not a note of the melody: it is counted in `accidentals` and skipped. B and B-flat are therefore not told apart (the data model does not say which note an accidental affects; the MEI export treats accidentals the same way). Every syllable is kept, also one without notes.

The melody search, formula analysis and notation statistics of the search page read notes in their own way (accidentals count as notes there), so results of the workbench differ slightly from them on chants that contain accidentals. The search keeps its reading so that its results do not change.

## 3. Methods

State of the catalogue: 12 methods, all implemented in core with tests (2026-11-15). Cost: fast = well under a second for 1,000 chants; the benchmark ([`bench.ts`](../../../packages/core/src/analysis/bench.ts), synthetic corpus of 22,000 chants with 4.3 million notes, Node) gave 0.03 to 8.3 s per method, `variants` (8.3 s) and `models` (4.8 s) being the slowest.

| Id | Question | Reads | Field |
|---|---|---|---|
| `overview` | What does the corpus look like? Pitch, interval, notes per syllable, chant length, words, one row per group. | melody, text, meta | descriptive |
| `tonal-profile` | Which range, final, tenor and mode? Mode estimate 1–8 from the last note, the position of the melody relative to it and the most frequent note; compared with a stored `custom.mode`. | melody, meta | computational musicology |
| `variants` | How much do witnesses of the same chant differ? Normalised edit distance of interval sequences per group (default: text incipit; Cantus ID where the corpus has one). | melody, meta | text-critical |
| `ngrams` | Which patterns recur, and where? Counts of n consecutive intervals, pitches, contour steps or words (n as a range, optionally only inside one syllable, neume or word), with the number of chants and the distribution over a field. | melody, text, meta | corpus linguistics |
| `keyness` | What is typical of one group against the rest? Log-likelihood (G2) and log ratio (Dunning 1993; Rayson and Garside 2000; Hardie 2014). G2 values are a ranking, not proof: many items are tested without correction. | melody, text, meta | corpus linguistics |
| `collocations` | Which units attract each other? log-Dice (Rychly 2008), pointwise mutual information and t-score of pitch or word pairs in a window. | melody, text | corpus linguistics |
| `source-distance` | Which sources are close? Burrows' Delta (2002), cosine or Jaccard distance on the most frequent n-grams; average-linkage dendrogram, two-dimensional map, nearest neighbours; the matrix as CSV. | melody, text, meta | stylometry |
| `segments` | Which segments are shared or similar? Segment index (cut by syllable, neume, word or groups of n notes) with counts and distribution, the four ChantDigger similarity criteria, search for a sequence of segment ids. | melody, text, meta | ChantDigger SM2 |
| `bridges` | Which fixed segments frame a varying melisma? Triples before / nucleus / after, grouped by (before, after) with several nuclei. | melody, text | ChantDigger SM4 |
| `models` | Do several chants share a melodic model? Sets of long segments (any cut) shared by at least k chants inside a group. | melody, text, meta | ChantDigger models |
| `syllable-groups` | Do chants of equal syllable count share a model? Groups and a syllable table. | text, meta | ChantDigger SM5 |
| `axis` | Which chants are built around the same notes? The N most frequent notes of each chant (N ≤ 5), chants grouped by axis. | melody, meta | ChantDigger "find axis" |

**Not chosen, with reason.** Krumhansl-Schmuckler key finding (built for tonal music, not for modes); topic models and embeddings (need large or labelled data, results are hard to cite); computing a stemma (specialist programs exist; the distance matrix is exported as CSV and NEXUS for them); the melodic formula grouping (stays on the search page).

**Grouping fields.** Methods that split the corpus offer the source and document metadata fields and every `custom.*` key found in the corpus (the Cantus Corpus import fills `custom.cantus_id` and `custom.mode`).

**Not a finding.** Results are an aid to reading. ChantDigger's own guided tour states it: "Every result needs scholarly interpretation". The page repeats this under the results.

## 3-. Segments, pattern length and leaving things out

**What a segment is.** The segment methods (`segments`, `bridges`, `models`) first cut every chant into *segments* and then count the distinct ones. ChantDigger cuts by syllable only. The parameter *A segment is* offers four cuts ([`segmentation.ts`](../../../packages/core/src/analysis/segmentation.ts)):

| Cut | A segment is | Useful for |
|---|---|---|
| Syllable (ChantDigger) | the notes on one syllable | text-bound melodic units, melismas of a syllable |
| Neume | the notes written without a gap (one `spaced` element of the editor) | the unit of the neume tables, independent of the text |
| Word | the notes over all syllables of one word | word-bound formulas and long melismas across syllables |
| Groups of n notes | n notes one after the other (the last group may be shorter) | a fixed-size view that ignores text and neumes |

Equal note sequences are one segment whatever cut produced them. Neume and word boundaries are part of the features (`neumeStart`, `wordStart`, `wordEnd`) and of the melody digest.

**What a bridge is.** Three consecutive segments are called Before (B), Nucleus (N) and After (A). Only triples with a long nucleus are kept. A *bridge* is a pair (B, A) that occurs with several different nuclei: the same beginning and the same end, a different melisma between. The result starts with a text block that says so, lists the bridges, and lists every triple with its notes.

**What n is.** In *N-gram frequencies* and *Keyness*, n is the length of a pattern: how many units follow each other (with intervals, n = 3 is three steps, four notes). The parameters *n from* and *n to* give a range (for example 2 to 5); one table then holds patterns of every length with a column n, and "per 10,000" is relative to patterns of the same length. *Only inside one* (syllable, neume, word) counts a melodic pattern only when all its notes lie inside one such segment.

**Leaving things out.** An analysis carries *filters* ([`filters.ts`](../../../packages/core/src/analysis/filters.ts)), set under *Leave out* on the page:
- *Rules* leave whole chants out by the value of a field: text incipit (or document id, genre, feast, source, any custom field) *contains* or *is exactly* a text. Chants that are always the same (Kyrie, Gloria, a psalm tone) make noise in every count. The page offers the most frequent values of the chosen field as buttons.
- *Stop words* are removed from the words of every chant: a built-in list of Latin function words and a list of the user's own. The melody is not touched.
The filters are applied once, before any method runs, so every method and the corpus search see the same reduced corpus. They are part of the fingerprint (`filtersKey`): changing them makes stored results out of date, an unchanged analysis stays cached. With rules, every method also counts the metadata digest as something it reads, because a rule reads metadata.

## 3a. How results are shown

**Settings sit with the result.** Above every result a bar shows the settings the method would use now (unit, n, grouping …), a *Change* button that opens the parameter form, and the chants and words left out. After a change the bar says *settings changed* and offers *Recompute with these settings*; a result is never replaced without that click. The list of methods (folded away once results exist) holds the same parameters.

Results are plain data (`ResultView` in [`result.ts`](../../../packages/core/src/analysis/result.ts)); one component draws them all ([`result-view.component`](../src/app/analysis/result-view.component.ts)), so a method adds no Angular code.

- **Notes are shown as notes.** Every n-gram, segment, axis, pair, range and passage is a notation cell: a small five-line staff drawn with the geometry and the note head of the editor. **Absolute pitches** (pitch n-grams, segments, axes, ranges, passages) stand on a **fixed treble clef**: the staff is that of the editor, where G4 lies on the second line from the bottom, E4 on the lowest line, C4 on the first ledger line below; notes outside it get ledger lines (octave numbers follow the data model: C4 is middle C, A4 is 440 Hz). **Relative units** (intervals, contour) have **no clef**: the first note is placed so that the melody is centred, and only the shape and the size of the steps matter. The text of the notes stays available for filtering, sorting and CSV. A click on the notes searches that pattern in the corpus (section 3b).
- **Charts are black and white** unless colour tells groups apart (section 3c). **Histograms** (pitch, interval, notes per syllable, chant length, mode) are columns on one baseline with a left axis and round tick values, a tooltip per column (native `<title>`), and a "data" link that shows the numbers as a table (with one column per group when the chart has groups). **Rankings** (most frequent n-grams, typical words) are thin horizontal bars with the value at the tip and the notes as label (HTML, with notation; not offered as a figure). **Heat maps** use one grey ramp (darkest where distances are smallest); the dendrogram carries a distance scale; the map uses one marker shape per group (up to six groups; with more, every point is a circle and its label names it).
- **Every table can be filtered**: a text box (all words must occur in the row, notes match by their text), a column row with a substring filter for text columns and a minimum for number columns, sort by column, paging, and CSV of the rows that pass the filter. Where a row stands for documents, a button opens them in the search; "Open N documents" opens all rows that pass the filter.

## 3c. Figures for a publication

State 2026-11-15. The charts of a result (histograms, composite figure, scatter plot, dendrogram, heat map) are drawn by one pure function, `renderViewSvg` in [`figure.ts`](../../../packages/core/src/analysis/figure.ts), as SVG text. The screen shows that SVG, so what is downloaded is what is seen.

- **The Overview method makes Figure 1.** Four panels, each over a whole axis without gaps: (a) chant length in notes, (b) pitch distribution, (c) intervals between consecutive notes (capped at ±8), (d) notes per syllable (capped at 12). Below it: a **caption** that can be copied (number of chants, notes and syllables, groups with their *n*, the reading rule), and **Table 1** (description of the corpus: one row per group and a row *All* with chants, notes, syllables, notes per syllable, median notes per chant, range; CSV download). Parameters: *Group by* (source, genre, any field; none draws the corpus as one), *Groups in the figure* (1 to 8, the largest groups; the table lists all). Version 3 of the method; stored results of version 2 are marked out of date.
- **Telling groups apart.** A chart without groups is black. With groups there are two arrangements, chosen on the result: **Panels** (default; one small panel per group, one scale per measure, so shapes compare; group name and *n* above each panel) and **Side by side** (all groups in one panel, up to four groups in black, white, mid grey and light grey, all outlined so they survive a black-and-white print; more than four groups, or eight in colour, fall back to panels). **Share** (default with groups) shows the percentage within each group, so groups of different size compare; **Counts** shows the counts. **Colour** is off by default; when on it colours the groups (categorical order of the reference palette) and nothing else.
- **Size and type.** Width 85 mm (one journal column), 120 mm or 175 mm (full page; the default of a composite figure). The drawing is made in points, type sizes stay at 7 pt (axes) and 8 pt (panel titles) at every width, and the PDF page has the size of the figure.
- **Download** (menu on every figure): **PDF** (vector, text as text in Helvetica, no background), **PNG** (300 dpi, transparent background), **SVG** (vector, for editing). Files carry no tooltips. Implementation: [`figure-export.ts`](../src/app/analysis/figure-export.ts) (PNG through a canvas that is not painted on; PDF through jsPDF and svg2pdf.js, loaded only when needed).
- **Not covered.** Rankings with notation cells are not figures; the heat map is drawn as an HTML table on the screen and as SVG in the download; the 17-source or 60-group cases rely on the *Groups in the figure* limit.

## 3d. Citing a method, and tables as LaTeX

State 2026-11-15.

- **Method line and popup.** Under every result one line names the method and its version and links to the software (the Monodi-Zero analysis library). *Algorithm and references* opens a popup with the exact description for the method section of a paper: the settings stored with the result (grouping fields by their names), the rules and stop words that left chants out, the preparation of the corpus (reading rule, pitch as diatonic index, syllables, neumes and words, groups), the numbered steps, the formulas, the cost and limits and the references. Buttons copy it as plain text, as LaTeX (`enumerate` list, formulas as display math, `\cite{key}`) and the BibTeX entries of exactly the references used. If the rules for leaving chants out were changed after the result was computed, the text says that the rules used are not recorded.
- **Where the text lives.** [`algorithms.ts`](../../../packages/core/src/analysis/algorithms.ts) holds one description per method (`ALGORITHMS`), the shared preparation (`PREPARATION`) and the references (`REFERENCES`). It is derived from the code of the methods and must be changed with it: a change to a method that alters its result also raises `version` of the method, and the description is revised in the same commit. `algorithms.test.ts` checks that every method has a description, that every cited reference exists, that every setting of every method appears in the report, and that LaTeX and BibTeX agree.
- **Literature behind the methods.**

| Method | Follows |
|---|---|
| Overview, axis, syllable groups | counts and medians; ChantDigger (Haas 2014) for axis and syllable groups |
| Tonal profile | final, ambitus and tenor of the eight modes after the traditional scheme (Hiley 1993); the estimate is a documented heuristic |
| Variants | Levenshtein 1966 (edit distance, banded after Ukkonen 1985), normalised by the longer sequence |
| N-grams | counting of overlapping windows; frequency per 10,000 windows |
| Keyness | log-likelihood G2 (Dunning 1993; Rayson and Garside 2000), log ratio (Hardie 2014) |
| Collocations | log-Dice (Rychlý 2008), pointwise mutual information and t-score (Church and Hanks 1990; Evert 2008) |
| Distance between sources | Burrows' Delta (Burrows 2002), cosine (Salton and McGill 1983), Jaccard (1901); average linkage (Sokal and Michener 1958); classical multidimensional scaling (Torgerson 1952; Gower 1966) |
| Segments, bridges, models | the program ChantDigger (Haas 2014); one documented deviation in the direction rule of the shape criteria (section 4) |

- **Tables as LaTeX.** Every table has a **LaTeX** button beside **CSV**: it copies the rows that pass the filter, in the order shown, as a `table` with `booktabs` rules (`\usepackage{booktabs}`), numbers right-aligned, special characters escaped, the title as caption (a leading "Table 1:" is dropped) and a label. At most 100 rows are written; a longer table says so in a comment, and the CSV has all rows. A distance matrix has the same button. Where the browser refuses to write to the clipboard, the code is downloaded as a `.tex` file. Implementation: [`latex.ts`](../../../packages/core/src/analysis/latex.ts).

## 3b. Searching the corpus of an analysis

The card *Search the corpus* lists the documents of the analysis (filterable, with metadata) and searches them for a **melodic pattern**: pitches (letters a–g, optionally with octave numbers; without them the octave is ignored), intervals (signed steps), or contour (u, d, r), exact or with up to 3 differences (insertions, deletions, wrong notes; approximate substring matching after Sellers), or, for exact search, with the notes **spread inside a window** (ChantDigger: "d f a c' a g 10"). The result is a table of chants with the number of passages, the fewest differences, the position of the first passage and that passage as notes. The notes of the corpus are read once and kept while the analysis is open. Implementation: [`search.ts`](../../../packages/core/src/analysis/search.ts).

## 4. ChantDigger: the Guided Tour against Monodi-Zero

The functions were collected from the Guided Tour (3 November 2014) and from the program source `chantdig_extern.js` (repository `timeipert/chantdigger-restored`). Where the original has an unintended behaviour, the deviation is documented in the code (`segments.ts`, shape criteria: the running direction starts as the direction of the first step).

| # | Function of the tour | State 2026-11-15 | Where |
|---|---|---|---|
| 1 | Corpus and genre filters for every search | present in two forms: an analysis has a chosen corpus; the quick and the melody search can be limited to the selection (the menu beside *Search*) | search page, Analysis page |
| 2 | Contents list, 20 per page, word in title | present | search page |
| 3 | "All word forms" | partial (spelling tolerance only) | open, item A2 |
| 4 | One-line summary above each graphic | present for results of the workbench (provenance line) | open for search results, item A3 |
| 5 | "Photograph" of a result | partial: CSV per table | open, item A3 |
| 6 | Chant view with syllable no., segment id, segment frequency | missing | open, item A4 |
| 7 | First tone, last tone, click notes | missing | open, item A4 |
| 8 | Most frequent tones in colour | missing | open, item A4 |
| 9 | Several chants at once | present (synopsis) | search page |
| 10 | One segment id: all chants with it | present as a table with the documents behind each row, opened in the search | `segments` |
| 11 | A sequence of segment ids | present | `segments`, parameter *Segment sequence* |
| 12 | Similarity criteria: points, isomorphisms, shape by intervals, shape by shape | present | `segments`, parameter *Similar when* |
| 13 | Word: synopsis anchored at a word | partial (text alignment mode) | synopsis |
| 14 | Notes in order within a window | present: melody search, *Advanced Options*, "Notes in order within a window" (pitch patterns, exact); and in the corpus search of the Analysis page (section 3b) | search page, Analysis page |
| 15 | Clicked notes as a query | present for patterns in result tables (a click on the notes searches them); clicking notes inside a chant is missing | open, item A4 |
| 16 | Recurring n-grams with distribution by genre | present | `ngrams` |
| 17 | BNA: bridges B_A | present | `bridges` |
| 18 | Equal syllable count, syllable table | present | `syllable-groups` |
| 19 | Find axis | present | `axis` |
| 20 | Models | present | `models` |
| 21 | "To the right": align at the match | missing | open, item A4 |
| 22 | Disclaimer | present | page footer |

## 5. Saved analyses and the cache

**What is stored** (IndexedDB, same store as the workspace, keys prefixed `monodi_`):

| Key | Content |
|---|---|
| `monodi_analyses_index` | list of `AnalysisSummary` (name, dates, document count, methods, stored sizes) so the list opens without reading results |
| `monodi_analysis_<id>` | `AnalysisDefinition`: name, note, corpus (sorted document ids, origin, label), chosen methods with parameters |
| `monodi_analysis_result_<id>_<method>` | `ResultRecord` of one method, JSON text, or gzip bytes above 256 KB |

One row per result keeps every write small and no row near the structured-clone limit, as `NotesStore` does for notes. Writes go through one queue. A result larger than 8 MB of JSON has the rows of its tables cut (strongest rows first, with the full row count kept); tables are capped at 500 rows by default (up to 5,000 by parameter). A full browser store gives a readable message.

**The fingerprint.** For every document three digests are taken from what methods read, not from the raw tree: `melody` (pitches, syllable boundaries), `text` (syllable texts), `meta` (source, siglum, label and grouping fields). Each method declares which it `uses`. The fingerprint of a run is a hash of the method id, its version, the completed parameters, and the sorted list of document ids with their used digests. Consequences: a comment edit changes no digest; a text typo invalidates only methods that read the text; a change of any metadata field invalidates methods that read `meta`; a method version bump (`AnalysisMethod.version`) invalidates its results.

**Opening an analysis** reads the definition and the result rows only and shows the results at once (status *stored*). **Check for changes** reads the documents again (notes only if a result needs them), compares the digests and marks each method *up to date* or *out of date* with the number of documents changed or removed. Out-of-date results stay visible and are recomputed only on request. **Run ticked methods** computes only methods without a result of the current fingerprint; with an unchanged corpus and parameters it computes nothing (tested in `analysis-runner.service.spec.ts`).

**Computation.** The page reads the documents in chunks of 100, reduces them to features, and posts the corpus once to a web worker (`analysis.worker.ts`), which runs the ticked methods one after another and posts each result as it finishes; the page stores it at once. Cancel ends the worker. The worker file imports only `@monodi/core/analysis` (no Angular).

**WebAssembly.** Not used. The dominant cost is reading and unpacking the notes from IndexedDB, which WebAssembly cannot speed up; the methods themselves took under 9 seconds each on 22,000 chants. The counting and distance routines take plain arrays and sit behind `runMethod`, so one can be replaced if a benchmark on real data shows a bottleneck.

**Export and import.** *Export* writes `<name>.monodi-analysis.json` (`format: "monodi-analysis"`, `version: 1`, definition, results). *Import* adds it under a new id; whether the results are valid for the documents of this workspace is decided by the check for changes. A file from a newer version is refused. Each table can be downloaded as CSV; the distance matrix as CSV.

**Workspace backup.** See section 6.

## 6. Where analyses touch the rest of the application

State 2026-11-15.

| Place | Behaviour |
|---|---|
| Workspace export (`.monodijson`, `buildWorkspaceExport`; the export button, the linked backup file and the file-system export) | optional top-level key `analyses`: every saved analysis with its results (`AnalysisExport[]`). The key is absent when there are none, so files stay as before; the schema version is unchanged and older versions of the application ignore the key. It is left out in the compat mode `split_documents`, because the document ids change there. |
| Workspace import | `AnalysisStore.restoreAll` replaces the analyses of the browser by those of the file, under their original ids and with their results. A file without the key leaves the analyses as they are; the check for changes then marks results whose documents differ. |
| Settings, Danger zone | *Delete saved analyses* (with count and stored size); *Delete documents & notes* and *Delete everything* also delete all analyses (they refer to documents). |
| GitHub sync | analyses are not synchronised: sync uploads only what `LocalWorkspaceSource` supplies (sources, documents, notes, settings). |

## 7. Search flexibility

| Item | State 2026-11-15 |
|---|---|
| Select all, invert, only these hits, clear on quick, sources, documents, melody results and on the manuscript list of the statistics page; real "all hits", not the page | done (`selection/`) |
| Source rows (quick results, sources tab) select all documents of the source, tri-state | done |
| Selection kept for the session; address bar carries `compare=` up to 50 ids | done |
| Synopsis asks above 20 witnesses; print and dashboard ask above 200 documents | done |
| Formula analysis: scope card (hits, selection, every document), one entry per document, duplicates listed, no automatic start on opening | done |
| Melody search can find the notes of a pitch pattern in order inside a window (ChantDigger); quick and melody search can be limited to the selection | done |
| Melody search finishes once, shows progress and Cancel; quick search shows progress and Cancel; no second search while one runs; quick-search cache invalidated by edits | done |

## 8. How it is checked

- `cd packages/core && npm test`: the methods, fingerprints, statistics and the ChantDigger criteria (hand-computed expectations); the method descriptions and LaTeX output (`algorithms.test.ts`), the figure renderer (`figure.test.ts`: well-formed SVG, size in points, no background, only greys unless colour is on, escaped text, share versus count, panels versus side by side); `exports.test.ts` loads the entry point in Node.
- `cd apps/monodi && npx ng test --watch=false --browsers=ChromeHeadless`: selection helper and bar, search integration (all hits across pages, invert, source checkbox, address cap, synopsis guard), store (round trip, compression, quota message, export and import), runner (cache hit, parameter change, stale after melody or text edit, comment edit keeps results), result renderer (figure markup, style switches, SVG, PNG with the right type and PDF downloads).
- `npx ng build --configuration production` and `npm run check:templates`.
- Benchmark: `node --import ./src/resolve-ts.mjs src/analysis/bench.ts 22000` in `packages/core`.

## 9. Open items

State 2026-11-15.

| # | Item | Context | Who decides |
|---|---|---|---|
| A2 | Word-beginning mode for text search ("all word forms" of the tour) | item 3; spelling tolerance exists | maintainer of the search page |
| A3 | Provenance line and image snapshot on search results (the workbench has the provenance line and CSV) | items 4, 5 | maintainer of the search page |
| A4 | Chant view in the workbench: segment strip, first and last tone, tone-frequency colours, click notes inside a chant, align at the match | items 6–8, 15 (clicks on patterns in tables exist), 21 | maintainer of the workbench |
| A6 | Old formula "sessions" (`saved_pattern_sessions`) are not migrated into saved analyses | they keep working on the search page | maintainer of the workbench |
| A7 | Pitch naming with `h` for B-natural | ChantDigger uses `h` | project lead |
| A8 | B and B-flat are not told apart in the methods (the data model keeps the accidental as a separate sign) | section 2 | maintainer of the MEI export and analysis |
