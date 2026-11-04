// Headless SVG export: one compact SVG picture per chant, drawn by Monodi-Zero's own PDF export.
//
//   node scripts/export-svg-batch.mjs (--zip <monodi.zip> | --dir <folder>) --out <svg.zip | folder>
//        [--settings <json>] [--page-width <pt>] [--limit <n>] [--only <text>] [--quiet]
//
// What it is for: the static pages of the Corpus Monodicum dataset show the notation of each chant. The picture is the
// chant as the PDF export of Monodi-Zero sets it (same systems, clefs, staff lines, neume outlines, lyrics, rubrics, spacing):
// the real export lays the chant out, and the drawing calls of its PDF document are written as SVG (src/app/print/chant-svg.ts,
// src/app/print/svg-recorder.ts). No browser is needed; the code runs in Node.
//
// Input:  a ZIP in the Monodi+ layout, or a folder of the same layout: <source>/meta.json and <source>/<chant>/{meta.json,data.json}
//         (data.json = the RootContainer with the notes, meta.json = the document's metadata). The ZIP of `cm zero package` in
//         the CM-hub repository is such a ZIP.
// Output: `<source>/<chant>/<chant>.svg` for every chant (<source> = `quelle_id`, <chant> = `id` of the document, as in the input
//         and in the file names of the MEI export), and `report.json` (per chant: dokumenten_id, size, gzip size, pages, systems;
//         errors). --out ending in .zip writes a ZIP, anything else a folder.
// SVG:    viewBox in pt, `fill="currentColor"`, staff lines and outlines in `currentColor`, so the page's CSS colour themes it;
//         outlines used twice or more are defined once in <defs> and placed with <use>; text is plain <text> in the font family
//         "Crimson Text" (the PDF font) with Georgia/serif as fallback. Load Crimson Text in the page for the exact spacing.
// Settings: --settings is a JSON file of print settings (same keys as the PDF settings of Monodi-Zero: pdfScale, pdfFontSize,
//         clefDisplayMode, notationColor …). Default: the print-edition defaults. --page-width: width of the page in pt (default
//         595.28); systems wrap at its right margin as in the PDF.
import { build } from 'esbuild';
import JSZip from 'jszip';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const zipPath = opt('zip');
const dirPath = opt('dir');
const outPath = opt('out');
const limit = Number(opt('limit', '0'));
const only = opt('only');
const quiet = args.includes('--quiet');
if ((!zipPath && !dirPath) || !outPath) {
  console.error('usage: node scripts/export-svg-batch.mjs (--zip <monodi.zip> | --dir <folder>) --out <svg.zip | folder> [--settings <json>] [--page-width <pt>] [--limit <n>] [--only <text>]');
  process.exit(2);
}
console.debug = () => {};   // the PDF export logs its timings for every document
const settings = opt('settings') ? JSON.parse(readFileSync(opt('settings'), 'utf8')) : null;
const pageWidthPt = opt('page-width') ? Number(opt('page-width')) : undefined;

// 1. bundle the renderer for Node
const tmp = mkdtempSync(join(tmpdir(), 'svg-batch-'));
try {
  const bundlePath = join(tmp, 'svg-batch.mjs');
  await build({
    entryPoints: [join(here, 'lib/svg-batch-entry.ts')], bundle: true, outfile: bundlePath, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    // optional dependencies of jsPDF that the export never reaches (HTML and canvas rendering)
    external: ['canvg', 'html2canvas', 'dompurify'],
  });
  const { renderOne, useAssetsFrom } = await import(pathToFileURL(bundlePath).href);
  useAssetsFrom(join(root, 'src'));

  // 2. read the input: a meta.json next to a data.json is a chant, any other meta.json is a source
  const files = new Map();   // path -> async () => string
  if (zipPath) {
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    for (const name of Object.keys(zip.files)) if (!zip.files[name].dir && !name.includes('__MACOSX')) files.set(name, () => zip.file(name).async('string'));
  } else {
    const walk = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name), rel + e.name + '/');
        else files.set(rel + e.name, async () => readFileSync(join(d, e.name), 'utf8'));
      }
    };
    walk(resolve(dirPath), '');
  }
  const sources = new Map();
  const chants = [];
  for (const name of [...files.keys()].filter((n) => n.endsWith('meta.json'))) {
    const folder = name.slice(0, -'meta.json'.length);
    const meta = JSON.parse(await files.get(name)());
    if (files.has(folder + 'data.json')) chants.push({ meta, dataPath: folder + 'data.json' });
    else sources.set(meta.id, meta);
  }
  chants.sort((a, b) => String(a.meta.quelle_id).localeCompare(String(b.meta.quelle_id)) || String(a.meta.dokumenten_id).localeCompare(String(b.meta.dokumenten_id)) || String(a.meta.id).localeCompare(String(b.meta.id)));
  let jobs = only ? chants.filter((c) => String(c.meta.dokumenten_id).includes(only) || String(c.meta.id).includes(only)) : chants;
  if (limit > 0) jobs = jobs.slice(0, limit);

  // 3. draw
  const output = new Map();   // path -> svg
  const report = [];
  const errors = [];
  const started = Date.now();
  for (const [i, { meta, dataPath }] of jobs.entries()) {
    const result = await renderOne({ root: JSON.parse(await files.get(dataPath)()), document: meta, source: sources.get(meta.quelle_id) ?? {}, settings, pageWidthPt });
    if (result.svg) {
      const file = `${meta.quelle_id}/${meta.id}/${meta.id}.svg`;
      output.set(file, result.svg);
      report.push({ id: meta.id, dokumenten_id: meta.dokumenten_id, file, bytes: Buffer.byteLength(result.svg), gzip: gzipSync(result.svg).length, pages: result.pages, systems: result.systems });
    } else {
      errors.push({ id: meta.id, dokumenten_id: meta.dokumenten_id, error: (result.error ?? 'empty drawing (the chant has no notation)').split('\n').slice(0, 4).join(' | ') });
    }
    if (!quiet && (i + 1) % 250 === 0) console.log(`  ${i + 1} of ${jobs.length}`);
  }
  const gz = report.map((r) => r.gzip).sort((a, b) => a - b);
  const sum = { chants: jobs.length, written: report.length, errors: errors.length, seconds: Math.round((Date.now() - started) / 1000),
    totalBytes: report.reduce((a, r) => a + r.bytes, 0), totalGzip: gz.reduce((a, b) => a + b, 0), gzipMedian: gz[Math.floor(gz.length / 2)] ?? 0, gzipP95: gz[Math.floor(gz.length * 0.95)] ?? 0, gzipMax: gz[gz.length - 1] ?? 0 };
  const reportJson = JSON.stringify({ ...sum, errorList: errors, files: report }, null, 1);

  // 4. write
  if (outPath.endsWith('.zip')) {
    const out = new JSZip();
    for (const [p, svg] of output) out.file(p, svg);
    out.file('report.json', reportJson);
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  } else {
    for (const [p, svg] of output) { mkdirSync(dirname(join(outPath, p)), { recursive: true }); writeFileSync(join(outPath, p), svg); }
    mkdirSync(outPath, { recursive: true });
    writeFileSync(join(outPath, 'report.json'), reportJson);
  }
  console.log(`SVG: ${sum.written} of ${sum.chants} chants written to ${outPath}, ${sum.errors} without picture; gzip per chant: median ${sum.gzipMedian} B, 95% ${sum.gzipP95} B, max ${sum.gzipMax} B; ${sum.seconds} s`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e.dokumenten_id ?? e.id}: ${e.error}`);
  process.exitCode = errors.length && !report.length ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
