// Fields an import brings, used for relations and units without copying, end to end in a real browser (metadata grid):
//  - custom values of the data that no field lists (Bezugsgesang, SpielName) are announced; "Show them" lists them as columns
//  - "Relations and units": a role reads any field (the trope's Bezugsgesang, the play's SpielName); the check counts through them
//  - "Fill a column": a play name goes into Unit ID with a change of the text, shown first, written as edits, saved with the others
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/fields-e2e.mjs [--url http://localhost:4299]
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
const root = JSON.parse(readFileSync(join(dir, readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort()[0]), 'utf8'));
const docs = ['T1', 'T2', 'AN1', 'AN2', 'P1', 'P2', 'P3'].map((label, i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1: 'Antiphon', sigle: 'Aa 13', root }));
// what a ZIP import leaves in the documents: every additionalData entry, none of it listed in the settings
const custom = {
  d0: { Bezugsgesang: 'AN1', SpielName: '' },
  d1: { Bezugsgesang: 'AN2' },
  d4: { SpielName: 'Spiel 1' },
  d5: { SpielName: 'Spiel 1' },
  d6: { SpielName: 'Spiel 2' },
};

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1500, height: 1000 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));

const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const text = (sel) => page.$eval(sel, (e) => e.textContent).then(norm);
const heads = () => page.$$eval('.mg-head', (h) => h.map((e) => e.textContent.trim()));

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  await page.evaluate(async (custom) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const list = await new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result); });
    for (const d of list) if (custom[d.id]) d.custom = custom[d.id];
    await new Promise((res) => { const t = db.transaction('monodi_data', 'readwrite'); t.objectStore('monodi_data').put(list, 'monodi_documents'); t.oncomplete = res; });
    db.close();
  }, custom);
  await page.goto(BASE + '/#/metadata', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=mg-grid]', { timeout: 20000 });

  // ── fields the data has and nobody lists ──
  const banner = await text('[data-testid=mg-unlisted]');
  expect(/2 fields/.test(banner) && /Bezugsgesang \(2\)/.test(banner) && /SpielName \(3\)/.test(banner), 'the banner names both fields and how many documents have a value: ' + banner);
  expect(!(await heads()).some((h) => /Bezugsgesang|SpielName/.test(h)), 'the fields are not columns yet');
  await page.click('[data-testid=mg-list-fields]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=mg-unlisted]'), { timeout: 10000 }).catch(() => problems.push('the banner must go once the fields are listed'));
  const listed = (await idb('monodi_settings')).customDocumentFields.map((f) => f.key);
  expect(listed.includes('Bezugsgesang') && listed.includes('SpielName'), 'both fields are stored in the settings: ' + listed);
  expect((await heads()).some((h) => /Bezugsgesang/.test(h)) && (await heads()).some((h) => /SpielName/.test(h)), 'the fields are columns now: ' + (await heads()).join('|'));

  // ── a role reads a field that is already there ──
  await page.click('[data-testid=mg-relations]');
  await page.waitForSelector('[data-testid=relations-roles]', { timeout: 20000 });
  expect(/0 documents have a related document, 0 units/.test(await text('[data-testid=relations-summary]')), 'before: nothing is read from the built-in fields: ' + await text('[data-testid=relations-summary]'));
  const optionsOfTarget = await page.$$eval('[data-testid=relations-role-target] option', (o) => o.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  expect(optionsOfTarget.some((o) => /^Bezugsgesang — 2 documents/.test(o)), 'the options say how many documents have a value: ' + optionsOfTarget.join(' | '));
  await page.select('[data-testid=relations-role-target]', 'Bezugsgesang');
  await page.select('[data-testid=relations-role-unitId]', 'SpielName');
  await page.click('[data-testid=relations-save-roles]');
  await page.waitForFunction(() => /2 documents have a related document, 2 units/.test(document.querySelector('[data-testid=relations-summary]')?.textContent ?? ''), { timeout: 10000 })
    .catch(() => problems.push('after choosing the fields the check must count 2 relations and 2 units'));
  expect(JSON.stringify((await idb('monodi_settings')).relationFields) === JSON.stringify({ target: 'Bezugsgesang', unitId: 'SpielName' }), 'only what differs from the built-in field is stored: ' + JSON.stringify((await idb('monodi_settings')).relationFields));
  // the unit of one document (Spiel 2: P3) is reported, as a unit of the built-in fields would be
  expect((await page.$('[data-testid=relations-group-unit-single]')) !== null, 'the unit "Spiel 2" has one document and is reported');
  await page.click('::-p-text(Close)');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-dialog]'), { timeout: 5000 });

  // ── fill a column from another: Spiel 1 -> play-1 in Position in unit (a column that exists) ──
  // the unit position is not a good target for text, so the built-in Unit ID column is added first
  await page.click('[data-testid=mg-relations]');
  await page.waitForSelector('[data-testid=relations-roles]', { timeout: 20000 });
  await page.click('[data-testid=relations-reset-roles]');
  await page.click('[data-testid=relations-save-roles]');
  await page.waitForSelector('[data-testid=relations-add-fields]', { timeout: 10000 });
  await page.click('[data-testid=relations-add-fields]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-add-fields]'), { timeout: 10000 });
  await page.click('::-p-text(Close)');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-dialog]'), { timeout: 5000 });
  expect((await heads()).some((h) => /Unit ID/.test(h)), 'the Unit ID column exists now: ' + (await heads()).join('|'));

  await page.click('[data-testid=mg-fill]');
  await page.waitForSelector('[data-testid=fill-dialog]', { timeout: 5000 });
  await page.select('[data-testid=fill-from]', 'custom.SpielName');
  await page.select('[data-testid=fill-to]', 'custom.unit_id');
  await page.type('[data-testid=fill-find]', 'Spiel ');
  await page.type('[data-testid=fill-replace]', 'play-');
  await page.waitForFunction(() => document.querySelector('[data-testid=fill-count]')?.textContent.trim() === '3', { timeout: 5000 })
    .catch(async () => problems.push('the preview must say 3 cells: ' + await text('[data-testid=fill-preview]')));
  const preview = await text('[data-testid=fill-preview]');
  expect(/Spiel 1\s*play-1/.test(preview) && /Spiel 2\s*play-2/.test(preview), 'the preview shows the new values: ' + preview);
  expect((await idb('monodi_documents')).every((d) => !d.custom?.unit_id), 'nothing is written by the preview');
  await page.click('[data-testid=fill-apply]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=fill-dialog]'), { timeout: 5000 });
  expect(/3/.test(await text('[data-testid=mg-dirty]')), 'the filled cells are edits, not saved yet: ' + await text('[data-testid=mg-dirty]'));
  expect((await idb('monodi_documents')).every((d) => !d.custom?.unit_id), 'nothing is stored before saving');
  // the messages of the steps before sit over the toolbar for a few seconds
  await page.waitForFunction(() => !document.querySelector('.toast-message'), { timeout: 20000 });
  await page.click('[data-testid=mg-save]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=mg-dirty]'), { timeout: 15000 }).catch(async () => problems.push('the edits must be saved; ' + norm(await page.evaluate(() => [...document.querySelectorAll('.toast-message, .mg-dirty')].map((e) => e.textContent).join(' | ')))));
  const stored = Object.fromEntries((await idb('monodi_documents')).map((d) => [d.dokumenten_id, d.custom?.unit_id]));
  expect(stored.P1 === 'play-1' && stored.P2 === 'play-1' && stored.P3 === 'play-2' && !stored.T1, 'the values are stored: ' + JSON.stringify(stored));
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   fields: unlisted fields, roles read any field, fill a column');
process.exit(problems.length ? 1 : 0);
