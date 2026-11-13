/**
 * Node-side entry of the headless volume export (scripts/export-pdf-batch.mjs), bundled with esbuild. It runs the real PDF
 * export of Monodi-Zero (PdfExportService.exportDocuments, the same call as the "Print" dialog) on all documents of a
 * Monodi ZIP and returns one PDF. No browser is needed.
 */
import '@angular/compiler';   // the PDF service is an Angular class; outside the Angular build it needs the JIT compiler once
import type { NgZone } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfDocJob, PdfExportOptions, PdfExportService } from '../../src/app/pdf-export.service';
import { LoadedImage, setImageLoader } from '../../src/app/print/image-loader';
import { TITLE_PRESETS, sanitizeTitleTemplate } from '../../src/app/print/title-page';
import * as VM from '../../src/app/types/model';
import { monodiDocument, monodiSource } from './monodi-meta';

/**
 * Pictures (source descriptions, notation documentation) without a browser: PNG and JPEG are passed to the PDF as they
 * are, their size read from the file header (PNG: IHDR; JPEG: the first SOF marker). Other formats (GIF, WebP, SVG)
 * are left out, as in the browser when a picture cannot be read.
 */
export function imageFromBytes(b: Uint8Array): LoadedImage | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const b64 = () => Buffer.from(b).toString('base64');
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { data: 'data:image/png;base64,' + b64(), format: 'PNG', w: u32(16), h: u32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { data: 'data:image/jpeg;base64,' + b64(), format: 'JPEG', w: u16(i + 7), h: u16(i + 5) };
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

async function nodeImage(src: string): Promise<LoadedImage | null> {
  try {
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      return imageFromBytes(new Uint8Array(Buffer.from(src.slice(comma + 1), /;base64/.test(src.slice(0, comma)) ? 'base64' : 'utf8')));
    }
    const res: any = await (globalThis as any).fetch(src);
    if (!res.ok) return null;
    return imageFromBytes(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Fonts are fetched by relative URL ("assets/font/…") in the browser; here they are read from the app's asset folder. */
export function useAssetsFrom(assetsRoot: string): void {
  setImageLoader(nodeImage);
  const web = globalThis.fetch;   // pictures of the source descriptions and the notation documentation come from the web
  (globalThis as any).fetch = async (url: any, init?: any) => {
    if (/^(https?:|data:)/.test(String(url))) return web(url, init);
    const buf = readFileSync(join(assetsRoot, String(url)));
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/**
 * What to print, as a JSON file (`--job`). Every key is optional.
 *  - `title`: title of the print (title page, contents).
 *  - `cover`: a cover before everything else: the id of a built-in template ("corpus-monodicum", "plain"), or a template
 *    object (the shape of TitleTemplate in src/app/print/title-page.ts; checked with sanitizeTitleTemplate). `coverGroup`
 *    is what the placeholder $gruppe$ stands for.
 *  - `settings`: project settings of the PDF export (the keys of ProjectSettings in src/app/api.service.ts: pdfFormat,
 *    pdfScale, relationTypes, relationFields …). Default: the print-edition defaults.
 *  - `options`: the choices of the print dialog (titlePage, contents, includeMetadata, apparatus, sourceDescriptions,
 *    newPagePerDocument, arrangeRelated, relatedAt, boxLabel, pageFormat, countFrontPages). Defaults: those of the dialog
 *    for several documents.
 *  - `coverPages`: further pages behind the cover, each a template like `cover` (series page, title page, imprint).
 *  - `textParts`: parts of running text from Markdown, `{ front: [{ title, markdown }], report: [...], back: [...] }` (notes on
 *    the volume, introduction before the edition; literature sigla at the start of the critical report; indexes at the end).
 *  - `order`: document ids (`id` of meta.json) in print order. Documents not listed follow, sorted by source and dokumenten_id.
 */
export interface VolumeJob {
  title?: string;
  cover?: string | object | null;
  coverGroup?: string;
  coverPages?: (string | object)[];
  textParts?: PdfExportOptions['textParts'];
  settings?: { [key: string]: any } | null;
  options?: Partial<PdfExportOptions>;
  order?: string[];
}

export interface VolumeDoc { root: any; document: any; source: any }

export interface VolumeResult {
  pdf?: Uint8Array;
  pages?: number;
  documents?: number;
  frontPages?: number;
  outline?: { label: string; page: number; depth: number }[];
  notationProblems?: string[];
  /** Systems (staff lines) drawn in the edition part; 0 for a chant with notes means its notation was not drawn. */
  systems?: number;
  error?: string;
}

/** The export service outside Angular: its only use of the zone is running the export. */
const outsideAngular = { runOutsideAngular: <T>(f: () => T) => f(), run: <T>(f: () => T) => f() } as unknown as NgZone;

/** The dialog's choices for several documents (pdf-export-dialog.component.ts, loadOptions). */
const MULTI_DEFAULTS: Partial<PdfExportOptions> = {
  titlePage: true, contents: true, includeMetadata: true, apparatus: true, sourceDescriptions: false, notationDocumentation: false,
  neumeTree: false, newPagePerDocument: false, arrangeRelated: true, relatedAt: 'block', boxLabel: 'number', countFrontPages: false,
};

export function orderDocs(docs: VolumeDoc[], order: string[] = []): VolumeDoc[] {
  const rank = new Map(order.map((id, i) => [String(id), i]));
  const at = (d: VolumeDoc) => rank.get(String(d.document?.id)) ?? Number.MAX_SAFE_INTEGER;
  return [...docs].sort((a, b) => at(a) - at(b)
    || String(a.document?.quelle_id).localeCompare(String(b.document?.quelle_id))
    || String(a.document?.dokumenten_id).localeCompare(String(b.document?.dokumenten_id), undefined, { numeric: true }));
}

function templateOf(cover: string | object) {
  const raw = typeof cover === 'string' ? TITLE_PRESETS.find((p) => p.id === cover)?.template : cover;
  if (!raw) throw new Error(`unknown cover template "${cover}" (built in: ${TITLE_PRESETS.map((p) => p.id).join(', ')})`);
  return sanitizeTitleTemplate(raw);
}

function coverOf(job: VolumeJob): PdfExportOptions['cover'] {
  return job.cover ? { template: templateOf(job.cover), group: job.coverGroup } : undefined;
}

export async function renderVolume(docs: VolumeDoc[], job: VolumeJob = {}): Promise<VolumeResult> {
  try {
    const jobs: PdfDocJob[] = orderDocs(docs, job.order).map((d) => {
      const source = monodiSource(d.source);
      return { document: monodiDocument(d.document), cont: VM.normalizeDocumentComments(d.root), source, sigle: source.quellensigle || '' };
    });
    if (!jobs.length) return { error: 'no document to print' };
    const exporter = new PdfExportService(outsideAngular);
    const options: PdfExportOptions = {
      ...(MULTI_DEFAULTS as PdfExportOptions), ...(job.options ?? {}),
      settings: (job.settings ?? null) as any, title: job.title ?? '', cover: coverOf(job), output: 'blob',
      coverPages: (job.coverPages ?? []).map((c) => ({ template: templateOf(c), group: job.coverGroup })),
      textParts: job.textParts ?? job.options?.textParts,
    };
    if (!options.titlePage) options.contents = false;
    const stats = await exporter.exportDocuments(jobs, options);
    const pdf = new Uint8Array(await stats.blob!.arrayBuffer());
    return { pdf, pages: stats.pages, documents: jobs.length, frontPages: stats.frontPages, outline: stats.outline, notationProblems: stats.notationProblems, systems: stats.systems };
  } catch (e: any) {
    return { error: String(e?.stack ?? e) };
  }
}
