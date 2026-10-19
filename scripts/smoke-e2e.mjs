// Smoke test: opens every page and every settings tab in a seeded workspace and fails on any
// console error or uncaught exception (change-detection loops such as NG0103 included).
// The checks run in a few browser contexts at once (each with its own seeded workspace), SMOKE_JOBS of them (default 3):
// the page loads are what takes the time. Each check still gets a fresh page load, and a context never shares storage.
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
  '/#/search', '/#/metadata', '/#/stats', '/#/import-export', '/#/manual',
  ...SETTINGS_TABS.map((t) => `/#/settings?tab=${t}`),
];

const JOBS = Math.max(1, Number(process.env.SMOKE_JOBS) || 3);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const problems = new Map();

/** One browser context with a seeded workspace, and a `note` that files a message under the check that is running. */
async function newWorker() {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const worker = { page, current: '' };
  worker.note = (msg) => { if (IGNORE.test(msg)) return; (problems.get(worker.current) || problems.set(worker.current, []).get(worker.current)).push(msg.slice(0, 220)); };
  page.on('console', (m) => {
    if (m.type() === 'error') worker.note('console: ' + m.text());
    // NG0955/NG0956: a list rebuilt all of its DOM (or tracks duplicate keys). On a table that swaps the rows out
    // from under the mouse, and the click never lands.
    else if (m.type() === 'warning' && /NG095[56]/.test(m.text())) worker.note('console: ' + m.text());
  });
  page.on('pageerror', (e) => worker.note('pageerror: ' + String(e)));
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  return worker;
}

const reload = async (page, route, timeout = 30000) => {
  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout });
  await page.reload({ waitUntil: 'networkidle0', timeout });
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// The rows of both tables must open what they show. A click that lands on a row which is replaced between press
// and release does nothing, so this goes through the real mouse (press + release), not `element.click()`.
const clickRow = (route, expectedHash) => async ({ page, note }) => {
  try {
    await reload(page, route);
    await page.waitForSelector('app-smart-table tbody tr td.td-smart-row', { timeout: 15000 });
    await tick(800);                                              // let the document counts arrive and re-render
    await (await page.$('app-smart-table tbody tr td.td-smart-row')).click();
    await page.waitForFunction((h) => location.hash === h, { timeout: 5000 }, expectedHash);
  } catch (e) { note(`click did not open ${expectedHash}: ` + String(e).split('\n')[0]); }
};

const checks = [
  ...ROUTES.map((route) => ({ label: route, run: async ({ page, note }) => {
    try {
      await reload(page, route, 40000);
      await tick(1200);                                           // let late change-detection passes run
      // A tab that renders nothing is a bug no console error will ever report (the Shortcuts pane once sat inside
      // the PDF preview column and never showed).
      if (route.startsWith('/#/settings?tab=') && !(await page.$('.tab-pane'))) note('the settings tab shows no pane');
    } catch (e) { note('navigation: ' + String(e).split('\n')[0]); }
  } })),
  // Interactions that tend to trigger change-detection errors: every switch and menu of the PDF settings
  // tab, and the print dialog of a document.
  { label: 'interaction: PDF settings controls', run: async ({ page, note }) => {
    try {
      await reload(page, '/#/settings?tab=pdf');
      const clicked = await page.evaluate(async () => {
        let n = 0;
        for (const el of document.querySelectorAll('input[type=checkbox]')) { (el).click(); n++; await new Promise((r) => setTimeout(r, 30)); }
        for (const el of document.querySelectorAll('select')) {
          const sel = el;
          for (const o of Array.from(sel.options)) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); n++; await new Promise((r) => setTimeout(r, 30)); }
        }
        return n;
      });
      await tick(1200);
      if (clicked < 10) note(`only ${clicked} controls found in the PDF tab`);
    } catch (e) { note('interaction: ' + String(e).split('\n')[0]); }
  } },
  { label: 'interaction: print dialog', run: async ({ page, note }) => {
    try {
      await reload(page, '/#/document/src1/doc-1');
      await page.waitForSelector('app-root-section', { timeout: 30000 });
      await page.evaluate(() => { const c = window.ng.getComponent(document.querySelector('app-document')); c.openPdfExport(); window.ng.applyChanges(c); });
      await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
      await tick(1200);
    } catch (e) { note('interaction: ' + String(e).split('\n')[0]); }
  } },
  { label: 'click: source row opens the source', run: clickRow('/#/sources', '#/source/src1') },
  { label: 'click: document row opens the document', run: clickRow('/#/source/src1', '#/document/src1/doc-1') },
];

const queue = [...checks];
const workers = await Promise.all(Array.from({ length: Math.min(JOBS, checks.length) }, newWorker));
await Promise.all(workers.map(async (worker) => {
  for (let check = queue.shift(); check; check = queue.shift()) {
    worker.current = check.label;
    await check.run(worker);
    console.log(problems.has(check.label) ? 'FAIL ' : 'ok   ', check.label, problems.get(check.label)?.[0] ?? '');
  }
}));

await browser.close();
process.exit(problems.size ? 1 : 0);
