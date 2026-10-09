// Benchmark: prints N documents (the real fixtures, repeated) as one PDF through the real UI
// and reports where the time went. Fails when it takes more than --max-ms-per-doc (default 300;
// it was ~560 before the export ran outside Angular's zone, ~60 now).
// Run: node scripts/pdf-perf.mjs [N=40] [--max-ms-per-doc 300] [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const maxIdx = args.indexOf('--max-ms-per-doc');
const MAX_PER_DOC = maxIdx >= 0 ? Number(args.splice(maxIdx, 2)[1]) : 300;
const N = Number(args[0] || 40);
const dir = join(here, '../src/app/testdata');
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f.includes('__'));
const roots = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
let uid = 0;
const fresh = (root) => JSON.parse(JSON.stringify(root), (k, v) => (k === 'uuid' && typeof v === 'string' ? `p${++uid}-${v}` : v));
const syllables = (c) => (c?.kind === 'Syllable' ? 1 : 0) + (c?.children || []).reduce((a, k) => a + syllables(k), 0);
const docs = Array.from({ length: N }, (_, i) => {
  const root = fresh(roots[i % roots.length]);
  return { id: `perf-${i}`, label: `Perf ${String(i + 1).padStart(3, '0')}`, incipit: `Document ${i + 1}`, genre1: 'Antiphon', root };
});
const total = docs.reduce((a, d) => a + syllables(d.root), 0);
const out = join(here, '../scratch/compare/perf.pdf');
mkdirSync(dirname(out), { recursive: true });

const watchdog = setTimeout(() => { console.log('timed out'); process.exit(2); }, 900000);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
let timings = null;
page.on('console', (m) => { const t = m.text(); if (t.includes('[pdf-export]')) timings = JSON.parse(t.replace(/^.*\[pdf-export\]\s*/, '')); });
let resolveDl; const dl = new Promise((r) => (resolveDl = r));
await capturePdfDownloads(page, (buf) => { writeFileSync(out, buf); resolveDl(buf.length); });
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, docs, {});
await page.goto(BASE + '/#/source/src1?tab=documents', { waitUntil: 'networkidle0' });
await page.reload({ waitUntil: 'networkidle0' });
const btn = await page.waitForSelector('button ::-p-text(Print manuscript)', { timeout: 60000 });
await btn.click();
await page.waitForSelector('app-pdf-export-dialog');
const create = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
const t0 = Date.now();
await create.click();
const bytes = await dl;
const wall = Date.now() - t0;
console.log(JSON.stringify({ documents: N, syllables: total, wallMs: wall, perDocMs: Math.round(wall / N), pdfKB: Math.round(bytes / 1024), phases: timings?.ms }, null, 1));
clearTimeout(watchdog);
const slow = wall / N > MAX_PER_DOC;
console.log(slow ? `FAIL  ${Math.round(wall / N)} ms per document (limit ${MAX_PER_DOC})` : `ok    ${Math.round(wall / N)} ms per document (limit ${MAX_PER_DOC})`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(slow ? 1 : 0);
