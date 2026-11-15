import type { NgZone } from '@angular/core';
import type { jsPDF } from 'jspdf';
import { PdfDocJob, PdfExportService } from '../pdf-export.service';
import { PRINT_PAGE_PT } from '../pdf-defaults';
import { renderChantSvg } from './chant-svg';
import { SvgRecorder } from './svg-recorder';

/**
 * A chant as a figure for a publication: only the drawing, no heading, running head, page number or title page, and a
 * picture that ends where the ink ends. Three formats, all drawn by the real PDF export, so they look like the chant in the
 * PDF of the edition:
 *  - PDF: vector, one page per picture (more only when the apparatus is on), each page cut to its ink (`renderFigurePdf`);
 *  - SVG: vector, text stays text (`renderChantSvg`, see documentation/CHANT-SVG.md);
 *  - PNG: pixels at a chosen resolution (`renderFigurePng`; needs a browser).
 * The dialog of the PDF export offers them as export targets (documentation/PDF-TARGETS.md).
 */

export type FigureFormat = 'pdf' | 'svg' | 'png';

export interface FigureOptions {
  /** Print settings of the project (scale, fonts, notation colour, clef display, ...). */
  settings?: { [key: string]: any } | null;
  /** Width in pt that the systems wrap at (the line width of the page). Default: the printed edition's 21 cm page. */
  pageWidthPt?: number;
  /** The critical apparatus below the chant. Default: false (a figure is the chant alone). */
  apparatus?: boolean;
  /** White space around the ink in pt. Default: 4. */
  paddingPt?: number;
}

/** Height of the working page; a chant is laid out on one page of this height and the page is cut to the ink afterwards. */
const WORK_PAGE_HEIGHT_PT = 14400;

/** The export service outside Angular: its only use of the zone is running the export. */
const outsideAngular = { runOutsideAngular: <T>(f: () => T) => f(), run: <T>(f: () => T) => f() } as unknown as NgZone;
let service: PdfExportService | null = null;

/** The settings that make one chant a stand-alone picture: no facing pages, no page numbers, parts of a volume run on. */
function figureSettings(settings: FigureOptions['settings']): { [key: string]: any } {
  return { ...(settings ?? {}), pdfMirrorMargins: false, pdfShowPageNumbers: false, pdfPageStyle: settings?.pdfPageStyle ?? 'print', pdfPartStyle: settings?.pdfPartStyle ?? 'compact' };
}

/**
 * The chant as a vector PDF whose page is exactly the drawing (plus padding). The export lays the chant out once on a tall
 * page while a recorder reads where the ink is; the second run draws the real PDF and, before it is written, every page gets
 * a media box of its ink and its content is moved to the box's corner.
 */
export async function renderFigurePdf(job: PdfDocJob, o: FigureOptions = {}): Promise<Blob> {
  const exporter = (service ??= new PdfExportService(outsideAngular));
  const settings = figureSettings(o.settings);
  const pad = o.paddingPt ?? 4;
  const size: [number, number] = [o.pageWidthPt ?? PRINT_PAGE_PT[0], WORK_PAGE_HEIGHT_PT];
  const base = {
    settings: settings as any, titlePage: false, includeMetadata: false, apparatus: o.apparatus === true, heading: false, runningHead: false,
    boxLabel: 'none' as const, arrangeRelated: false, pageSizePt: size,
  };

  // pass 1: where is the ink on each page?
  const rec = new SvgRecorder();
  const stats = await exporter.exportDocuments([job], { ...base, output: 'none', wrapDocument: (doc) => rec.wrap(doc) });
  const boxes: ({ x0: number; y0: number; x1: number; y1: number } | null)[] = [];
  for (let p = 1; p <= stats.pages; p++) boxes.push(rec.inkBox(p));
  if (!boxes.some((b) => b)) throw new Error('Nothing to draw: the document has no content.');

  // pass 2: the same drawing into a real PDF, cut page by page before it is written
  const cut = (doc: jsPDF): void => {
    boxes.forEach((box, i) => {
      const info = (doc as any).getPageInfo(i + 1);
      const mediaBox = info.pageContext.mediaBox;
      if (!box) return;
      const left = box.x0 - pad, top = box.y0 - pad;
      const width = box.x1 - box.x0 + 2 * pad, height = box.y1 - box.y0 + 2 * pad;
      // PDF coordinates run upwards from the bottom of the working page: the box's lower left corner moves to the origin
      const dx = -left, dy = -(size[1] - (top + height));
      (doc.internal as any).pages[i + 1].unshift(`1 0 0 1 ${dx.toFixed(2)} ${dy.toFixed(2)} cm`);
      mediaBox.bottomLeftX = 0; mediaBox.bottomLeftY = 0; mediaBox.topRightX = width; mediaBox.topRightY = height;
    });
  };
  const second = await exporter.exportDocuments([job], {
    ...base, output: 'blob',
    wrapDocument: (real) => new Proxy(real, {
      get: (target, prop) => {
        const v = (target as any)[prop];
        if (typeof v !== 'function') return v;
        return (...args: any[]) => {
          if (prop === 'output') cut(target);
          return v.apply(target, args);
        };
      },
    }),
  });
  if (!second.blob) throw new Error('The figure PDF was not created.');
  return second.blob;
}

