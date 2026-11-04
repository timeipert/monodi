import type { NgZone } from '@angular/core';
import { PdfDocJob, PdfExportService } from '../pdf-export.service';
import { PRINT_PAGE_PT } from '../pdf-defaults';
import { sanitizeNotationColor } from '../notation-color';
import { SvgRecorder } from './svg-recorder';

/**
 * One chant as a single SVG picture that looks like the chant in the PDF of Monodi-Zero: the real PDF export lays the
 * chant out (same systems, clefs, spacing, rubrics, lyrics), and `SvgRecorder` writes what it draws as SVG instead of a PDF.
 * Not an Angular service: it needs no DOM, so it runs in Node (see scripts/export-svg-batch.mjs) and in the browser.
 */

export interface ChantSvgOptions {
  /** Project settings of the PDF export (page style, scale, fonts, notation colour, clef display …). Default: the print-edition defaults. */
  settings?: { [key: string]: any } | null;
  /** Width of the page in pt; systems wrap at the right margin as in the PDF. Default: the printed edition's 21 cm. */
  pageWidthPt?: number;
  /** Height of the single page in pt. A chant that does not fit continues on a second page, which the SVG stacks below. Default: 14400 (the largest page jsPDF handles well). */
  pageHeightPt?: number;
  /** The critical apparatus (the collected comments and readings) after the last system, as the PDF of the chant shows it. Default: true. */
  apparatus?: boolean;
}

export interface ChantSvg {
  svg: string;
  /** Pages the PDF layout needed (1 unless the chant is longer than `pageHeightPt`). */
  pages: number;
  systems: number;
}

const PAGE_HEIGHT_PT = 14400;

/** The export service outside Angular: its only use of the zone is running the export. */
const outsideAngular = { runOutsideAngular: <T>(f: () => T) => f(), run: <T>(f: () => T) => f() } as unknown as NgZone;
let service: PdfExportService | null = null;

/** Draws `job` with the PDF export and returns the SVG. `job.document` and `job.cont` are the document metadata and its transcription. */
export async function renderChantSvg(job: PdfDocJob, o: ChantSvgOptions = {}): Promise<ChantSvg> {
  const exporter = (service ??= new PdfExportService(outsideAngular));
  // Facing pages and page numbers belong to a book; one picture has neither.
  const settings: { [key: string]: any } = { ...(o.settings ?? {}), pdfMirrorMargins: false, pdfShowPageNumbers: false, pdfPageStyle: o.settings?.pdfPageStyle ?? 'print',
    // the parts of a volume (edition, apparatus) would each get a page with only a title; in one picture they follow each other
    pdfPartStyle: o.settings?.pdfPartStyle ?? 'compact' };
  const rec = new SvgRecorder();
  const stats = await exporter.exportDocuments([job], {
    settings: settings as any, titlePage: false, includeMetadata: false, apparatus: o.apparatus !== false, heading: false, runningHead: false, boxLabel: 'none', arrangeRelated: false,
    output: 'none', pageSizePt: [o.pageWidthPt ?? PRINT_PAGE_PT[0], o.pageHeightPt ?? PAGE_HEIGHT_PT], wrapDocument: (doc) => rec.wrap(doc),
  });
  const svg = rec.toSvg({ notationColor: sanitizeNotationColor(settings.notationColor), });
  return { svg, pages: stats.pages, systems: stats.systems };
}
