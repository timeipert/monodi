// Headless MEI export: writes one MEI file per document of a Monodi ZIP, using the same emitter as the export button
// of Monodi-Zero (a headless Chrome supplies the DOM the emitter needs).
//
//   node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip> [--level 1|2|3] [--publication <json>] [--limit <n>]
//
// Input:  a ZIP in the Monodi+ layout (<source>/meta.json, <source>/<document>/meta.json + data.json), for example the
//         output of `cm zero package` in the CM-hub repository.
// Output: a ZIP with `<document id>.mei.xml` for every document, and `report.json` (counts and per-document errors).
// Header: the level decides how much of the shared mapping the <meiHead> follows (docs/METADATA-STANDARDS.md in CM-hub).
//         Without --publication the Corpus Monodicum values of the shared mapping are used; a licence is not set, so the
//         files are marked as drafts.
// Chrome: CHROME_BIN, or the usual macOS / Linux locations.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import JSZip from 'jszip';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const zipPath = opt('zip');
const outPath = opt('out');
const level = Number(opt('level', '2'));
const limit = Number(opt('limit', '0'));
if (!zipPath || !outPath || ![1, 2, 3].includes(level)) {
  console.error('usage: node scripts/export-mei-batch.mjs --zip <monodi.zip> --out <mei.zip> [--level 1|2|3] [--publication <json>] [--limit <n>]');
  process.exit(2);
}

function findChrome() {
  const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found. Set CHROME_BIN to a Chrome or Chromium executable.');
  return found;
}

// 1. bundle the emitter for the browser
const bundle = await build({
  entryPoints: [join(here, 'lib/mei-batch-entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  logLevel: 'warning'
});
const script = bundle.outputFiles[0].text;

// 2. read the Monodi ZIP: a meta.json next to a data.json is a document, any other meta.json is a source
const input = await JSZip.loadAsync(readFileSync(zipPath));
const metas = Object.keys(input.files).filter((n) => n.endsWith('/meta.json') && !n.includes('__MACOSX'));
const sources = new Map();
const documents = [];
for (const name of metas) {
  const folder = name.slice(0, -'meta.json'.length);
  const meta = JSON.parse(await input.file(name).async('string'));
  if (input.file(folder + 'data.json')) documents.push({ meta, dataPath: folder + 'data.json' });
  else sources.set(meta.id, meta);
}
documents.sort((a, b) => String(a.meta.dokumenten_id).localeCompare(String(b.meta.dokumenten_id)) || String(a.meta.id).localeCompare(String(b.meta.id)));
const jobs = limit > 0 ? documents.slice(0, limit) : documents;

// 3. run the emitter in headless Chrome
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: script });
const publication = opt('publication')
  ? JSON.parse(readFileSync(opt('publication'), 'utf8'))
  : await page.evaluate(() => window.__mei.defaultPublication());
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const output = new JSZip();
const errors = [];
let written = 0;
const started = Date.now();
for (const [i, { meta, dataPath }] of jobs.entries()) {
  const rootContainer = JSON.parse(await input.file(dataPath).async('string'));
  const source = sources.get(meta.quelle_id) ?? {};
  const result = await page.evaluate((job) => window.__mei.exportOne(job),
    { root: rootContainer, document: meta, source, level, publication, appVersion, now: new Date().toISOString() });
  if (result.xml) { output.file(`${meta.id}.mei.xml`, result.xml); written++; }
  else errors.push({ id: meta.id, dokumenten_id: meta.dokumenten_id, error: result.error });
  if ((i + 1) % 500 === 0) console.log(`  ${i + 1} of ${jobs.length}`);
}
await browser.close();

output.file('report.json', JSON.stringify({ level, documents: jobs.length, written, errors, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`MEI: ${written} of ${jobs.length} documents written to ${outPath}, ${errors.length} errors`);
process.exit(errors.length && !written ? 1 : 0);
