# Export targets of the PDF dialog

State: 2026-11-15 (baseline: Monodi-Zero 0.9.1).

**What it is for.** The print dialog (`src/app/pdf-export-dialog.component.ts`) produces output for different purposes. The
field "Output for" selects the purpose; it is remembered separately for one document and for several documents.

**Who it is for.** Editors who print or publish chants, and maintainers of the export code.

| Target | Option value | Content | Default for |
|---|---|---|---|
| Printed edition | `edition` | Layout of the printed volume: heading and metadata line, running head, page numbers, title page, contents, cover, source descriptions, notation documentation. | several documents |
| Content only | `content` | The chant (and, if ticked, its critical apparatus) on a normal page. No heading, metadata line, running head, page number or title page. | one document |
| Figure, vector PDF | `figure-pdf` | One PDF page per picture, cut to the drawing (4 pt padding). Text stays text, the font is embedded. For a figure in a publication. | |
| Figure, SVG | `figure-svg` | The picture the dataset pages use (`documentation/CHANT-SVG.md`). Editable in vector programs; text is plain `<text>`. | |
| Figure, PNG | `figure-png` | The SVG drawn at 300, 600 or 1200 dpi, white or transparent ground, fonts inlined. | |

Figure targets draw the chant alone (no apparatus unless ticked). Line width is the page width of the settings, so systems
wrap as in the edition. Several documents give one file per document in a ZIP.

## How it works

- `content`: the dialog calls `PdfExportService.exportDocuments` with `heading: false`, `runningHead: false`, no title page.
- Figures: `src/app/print/figure.ts`. `renderFigurePdf` lays the chant out twice. Run 1 records the drawing (`SvgRecorder.inkBox`)
  to learn where the ink is; run 2 writes the real PDF and, before it is written, gives every page a media box of its ink and
  moves the content to the box corner. `renderFigureSvg` is `renderChantSvg`. `renderFigurePng` draws that SVG on a canvas.

## Check

`npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/print/figure.spec.ts'` (media box of the PDF equals the
SVG size). The PNG path needs a browser canvas and has no automated test (open, state 2026-11-15).

## Open

1. PNG and the dialog are not covered by an automated test. Role: maintainer of the export.
2. Further targets considered, not built: proof copy (document ID, metadata, apparatus, date, for corrections), slide
   (wide 16:9, large type), figure with text as outlines (for publishers that require it). Role: editors decide which are needed.
