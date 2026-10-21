// The notation set, end to end in the browser: Settings → Notation Set (the standard set and the order of
// the rows), and a manuscript's Notation Documentation → Table & Tree (restrict / extend the set, the table,
// the neume tree). A Neume Viewer file is imported first, so the manuscript has line regions and snippets.
// Needs a dev server (npm start, port 4299) or --url. Fresh headless-Chrome profile.
// Run: node scripts/notation-set-e2e.mjs [--url http://localhost:4299] [--shots <folder>]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedWorkspace } from './lib/e2e-common.mjs';
import { interceptIiif, writeFixture } from './lib/notation-fixture.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const BASE = opt('--url', 'http://localhost:4299');
const SHOTS = opt('--shots', '');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { file: fixtureFile } = writeFixture();

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|Permissions policy|Failed to load resource/i.test(m.text())) problems.push('console ' + m.type() + ': ' + m.text().slice(0, 300)); });
page.on('dialog', (d) => d.accept());   // "leave the page?" after an edit
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
await interceptIiif(page);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const text = (sel) => page.$eval(sel, (e) => e.innerText);
const count = (sel) => page.$$eval(sel, (l) => l.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const note = { uuid: 'n1', noteType: 'Normal', base: 'D', liquescent: false, octave: 4, focus: false };
const root = { kind: 'RootContainer', uuid: 'root', documentType: 'Level1', comments: [], children: [{ kind: 'ZeileContainer', uuid: 'z', children: [{ uuid: 's', kind: 'Syllable', text: 'tes', syllableType: 'Normal', notes: { spaced: [{ nonSpaced: [{ grouped: [note] }] }] } }] }] };

await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, [{ id: 'doc0', label: 'Fix 1-1', sigle: 'Fix 1', source: 'src0', root }]);
await page.reload({ waitUntil: 'networkidle0' });

// ── import the Neume Viewer file ────────────────────────────────────────────────────────────────
await (await page.$('#importAnnotationsFile')).uploadFile(fixtureFile);
await page.waitForFunction(() => /Import annotations/.test(document.body.innerText), { timeout: 15000 });
const [importBtn] = await page.$$('xpath/.//button[contains(., "Import")]');
await importBtn.click();
await page.waitForFunction(() => !/Import annotations/.test(document.body.innerText), { timeout: 15000 });
await sleep(600);

// ── Settings → Notation Set ─────────────────────────────────────────────────────────────────────
await page.goto(BASE + '/#/settings?tab=notation', { waitUntil: 'networkidle0' });
await page.waitForSelector('#standard-set-table', { timeout: 15000 });
const defaultRows = await count('#standard-set-table tbody tr');
expect(defaultRows === 14, `the default standard set has 14 patterns, the page shows ${defaultRows}`);
const codes = await page.$$eval('#standard-set-table tbody tr td:nth-child(2) code', (l) => l.map((e) => e.innerText));
expect(codes[0] === '*' && codes.indexOf('*dd') < codes.indexOf('[*ud]') && codes.indexOf('[*ud]') < codes.indexOf('[*du]') && codes.indexOf('[*du]') < codes.indexOf('[*dL]'),
  'the standard set is shown in the order of the neume table (* … *dd, *ud, *du … then the liquescents): ' + codes.join(' '));
await shot('settings-notation-set');

// extend: a pattern from the library, found by its signature
await page.type('#standard-set-search', '*udd');
await page.waitForSelector('#standard-set-search ~ .list-group .list-group-item', { timeout: 5000 });
await page.click('#standard-set-search ~ .list-group .list-group-item');
await sleep(300);
expect(await count('#standard-set-table tbody tr') === 15, 'a pattern chosen from the library should join the standard set');
// its usual Reference ID
const row = await page.evaluateHandle(() => [...document.querySelectorAll('#standard-set-table tbody tr')].find((tr) => tr.querySelector('code')?.innerText.replace(/[\[\]]/g, '').endsWith('udd')));
await (await row.asElement().$('input')).type('55');
// restrict: take `*dd` out
await page.evaluate(() => { const tr = [...document.querySelectorAll('#standard-set-table tbody tr')].find((t) => t.querySelector('code')?.innerText === '*dd'); tr.querySelector('button').click(); });
await sleep(1200);
const saved = await idb('monodi_settings');
expect(saved && Array.isArray(saved.notationStandard) && saved.notationStandard.length === 14, 'the standard set should be saved in the settings: ' + JSON.stringify(saved?.notationStandard?.length));
expect(saved?.notationStandard?.some((e) => e.pattern.replace(/[\[\]]/g, '').endsWith('udd') && e.refId === '55'), 'its ID should be saved');
expect(!saved?.notationStandard?.some((e) => e.pattern === '*dd'), 'the removed pattern should be gone');

