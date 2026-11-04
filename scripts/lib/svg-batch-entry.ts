/**
 * Node-side entry of the headless SVG export (scripts/export-svg-batch.mjs), bundled with esbuild. It runs the real PDF
 * export of Monodi-Zero on one chant and returns the drawing as SVG (see src/app/print/chant-svg.ts). No browser is needed.
 */
import '@angular/compiler';   // the PDF service is an Angular class; outside the Angular build it needs the JIT compiler once
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderChantSvg } from '../../src/app/print/chant-svg';
import { monodiDocument, monodiSource } from './monodi-meta';

/** Fonts are fetched by relative URL ("assets/font/…") in the browser; here they are read from the app's asset folder. */
export function useAssetsFrom(assetsRoot: string): void {
  (globalThis as any).fetch = async (url: string) => {
    const buf = readFileSync(join(assetsRoot, String(url)));
    return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

export interface SvgJob {
  root: any;       // data.json of the document (RootContainer)
  document: any;   // meta.json of the document
  source: any;     // meta.json of its source
  settings?: { [key: string]: any } | null;
  pageWidthPt?: number;
  pageHeightPt?: number;
  apparatus?: boolean;
}

export async function renderOne(job: SvgJob): Promise<{ svg?: string; pages?: number; systems?: number; error?: string }> {
  try {
    const source = monodiSource(job.source);
    const out = await renderChantSvg(
      { document: monodiDocument(job.document), cont: job.root, source, sigle: source.quellensigle || '' },
      { settings: job.settings, pageWidthPt: job.pageWidthPt, pageHeightPt: job.pageHeightPt, apparatus: job.apparatus });
    return out;
  } catch (e: any) {
    return { error: String(e?.stack ?? e) };
  }
}
