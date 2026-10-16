// Typography check of a big print: all fixtures (real and extreme) in three manuscripts are printed as
// one PDF through the print dialog, and the page-break rules are checked on where the exporter
// placed things (stats.placement):
//  - a document's heading, metadata and rubrics stand on the page of its first system
//  - a line of notes with several systems is not split so that a single system is left alone
//    at the bottom or the top of a page (lines of up to three systems stay together)
//  - an apparatus heading stands on the page of its first entry
// Run: node scripts/layout-e2e.mjs [--url http://localhost:4299] [--break-rules-off to see the check fail]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'layout-big-print.pdf');
const dir = join(here, '../src/app/testdata');
const fixtures = [];
for (const sub of ['', 'extreme']) {
  for (const f of readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort()) {
    fixtures.push({ name: f.replace(/\.json$/, '').slice(0, 24), root: JSON.parse(readFileSync(join(dir, sub, f), 'utf8')) });
  }
}
const SOURCES = [['srcA', 'Ms A 1'], ['srcB', 'Ms B 2'], ['srcC', 'Ms C 3']];
const docs = [];
SOURCES.forEach(([source, sigle], si) => fixtures.forEach((fx, i) => {
  // vary the order per manuscript so that the headings meet different page positions
  const k = (i * (si + 2) + si * 7) % fixtures.length;
  docs.push({ id: `d-${si}-${i}`, label: `${sigle.split(' ')[1]}${si + 1}-${String(i + 1).padStart(2, '0')}`, incipit: fixtures[k].name, genre1: 'Test', source, sigle, root: fixtures[k].root });
}));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const problems = [];
page.on('console', (m) => { if (process.env.KEEPDBG && /KEEPDBG/.test(m.text())) console.log(m.text()); });
page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 160)));
let resolveDl; const dl = new Promise((r) => (resolveDl = r));
await capturePdfDownloads(page, (buf) => { writeFileSync(out, buf); resolveDl(); });
try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, args.includes('--break-rules-off') ? { __noKeep: true } : {});
  await page.goto(BASE + '/#/search', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('app-search', { timeout: 30000 });
  await page.evaluate((ids) => { const c = window.ng.getComponent(document.querySelector('app-search')); c.pdfDialog.open({ ids, title: 'Layout test' }); window.ng.applyChanges(c); }, docs.map((d) => d.id));
  await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
  await page.waitForFunction((n) => (document.querySelector('app-pdf-export-dialog')?.querySelectorAll('ol li').length || 0) >= n, { timeout: 30000 }, docs.length);
  await page.evaluate(() => { window.__svc = window.ng.getComponent(document.querySelector('app-pdf-export-dialog')).pdf; });
  const btn = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
  await btn.click();
  await Promise.race([dl, new Promise((_, rej) => setTimeout(() => rej(new Error('no download')), 240000))]);
  const stats = await page.evaluate(() => JSON.parse(JSON.stringify(window.__svc.lastStats)));
  const pl = stats.placement;
  if (!pl.documents.length) problems.push('no placement stats recorded');

  // 1. heading and first system on one page
  const split = pl.documents.filter((d) => d.head !== d.firstSystem);
  for (const d of split.slice(0, 8)) problems.push(`document ${d.job}: heading on page ${d.head}, first system on page ${d.firstSystem}`);
  if (split.length > 8) problems.push(`... and ${split.length - 8} more headings separated from their first system`);

  // 1b. rubrics and headings queued in front of a line stand on the page of its first system
  const orphanLead = pl.lines.filter((l) => l.leadPage && l.pages.length && l.leadPage !== l.pages[0]);
  for (const l of orphanLead.slice(0, 8)) problems.push(`rubric/heading before a line of document ${l.job} on page ${l.leadPage}, its first system on page ${l.pages[0]}`);
  if (orphanLead.length > 8) problems.push(`... and ${orphanLead.length - 8} more rubrics separated from their line`);

  // 2. lines of notes: no single system alone at the bottom or the top of a page
  let lineIssues = 0;
  for (const l of pl.lines) {
    const n = l.pages.length;
    if (n < 2) continue;
    const counts = new Map();
    for (const p of l.pages) counts.set(p, (counts.get(p) || 0) + 1);
    if (counts.size > 1 && [...counts.values()].some((c) => c < 2)) {
      if (++lineIssues <= 8) problems.push(`line of ${n} systems in document ${l.job} split over pages ${[...counts].map(([p, c]) => `${p}:${c}`).join(' ')}`);
    }
  }
  if (lineIssues > 8) problems.push(`... and ${lineIssues - 8} more split lines`);

  // 3. apparatus headings with their first entry
  const apSplit = pl.apparatus.filter((a) => a.head !== a.entry);
  for (const a of apSplit.slice(0, 8)) problems.push(`apparatus of document ${a.job}: heading on page ${a.head}, first entry on page ${a.entry}`);
  console.log(`checked ${pl.documents.length} documents, ${pl.lines.length} lines (${pl.lines.filter((l) => l.pages.length > 1).length} with several systems), ${pl.apparatus.length} apparatus parts, ${stats.pages} pages`);
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}
console.log(problems.length ? 'FAIL ' : 'ok   ', 'typography of a big print', problems.join('\n      '));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);   // closing a browser that just made a big PDF can hang
process.exit(problems.length ? 1 : 0);
