# Chant pictures as SVG

State: 2026-11-04 (baseline: Monodi-Zero 0.9.1).

**What it is for.** The static pages of the Corpus Monodicum dataset (built by CM-hub) show the notation of every chant
as a picture. The picture is drawn by Monodi-Zero itself, so it looks like the chant in the PDF export of the editor:
the same systems, clefs, staff lines, neume outlines, brackets, lyrics, rubrics and spacing.

**Who it is for.** Maintainers of the export code in `apps/monodi` and of the dataset builder in CM-hub.

## How it works

1. `src/app/pdf-export.service.ts` (`PdfExportService`) lays a document out and draws it on a jsPDF document. The export
   has options for this use: `heading: false` (no title and metadata line), `runningHead: false` (no source line
   and rule on the page), `pageSizePt` (one tall page, so a chant stays in one piece), `wrapDocument` (lets a caller
   wrap the jsPDF document) and `output: 'none'` (draw only, write no file).
2. `src/app/print/svg-recorder.ts` (`SvgRecorder`) wraps the jsPDF document. Every call still reaches jsPDF (so text
   widths and the layout are those of the PDF); text, lines, rectangles and outlines are recorded as well and written
   as SVG by `toSvg()`.
3. `src/app/print/chant-svg.ts` (`renderChantSvg`) runs one chant through the export with these options and returns
   the SVG. It needs no DOM and no Angular injector.
4. `scripts/export-svg-batch.mjs` reads a Monodi ZIP or folder and writes one SVG per chant. `scripts/lib/svg-batch-entry.ts`
   is bundled with esbuild and runs in Node; font files are read from `src/assets/font`.

Critical apparatus: the collected comments and readings (reading lines, bracketed lemmata, small staves with notes in
the comment cells) follow the last system under the heading "Critical apparatus", as in the PDF of the chant
(`apparatus: true`, the default of `renderChantSvg`; `--no-apparatus` of the script leaves it out). The title pages of
the parts of a volume ("Edition", "Critical apparatus") are not drawn (`pdfPartStyle: 'compact'`). Links of the PDF
(references in the comments) are not part of the SVG.

Pages: a chant longer than the page height (default 14400 pt) continues on a second page, and the apparatus starts a new page;
the recorder stacks the pages below each other: the ink of a page starts 12 pt below the ink of the page before, so
margins and the empty rest of a page are left out.

## The SVG

| Aspect | Choice |
|---|---|
| Units | pt, as in the PDF; `viewBox` fits the drawing, `width` and `height` in pt (scale with CSS `max-width: 100%; height: auto`). |
| Colour | `fill="currentColor"` on the root; staff lines, brackets and note heads use `currentColor`. The notation colour of the settings (`#333333` by default), black and other dark colours (up to `#333333` in every channel) become `currentColor`; the grey of comment brackets stays an explicit colour. |
| Staff | one `<use>` per staff (five equally spaced lines, defined once with `<path id="s…">` and stretched by a `matrix`). |
| Note heads, clef, flags | an outline drawn twice or more is defined once in `<defs>` (`id="g…"`, derived from the shape, so two SVGs inlined in one page never clash) and placed with `<use x y>`; a single outline is inline. |
| Brackets, ledger lines, ticks | merged into a few `<path>` elements. |
| Text | plain `<text>` in the PDF font family `"Crimson Text"` with `Georgia`, `serif` as fallback. Load Crimson Text (`src/assets/font/crimson`) in the page for the exact spacing of the PDF. |
| Not used | ids and classes other than the shape ids, `<style>`, `<image>`. |
| Precision | positions to 0.1 pt, shapes to 0.01 pt. |

## Run it

```
node scripts/export-svg-batch.mjs --zip <monodi.zip> --out <svg.zip>
node scripts/export-svg-batch.mjs --dir <folder> --out <folder> [--settings <json>] [--page-width <pt>] [--no-apparatus] [--only <text>] [--limit <n>]
```

`report.json` in the output lists every picture (size, gzip size, pages, systems) and every chant without a picture
(an empty document). `--settings` takes the print settings of Monodi-Zero (`pdfScale`, `pdfFontSize`, `clefDisplayMode`,
`notationColor`, …); the default is the print-edition preset.

Measured on the edition ZIP of CM-hub (state 2026-11-04, 4987 chants): 4979 pictures, 8 empty documents without a
picture, 92 MB raw, 17.7 MB gzipped; gzipped per chant: median 2.4 KB, 95th percentile 10.2 KB, largest 84 KB (a chant with
297 systems). On 70 chants of one dataset build, the Verovio pictures of the dataset pages were 6.5 KB gzipped (median) against 4.2 KB here.

## Check

`npm run test:svg-batch` (Node, a few seconds; also in CI) builds a small Monodi folder and checks the files, the SVG
structure and the report. Unit tests: `src/app/print/svg-recorder.spec.ts` (the recorder on its own) and
`src/app/print/chant-svg.spec.ts` (real and extreme fixtures through the whole export).

## Open

1. Text is `<text>`, not outlines: a page without Crimson Text shows another font with other widths. Options: ship the
   font with the page (recommended), or convert the text to outlines (larger files). Decided by: the dataset maintainer.
2. The picture is the chant as the PDF sets it (a line change inside a line is a tick, not a new system; the comment
   brackets are drawn). Changes to the look belong in the PDF export, so that PDF and picture stay equal.
