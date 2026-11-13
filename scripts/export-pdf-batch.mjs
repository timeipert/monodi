// Headless volume export: all documents of a Monodi ZIP as one PDF, drawn by Monodi-Zero's own PDF export.
//
//   node scripts/export-pdf-batch.mjs (--zip <monodi.zip> | --dir <folder>) --out <volume.pdf> [--job <job.json>] [--quiet]
//
// What it is for: printing a volume without clicking through the app. The PDF is what the print dialog writes for the same
// documents and choices (PdfExportService.exportDocuments); the code runs in Node, no browser is needed. The CM-hub
// repository uses it for the printed volumes of the Corpus Monodicum (`cm print pdf`, docs/PRINT-VOLUMES.md there).
//
// Input:  a ZIP in the Monodi+ layout, or a folder of the same layout: <source>/meta.json and <source>/<chant>/{meta.json,data.json}
//         (data.json = the RootContainer with the notes, meta.json = the document's metadata). Custom fields of a document
//         (`additionalData`) are read as in Monodi-Zero after an import, so a volume split, relations (relation_target,
//         unit_id …) and placeholders see them.
// Job:    --job is a JSON file that says how to print (title, cover, settings, dialog options, order of the documents); the
//         keys are explained at `VolumeJob` in scripts/lib/pdf-batch-entry.ts. Without it: the dialog defaults for several
//         documents, documents sorted by source and dokumenten_id.
// Output: the PDF, and next to it `<name>.report.json` (pages, documents, front pages, contents lines, problems).
import { build } from 'esbuild';
import JSZip from 'jszip';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const quiet = args.includes('--quiet');
if ((!zipPath && !dirPath) || !outPath || !outPath.endsWith('.pdf')) {
  console.error('usage: node scripts/export-pdf-batch.mjs (--zip <monodi.zip> | --dir <folder>) --out <volume.pdf> [--job <job.json>] [--quiet]');
  process.exit(2);
}
const job = opt('job') ? JSON.parse(readFileSync(opt('job'), 'utf8')) : {};
console.debug = () => {};   // the PDF export logs its timings for every document
if (quiet) console.log = () => {};
const say = (m) => process.stdout.write(m + '\n');

const tmp = mkdtempSync(join(tmpdir(), 'pdf-batch-'));
try {
  // 1. bundle the renderer for Node
  const bundlePath = join(tmp, 'pdf-batch.mjs');
  await build({
    entryPoints: [join(here, 'lib/pdf-batch-entry.ts')], bundle: true, outfile: bundlePath, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    // optional dependencies of jsPDF that the export never reaches (HTML and canvas rendering)
    external: ['canvg', 'html2canvas', 'dompurify'],
  });
  const { renderVolume, useAssetsFrom } = await import(pathToFileURL(bundlePath).href);
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
  const docs = [];
  for (const { meta, dataPath } of chants) docs.push({ root: JSON.parse(await files.get(dataPath)()), document: meta, source: sources.get(meta.quelle_id) ?? {} });

  // 3. draw and write
  const started = Date.now();
  const result = await renderVolume(docs, job);
  if (result.error) {
    console.error('PDF export failed: ' + result.error.split('\n').slice(0, 6).join('\n'));
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, result.pdf);
    const report = { documents: result.documents, pages: result.pages, frontPages: result.frontPages ?? 0, seconds: Math.round((Date.now() - started) / 1000),
      bytes: result.pdf.length, problems: result.notationProblems ?? [], outline: result.outline ?? [] };
    writeFileSync(outPath.replace(/\.pdf$/, '.report.json'), JSON.stringify(report, null, 1));
    say(`PDF: ${report.documents} documents, ${report.pages} pages, ${(report.bytes / 1e6).toFixed(1)} MB, ${report.seconds} s -> ${outPath}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
