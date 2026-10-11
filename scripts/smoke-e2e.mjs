// Smoke test: opens every page and every settings tab in a seeded workspace and fails on any
// console error or uncaught exception (change-detection loops such as NG0103 included).
// Run: node scripts/smoke-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedWorkspace } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const dir = join(here, '../src/app/testdata');
const load = (prefix, sub = '') => JSON.parse(readFileSync(join(dir, sub, readdirSync(join(dir, sub)).find((f) => f.startsWith(prefix) && f.endsWith('.json'))), 'utf8'));
const docs = [
  { id: 'doc-1', label: 'Abb 7-12r-1', incipit: 'Gratuletur omnis caro', genre1: 'Antiphon', root: load('Abb_7') },
  { id: 'doc-2', label: 'Abb 7-12v-1', incipit: 'Apparatus forms', genre1: 'Responsorium', root: load('x15', 'extreme') },
];
// noise that is not ours: browser policy messages about `unload` handlers in a library
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const SETTINGS_TABS = ['metadata', 'containers', 'editor', 'shortcuts', 'pdf', 'mei', 'htmlExport', 'github', 'workspace'];
const ROUTES = [
  '/#/sources', '/#/source', '/#/source/src1', '/#/source/src1?tab=notation', '/#/source/src1?tab=description',
  '/#/document/src1/doc-1', '/#/document/src1/doc-2', '/#/document/src1',
  '/#/search', '/#/stats', '/#/import-export', '/#/manual',
  ...SETTINGS_TABS.map((t) => `/#/settings?tab=${t}`),
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1400, height: 1000 });
let current = '';
const problems = new Map();
const note = (msg) => { if (IGNORE.test(msg)) return; (problems.get(current) || problems.set(current, []).get(current)).push(msg.slice(0, 220)); };
page.on('console', (m) => { if (m.type() === 'error') note('console: ' + m.text()); });
page.on('pageerror', (e) => note('pageerror: ' + String(e)));

await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, docs, {});
for (const route of ROUTES) {
  current = route;
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 40000 });
    await page.reload({ waitUntil: 'networkidle0', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 1200));    // let late change-detection passes run
  } catch (e) { note('navigation: ' + String(e).split('\n')[0]); }
  console.log(problems.has(route) ? 'FAIL ' : 'ok   ', route, problems.get(route)?.[0] ?? '');
}
// Interactions that tend to trigger change-detection errors: every switch and menu of the PDF settings
// tab, and the print dialog of a document.
current = 'interaction: PDF settings controls';
try {
  await page.goto(BASE + '/#/settings?tab=pdf', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  const clicked = await page.evaluate(async () => {
    let n = 0;
    for (const el of document.querySelectorAll('input[type=checkbox]')) { (el).click(); n++; await new Promise((r) => setTimeout(r, 30)); }
    for (const el of document.querySelectorAll('select')) {
      const sel = el;
      for (const o of Array.from(sel.options)) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); n++; await new Promise((r) => setTimeout(r, 30)); }
    }
    return n;
  });
  await new Promise((r) => setTimeout(r, 1200));
  if (clicked < 10) note(`only ${clicked} controls found in the PDF tab`);
} catch (e) { note('interaction: ' + String(e).split('\n')[0]); }
console.log(problems.has(current) ? 'FAIL ' : 'ok   ', current, problems.get(current)?.[0] ?? '');

current = 'interaction: print dialog';
try {
  await page.goto(BASE + '/#/document/src1/doc-1', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('app-root-section', { timeout: 30000 });
  await page.evaluate(() => { const c = window.ng.getComponent(document.querySelector('app-document')); c.openPdfExport(); window.ng.applyChanges(c); });
  await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1200));
} catch (e) { note('interaction: ' + String(e).split('\n')[0]); }
console.log(problems.has(current) ? 'FAIL ' : 'ok   ', current, problems.get(current)?.[0] ?? '');

await browser.close();
process.exit(problems.size ? 1 : 0);
