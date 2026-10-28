<img width="1440" height="530" alt="grafik" src="https://github.com/user-attachments/assets/4e8d914a-9c46-48de-8f3d-a93c44f88f03" />

**A local-first digital workbench for the transcription, edition, and analysis of medieval monophonic chant.**

Monodi-Zero is a web application for musicologists working with plainchant and other monophonic repertoires in neume and square notation. It combines a keyboard-driven notation editor, IIIF manuscript integration, a critical apparatus, corpus-wide search, and quantitative melodic analysis in a single tool — with all data remaining on your own machine.

It is designed for individual scholars and small research groups who need scholarly rigour (variant readings, witness sigla, publication-ready output) without the overhead of institutional server infrastructure.

**Because the browser owns the storage, please make regular backups — clearing your browser's site data deletes the workspace.**

---

## What you can do with it

### Transcribe
- A **keyboard-first notation editor**: syllables, pitches, clefs, and neume shapes (punctum, liquescent, oriscus, quilisma) are entered without touching the mouse, enabling fast and accurate transcription of complete manuscripts.
- The music–text bond is preserved structurally: every note belongs to a syllable, every syllable to a line, folio, and structural section of the chant.
- Chants can be organized into **named sections with up to three nesting levels** (e.g. antiphon/verse, double strophes and versicles of sequences), with level labels configurable per liturgical genre.
- **Paratexts** (rubrics, incipit references, performance instructions) are transcribed alongside the music.
- Full undo/redo history protects your work during editing.

### Work with the manuscript image
- Integrated **IIIF viewer**: display any manuscript served via the International Image Interoperability Framework side-by-side with your transcription.
- Draw zones on the manuscript image and **link them line-by-line to the transcription** — clicking a zone scrolls the edition to the corresponding line, and vice versa.
- Folio changes in the transcription automatically load the correct manuscript page.

### Build a critical apparatus
- Comments are anchored to **precise note ranges**, selected in a guided two-step process, and displayed as colour-coded brackets beneath the staff.
- Variant readings are modelled as a **recursive comment tree**: grid nodes align parallel witnesses (rows) against melodic segments (columns), and each cell may contain text, alternate notation, or further nested comparisons.
- The apparatus is rendered into the PDF export in the manner of a printed critical edition.

### Search and analyse the corpus
- **Four search modes**: full text (phrase / all words / any word / fuzzy, with medieval spelling tolerance such as *u/v* and *i/j*), source metadata, document metadata, and **melody search** by pitch, interval, or contour with adjustable Levenshtein tolerance.
- **Synoptic comparison**: view any set of parallel transcriptions aligned side-by-side — by melody, by text, by structure, or sequentially — with an optional consensus text row, and export the synopsis as a fully vector PDF with witness table, running heads, and page numbers.
- **Melodic formula analysis**: discover recurring melodic patterns across a chosen subcorpus, grouped by pitch, interval, or contour, with duplicate-witness detection, a timeline overview of formula density per chant, and citable permalinks for every pattern.
- **Notation statistics**: a pattern-by-source matrix showing how frequently each neume pattern (and each ornamental variant) occurs in each manuscript — scribal habits at a glance, with every count traceable to its exact position in the edition.

### Publish and export
- **PDF**: publication-quality vector output of single documents (with apparatus) and of synoptic comparisons. Layout, typography, margins, and bracket geometry are fully configurable.
- **MEI**: export to Music Encoding Initiative XML with configurable tag mappings for interoperability with tools such as Verovio and with computational corpus research.
- **HTML edition**: generate a self-contained, offline-capable reading edition of your whole corpus — rendered notation, browsable metadata, and built-in search — suitable for sharing with colleagues or publishing as a website.
- **ZIP / JSON**: complete workspace backups and corpus archives compatible with monodi+ and OMMR4all exports. A source's `meta.json` in a ZIP may also carry its notation documentation (`equivalents`, `annotationRegions`, `annotationItems`); the import merges these lists into the source and deletes nothing.

---

## Your data stays yours

Monodi-Zero is **local-first**: there is no server, no account, and no transmission of your research data. Everything — sources, transcriptions, apparatus, settings — is stored in your browser on your own computer.

- **Backups**: export your complete workspace as a single JSON file at any time (Settings → Workspace), or connect a **GitHub repository** for versioned backup and team synchronisation.
- **Collaboration**: a shared GitHub repository lets a research group or seminar work on a common corpus; each chant is stored as its own file, so contributors rarely conflict.
- **Portability**: workspaces move between machines via the export/import functions; existing corpora can be brought in from monodi+ or OMMR4all ZIP exports, including very large collections (hundreds of sources).

**Because the browser owns the storage, please make regular backups — clearing your browser's site data deletes the workspace.**

---

## Getting started

1. Open the application in a current browser (Chrome, Firefox, Edge, or Safari).
2. Create a **Source** for your manuscript (siglum, provenance, library, shelfmark …), then a **Document** for the first chant.
3. Open the document, place a clef (<kbd>c</kbd>), type the text syllable by syllable, and add notes with the arrow keys and <kbd>Space</kbd>.
4. Optionally paste the manuscript's IIIF manifest into the source to see the original beside your transcription.

The complete **user manual** is built into the application (*Manual* in the navigation bar), including a keyboard-shortcut reference, an interactive apparatus tutorial, and step-by-step guides for common research workflows — from importing an existing corpus to running a formula analysis and exporting a synopsis for publication.

---

## For developers

Monodi-Zero is an Angular application (currently Angular 18) with browser-side persistence via IndexedDB. There is no backend.

```bash
npm ci                 # install dependencies
npx ng serve           # development server at http://localhost:4200
npx ng build --configuration production
npx ng test --watch=false --browsers=ChromeHeadless   # unit tests
```

### Desktop app (Electron)

The same web build is also packaged as a cross-platform desktop app:

```bash
npm run electron:start   # build and launch the desktop shell locally
npm run pack             # unpacked build for the current platform (fast, no installers)
npm run dist:electron    # full installers (dmg / nsis / AppImage) via electron-builder
```

> **Node 22 required for packaging.** `electron-builder` depends on an ESM-only
> module that only loads under Node ≥ 22 (or ≥ 20.19). The packaging scripts
> refuse to run on older Node with a clear message — use `nvm use 22` first.
> The web build and the test suite are unaffected and run on Node 20.

Continuous integration builds and tests every push (see `.github/workflows/ci.yml`); the desktop-release workflow (`.github/workflows/electron.yml`) must run its build job on **Node 22**. Release conventions, versioning, and the data-migration policy are documented in `RELEASING.md`.

Issues and contributions are welcome via the [GitHub repository](https://github.com/timeipert/mz).

---


## Related projects

Monodi-Zero is conceptually related to the **mono:di** editor developed for the *Corpus Monodicum* project and interoperates with data exported from **monodi+** and from the optical music recognition framework **OMMR4all**. It builds on open standards: [IIIF](https://iiif.io/) for manuscript images and [MEI](https://music-encoding.org/) for encoded notation.