// the order: by Reference ID (the default), or only as the neume table
expect(await page.$eval('#orderId', (e) => e.checked), 'the default order is by Reference ID');
await page.click('#orderNeume');
await sleep(1200);
expect((await idb('monodi_settings'))?.notationOrder === 'neume', 'the order should be saved');
await page.click('#orderId');
await sleep(1200);
expect((await idb('monodi_settings'))?.notationOrder === 'id', 'the order should be saved again');

// ── the manuscript: Notation Documentation → Table & Tree ───────────────────────────────────────
await page.goto(BASE + '/#/source/src0?tab=notation&ntab=table', { waitUntil: 'networkidle0' });
await page.waitForSelector('#nd-table', { timeout: 15000 });
let tableText = await text('#nd-table');
expect(/21/.test(tableText) && /8 \/ 6/.test(tableText) && /9v \/ 2/.test(tableText), 'the table shows IDs and places: ' + tableText.replace(/\s+/g, ' ').slice(0, 200));
expect(!/\b30\b/.test(tableText), 'the removed standard pattern (*dd, ID 30) is not in the table');
expect(/\b55\b/.test(tableText) === false || true, '');   // *udd has no ID in this manuscript's table: the standard's ID 55 is shown
expect(/55/.test(tableText), 'a pattern without an own table row takes the ID of the standard set (55)');
await shot('source-table');

// restrict this manuscript: take `*` out (Data view lists every pattern with a checkbox), then the table has no row 10
await page.click('#nd-view-data');
await page.waitForSelector('#nd-data-patterns');
const tick = async (pattern, on) => page.evaluate((pattern, on) => {
  const tr = [...document.querySelectorAll('#nd-data-patterns tbody tr')].find((t) => t.querySelector('code')?.innerText === pattern);
  const box = tr.querySelector('input[type=checkbox]');
  if (box.checked !== on) box.click();
}, pattern, on);
await tick('*', false);
await sleep(1000);
await page.click('#nd-view-table');
await page.waitForSelector('#nd-table');
const src = (await idb('monodi_sources')).find((s) => s.id === 'src0');
const set = JSON.parse(src.custom?.notationSet ?? '{}');
expect(Array.isArray(set.remove) && set.remove.includes('*'), 'the manuscript keeps what it removed: ' + JSON.stringify(src.custom));
tableText = await text('#nd-table');
expect(!(await page.$$eval('#nd-table .nd-id', (l) => l.map((e) => e.innerText.trim()))).includes('10'), 'the removed pattern is out of the table');

// extend: a pattern only this manuscript shows, typed
await page.type('#nd-add', '*ddu');
await page.keyboard.press('Enter');
await sleep(1000);
const src2 = (await idb('monodi_sources')).find((s) => s.id === 'src0');
expect(JSON.parse(src2.custom.notationSet).add.includes('*ddu'), 'the manuscript keeps what it added: ' + JSON.stringify(src2.custom));
await shot('source-set');

// the tree
await page.click('#nd-view-tree');
await page.waitForSelector('#nd-tree');
const nodes = await page.$$eval('#nd-tree .nd-node code', (l) => l.map((e) => e.innerText));
expect(nodes.includes('*ddu') && nodes.includes('[*du]') && nodes.includes('[*dL]'), 'the tree has a box for each pattern shown: ' + nodes.join(' '));
expect(!nodes.includes('*'), 'the removed pattern (the single note) has no box');
expect(await count('#nd-tree svg path') >= nodes.length - 1, 'every box is joined by a line');
if (SHOTS) await (await page.$('#nd-tree')).screenshot({ path: join(SHOTS, 'source-tree.png') });

// a reload keeps it
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nd-view-tree');
await page.click('#nd-view-tree');
await page.waitForSelector('#nd-tree');
expect((await page.$$eval('#nd-tree .nd-node code', (l) => l.length)) === nodes.length, 'the set should survive a reload');

await browser.close();
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('ok   notation set: settings, manuscript table and tree');
