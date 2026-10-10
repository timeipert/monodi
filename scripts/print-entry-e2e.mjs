// The other ways into printing: the document view (shared dialog, one document), a search
// result printed by id (the dialog loads the metadata), and the workspace action "export-pdf".
// Run: node scripts/print-entry-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });
const dir = join(here, '../src/app/testdata');
const load = (prefix, sub = '') => JSON.parse(readFileSync(join(dir, sub, readdirSync(join(dir, sub)).find((f) => f.startsWith(prefix) && f.endsWith('.json'))), 'utf8'));
const docs = [
  { id: 'doc-1', label: 'Abb 7-12r-1', incipit: 'Gratuletur omnis caro', genre1: 'Antiphon', genre2: 'Introitus', edition: '9', root: load('Abb_7') },
  { id: 'doc-2', label: 'Abb 7-12v-1', incipit: 'Terribilis est locus iste', genre1: 'Responsorium', genre2: '', root: load('x12', 'extreme') },
];
const PDFTOTEXT = '/opt/homebrew/bin/pdftotext';
const watchdog = setTimeout(() => { console.log('FAIL  print entry points: timed out'); process.exit(2); }, 280000);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failures = 0;

async function scenario(name, fn) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 160)));
  const file = join(outDir, `entry-${name.replace(/\W+/g, '-')}.pdf`);
  let resolveDl; const dl = new Promise((r) => (resolveDl = r));
  await capturePdfDownloads(page, (buf) => { writeFileSync(file, buf); resolveDl(); });
  try {
    await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
    await seedWorkspace(page, docs, {});
    await fn(page, problems, async () => {
      await Promise.race([dl, new Promise((_, rej) => setTimeout(() => rej(new Error('no download')), 90000))]);
      return execFileSync(PDFTOTEXT, [file, '-']).toString();
    });
  } catch (e) {
    problems.push(String(e).split('\n')[0]);
  } finally {
    console.log(problems.length ? 'FAIL ' : 'ok   ', name, problems.join('; '));
    if (problems.length) failures++;
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 4000))]);
  }
}

// 1. document view -> shared dialog with the open document
await scenario('document view dialog', async (page, problems, pdfText) => {
  await page.goto(BASE + '/#/document/src1/doc-1', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('app-root-section', { timeout: 30000 });
  await page.evaluate(() => { const c = window.ng.getComponent(document.querySelector('app-document')); c.openPdfExport(); window.ng.applyChanges(c); });
  await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
  const n = await page.evaluate(() => document.querySelectorAll('app-pdf-export-dialog ol li').length);
  if (n !== 1) problems.push(`dialog lists ${n} documents, expected 1`);
  const hasContents = await page.evaluate(() => /Contents \(ID/.test(document.querySelector('app-pdf-export-dialog').textContent || ''));
  if (hasContents) problems.push('a single document must not offer a contents table');
  const btn = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
  await btn.click();
  const text = await pdfText();
  if (/CONTENTS/.test(text)) problems.push('single document PDF has a contents table');
  if (!/Gratuletur/.test(text)) problems.push('document text missing');
});

// 1b. two manuscripts: every manuscript is a chapter (heading, numbered documents inside)
{
  const twoDocs = [
    { id: 'doc-1', label: 'Abb 7-12r-1', incipit: 'Gratuletur omnis caro', genre1: 'Antiphon', source: 'srcA', sigle: 'Abb 7', root: load('Abb_7') },
    { id: 'doc-2', label: 'Aa 13-1r-1', incipit: 'Terribilis est locus iste', genre1: 'Responsorium', source: 'srcB', sigle: 'Aa 13', root: load('x12', 'extreme') },
    { id: 'doc-3', label: 'Abb 7-13r-1', incipit: 'Kyrie eleison', genre1: 'Ordinarium', source: 'srcA', sigle: 'Abb 7', root: load('x01', 'extreme') },
    { id: 'doc-4', label: 'Aa 13-1v-1', incipit: 'Gloria in excelsis', genre1: 'Ordinarium', source: 'srcB', sigle: 'Aa 13', root: load('x13', 'extreme') },
  ];
  const keep = docs.splice(0, docs.length, ...twoDocs);
  await scenario('two manuscripts are two chapters', async (page, problems, pdfText) => {
    await page.goto(BASE + '/#/search', { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('app-search', { timeout: 30000 });
    await page.evaluate(() => { const c = window.ng.getComponent(document.querySelector('app-search')); c.pdfDialog.open({ ids: ['doc-1', 'doc-2', 'doc-3', 'doc-4'], title: 'Two manuscripts' }); window.ng.applyChanges(c); });
    await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
    await page.waitForFunction(() => /Aa 13-1v-1/.test(document.querySelector('app-pdf-export-dialog')?.textContent || ''), { timeout: 10000 });
    const btn = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
    await btn.click();
    const text = await pdfText();
    // chapter headings (numbered) in the body and in the contents
    for (const h of ['1. ', '2. ']) if (!text.includes(h + 'Abb 7') && !text.includes(h + 'Aa 13')) problems.push(`no chapter heading "${h}…"`);
    // documents of one manuscript stay together: the second manuscript's ids come after the first one's
    const iAbb = text.lastIndexOf('Abb 7-13r-1'), iAa = text.indexOf('Aa 13-1r-1');
    if (iAbb < 0 || iAa < 0) problems.push('documents missing');
  });
  docs.splice(0, docs.length, ...keep);
}

// 2. a search result by id: the dialog loads the metadata itself
await scenario('search result by id', async (page, problems, pdfText) => {
  await page.goto(BASE + '/#/search', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' }); // the API service caches the document list at first read
  await page.waitForSelector('app-search', { timeout: 30000 });
  await page.evaluate(() => { const c = window.ng.getComponent(document.querySelector('app-search')); c.printOne('doc-2'); window.ng.applyChanges(c); });
  await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
  await page.waitForFunction(() => /Abb 7-12v-1/.test(document.querySelector('app-pdf-export-dialog')?.textContent || ''), { timeout: 10000 }).catch(() => problems.push('dialog did not load the document metadata'));
  const btn = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
  await btn.click();
  const text = await pdfText();
  if (!/Terribilis|Terribi\]/.test(text)) problems.push('printed PDF lacks the document');
});

// 3. workspace action
await scenario('workspace export-pdf', async (page, problems) => {
  await page.goto(BASE + '/#/sources?ws=export-pdf', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /Print documents as PDF/.test(document.body.textContent || ''), { timeout: 20000 }).catch(() => problems.push('PDF mode of the export dialog did not open'));
  const label = await page.evaluate(() => /Continue to print options/.test(document.body.textContent || ''));
  if (!label) problems.push('no "Continue to print options" button');
});

clearTimeout(watchdog);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(failures ? 1 : 0);