/** The chant as an SVG picture (the same one as the dataset pages use). */
export async function renderFigureSvg(job: PdfDocJob, o: FigureOptions = {}): Promise<string> {
  const out = await renderChantSvg(job, { settings: o.settings, pageWidthPt: o.pageWidthPt, apparatus: o.apparatus === true });
  if (!out.svg) throw new Error('Nothing to draw: the document has no content.');
  return out.svg;
}

/** The font files of the PDF font "Crimson Text" (the default of the print edition), by CSS style. */
const CRIMSON_FILES: { weight: string; style: string; file: string }[] = [
  { weight: 'normal', style: 'normal', file: 'assets/font/crimson/CrimsonText-Regular.ttf' },
  { weight: 'bold', style: 'normal', file: 'assets/font/crimson/CrimsonText-Bold.ttf' },
  { weight: 'normal', style: 'italic', file: 'assets/font/crimson/CrimsonText-Italic.ttf' },
];

/** `@font-face` rules with the fonts inlined as data, so that an SVG drawn as an image (which cannot see the page's fonts) sets its text in Crimson Text. */
async function inlineFontStyle(): Promise<string> {
  const rules = await Promise.all(CRIMSON_FILES.map(async (f) => {
    const data: ArrayBuffer = await (await fetch(f.file)).arrayBuffer();
    const buf = new Uint8Array(data);
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
    return `@font-face{font-family:"Crimson Text";font-weight:${f.weight};font-style:${f.style};src:url(data:font/ttf;base64,${btoa(bin)}) format("truetype")}`;
  }));
  return rules.join('');
}

/**
 * The chant as a PNG. The SVG is drawn on a canvas at `dpi` (pt are 1/72 inch). Black ink on a white or transparent ground;
 * needs a browser (canvas) and the font files under `assets/font/crimson`.
 */
export async function renderFigurePng(job: PdfDocJob, o: FigureOptions & { dpi?: number; transparent?: boolean } = {}): Promise<Blob> {
  const dpi = Math.min(1200, Math.max(72, o.dpi ?? 300));
  let svg = await renderFigureSvg(job, o);
  const style = await inlineFontStyle();
  // currentColor has no page to inherit from: set the ink colour explicitly; the fonts go in as a style element
  svg = svg.replace(/^<svg /, '<svg color="#000000" ').replace(/(<svg [^>]*>)/, `$1<style>${style}</style>`);
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const w = m ? Number(m[1]) : 0, h = m ? Number(m[2]) : 0;
  if (!w || !h) throw new Error('The picture has no size.');
  const scale = dpi / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  if (canvas.width * canvas.height > 120_000_000) throw new Error('The picture is too large for this resolution; lower the dpi.');
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('The picture could not be drawn.')); img.src = url; });
    const ctx = canvas.getContext('2d')!;
    if (!o.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be written.'))), 'image/png'));
}
