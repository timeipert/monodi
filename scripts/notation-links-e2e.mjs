// The notation documentation tied to the transcription, end to end in the browser: a Neume Viewer file is imported,
// its snippets carry only a reference (`Fix 1-8-1|8r|6|et|D4`); the page finds the neumes they depict, shows how
// much is linked, stores the links, opens a pattern and a snippet, and leads from there into the transcription.
// Needs a dev server (npm start, port 4299) or --url. Fresh headless-Chrome profile.
// Run: node scripts/notation-links-e2e.mjs [--url http://localhost:4299] [--shots <folder>]
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
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
await interceptIiif(page);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const text = (sel) => page.$eval(sel, (e) => e.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The transcription: document "Fix 1-8-1" starts on f. 8, line 6. Line 6 has two neumes, `*` on "et" and `[*du]` on "ra",
// and ends with a LineChange (its uuid is what a line region links to).
const note = (uuid, base, octave) => ({ uuid, noteType: 'Normal', base, liquescent: false, octave, focus: false });
const syl = (uuid, text, ...neumes) => ({ uuid, kind: 'Syllable', text, syllableType: 'Normal', notes: { spaced: neumes.map((groups) => ({ nonSpaced: groups.map((g) => ({ grouped: g })) })) } });
const root = { kind: 'RootContainer', uuid: 'root', documentType: 'Level1', comments: [], children: [{ kind: 'ZeileContainer', uuid: 'z', children: [
  syl('s-et', 'et', [[note('n-et', 'D', 4)]]),
  syl('s-ra', 'ra', [[note('n-ra1', 'F', 4), note('n-ra2', 'E', 4), note('n-ra3', 'F', 4)]]),
  { kind: 'LineChange', uuid: 'lc6', focus: false },
] }] };

await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, [{ id: 'doc0', label: 'Fix 1-8-1', sigle: 'Fix 1', source: 'src0', root, foliostart: '8', zeilenstart: '6' }]);
await page.reload({ waitUntil: 'networkidle0' });
await (await page.$('#importAnnotationsFile')).uploadFile(fixtureFile);
await page.waitForFunction(() => /Import annotations/.test(document.body.innerText), { timeout: 15000 });
const [importBtn] = await page.$$('xpath/.//button[contains(., "Import")]');
await importBtn.click();
await page.waitForFunction(() => !/Import annotations/.test(document.body.innerText), { timeout: 15000 });
await sleep(600);

// ── the page: what it holds and how much is tied to the transcription ───────────────────────────
await page.goto(BASE + '/#/source/src0?tab=notation&ntab=table', { waitUntil: 'networkidle0' });
await page.waitForSelector('#nd-model', { timeout: 15000 });
await page.waitForSelector('#nd-store-links', { timeout: 15000 });     // appears once the documents are read and links were found
const model = await text('#nd-model');
expect(/4\s+signs marked/.test(model) && /2\s+lines/.test(model), 'the model shows 4 snippets on 2 lines: ' + model.replace(/\s+/g, ' ').slice(0, 300));
expect(/1\s+documents/.test(model) && /2\s+neumes/.test(model), 'the transcription box counts its documents and neumes: ' + model.replace(/\s+/g, ' ').slice(-200));
expect(/0 linked, 2 found/.test(model), 'two snippets are found through their reference, none is stored yet: ' + model.replace(/\s+/g, ' ').slice(0, 400));
expect(/Store 2 snippet links and 1 line link/.test(await text('#nd-store-links')), 'the store button names what it will store: ' + await text('#nd-store-links'));
await shot('model');

// ── storing the links ───────────────────────────────────────────────────────────────────────────
await page.click('#nd-store-links');
await sleep(1200);
const src = (await idb('monodi_sources')).find((s) => s.id === 'src0');
const uuidOf = (id) => src.annotationItems.find((i) => String(i.id) === id)?.uuid;
expect(uuidOf('1001') === 'n-et' && uuidOf('1002') === 'n-ra1', `the snippets should point at the first note of their neume: ${uuidOf('1001')} ${uuidOf('1002')}`);
expect(src.annotationRegions.find((r) => r.id === 'r_a')?.lineUUID === 'lc6', 'the line region should point at the LineChange that ends its line');
expect(!src.annotationItems.find((i) => String(i.id) === '1003')?.uuid, 'a snippet whose neume the transcription does not have stays unlinked');
expect(await page.$('#nd-store-links') === null, 'with everything stored the button goes');
expect(/2 linked/.test(await text('#nd-model')), 'the model now counts 2 snippets as linked: ' + (await text('#nd-model')).replace(/\s+/g, ' ').slice(0, 300));

// ── a pattern: its snippets and every place of the transcription ────────────────────────────────
const open = async (pattern) => page.evaluate((pattern) => {
  const b = [...document.querySelectorAll('#nd-table .nd-pattern')].find((x) => x.querySelector('code')?.innerText === pattern);
  b.click();
}, pattern);
await open('[*du]');
await page.waitForSelector('#nd-panel', { timeout: 5000 });
const count = await text('#nd-panel-count');
expect(/1× in 1 document/.test(count) && /1 depicted by a snippet/.test(count), 'the panel counts the neume in the transcription and the snippet that depicts it: ' + count);
expect(/pattern=/.test(page.url()), 'an open pattern is in the address: ' + page.url());
await shot('panel');
await page.keyboard.press('Escape');
await sleep(300);
expect(await page.$('#nd-panel') === null && !/pattern=/.test(page.url()), 'Escape closes the panel and takes it out of the address');

// ── a snippet: the neume it depicts, and the way into the transcription ─────────────────────────
await page.evaluate(() => document.querySelector('#nd-table .nd-thumb').click());
await page.waitForSelector('#nd-dialog', { timeout: 5000 });
expect(/Linked to the transcription/.test(await text('#nd-dialog-link')), 'the dialog says the snippet is linked: ' + await text('#nd-dialog-link'));
expect(/Fix 1-8-1/.test(await text('#nd-dialog')) && /D4/.test(await text('#nd-dialog')), 'the dialog names the document and the notes of the neume');
await shot('dialog');
await page.click('#nd-open-transcription');
await page.waitForFunction(() => /#\/document\/src0\/doc0/.test(location.hash), { timeout: 10000 });
expect(/focus=n-/.test(page.url()), 'the transcription is opened at the neume: ' + page.url());

await browser.close();
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('ok   notation links: found, stored, pattern panel, snippet dialog');
