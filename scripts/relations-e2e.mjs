// Relations and units, end to end in a real browser (metadata grid → "Relations and units"):
//  - without the fields the dialog offers to add them; adding registers the five custom document fields and the grid shows them
//  - the check finds a reference that leads nowhere and a unit with two documents at one position, and finds nothing wrong
//    with two tropes that refer to the same antiphon of their manuscript
//  - a click on a document of the check finds it in the table
//  - the relation types can be saved; a type that is in the list is no longer reported
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/relations-e2e.mjs [--url http://localhost:4299]
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
const docs = ['T1', 'T2', 'AN1', 'T3', 'P1', 'P2', 'V1'].map((label, i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1: 'Antiphon', sigle: 'Aa 13', root }));
// what the editors would have typed into the new fields
const custom = {
  d0: { relation_target: 'AN1' },                                             // T1 → AN1: fine
  d1: { relation_target: 'AN1' },                                             // T2 → AN1 as well: two tropes, one antiphon, fine
  d3: { relation_target: 'AN9' },                                             // T3 → a document that does not exist
  d4: { unit_id: 'play-1', unit_type: 'Play', unit_position: '1' },
  d5: { unit_id: 'play-1', unit_type: 'Play', unit_position: '1' },           // same position as P1
  d6: { relation_target: 'AN1', relation_type: 'Verse' },                     // a type that is not in the list yet
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
const openDialog = async () => {
  await page.click('[data-testid=mg-relations]');
  await page.waitForSelector('[data-testid=relations-summary], [data-testid=relations-add-fields]', { timeout: 20000 });
};

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  // the custom values go straight into the stored documents, as an import would have put them
  await page.evaluate(async (custom) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const store = () => db.transaction('monodi_data', 'readwrite').objectStore('monodi_data');
    const list = await new Promise((res) => { const q = store().get('monodi_documents'); q.onsuccess = () => res(q.result); });
    for (const d of list) if (custom[d.id]) d.custom = custom[d.id];
    await new Promise((res) => { const t = db.transaction('monodi_data', 'readwrite'); t.objectStore('monodi_data').put(list, 'monodi_documents'); t.oncomplete = res; });
    db.close();
  }, custom);
  await page.goto(BASE + '/#/metadata', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=mg-grid]', { timeout: 20000 });

  // ── the fields ──
  await openDialog();
  expect(await page.$('[data-testid=relations-add-fields]') !== null, 'without the fields the dialog must offer to add them');
  await page.click('[data-testid=relations-add-fields]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-add-fields]'), { timeout: 10000 })
    .catch(() => problems.push('the "Add the fields" button must go once the fields are there'));
  const settings = await idb('monodi_settings');
  const keys = (settings.customDocumentFields ?? []).map((f) => f.key);
  for (const k of ['relation_target', 'relation_type', 'unit_id', 'unit_type', 'unit_position']) expect(keys.includes(k), `field ${k} must be registered`);

  // ── the check ──
  await page.waitForSelector('[data-testid=relations-summary]', { timeout: 10000 });
  expect(/4 documents have a related document, 1 unit\./.test(await text('[data-testid=relations-summary]')), 'summary counts: ' + await text('[data-testid=relations-summary]'));
  const missing = await page.$('[data-testid=relations-group-target-missing]');
  expect(missing && (await missing.evaluate((e) => e.textContent)).includes('T3'), 'T3 refers to a document that does not exist');
  const dup = await page.$('[data-testid=relations-group-unit-position-duplicate]');
  expect(dup && (await dup.evaluate((e) => e.textContent)).includes('P2'), 'P2 shares its position with P1');
  const unknown = await page.$('[data-testid=relations-group-type-unknown]');
  expect(unknown && (await unknown.evaluate((e) => e.textContent)).includes('V1'), 'the type "Verse" is not in the list yet');
  const all = await page.$$eval('[data-testid^=relations-group-]', (g) => g.map((e) => e.getAttribute('data-testid')));
  expect(all.length === 3, 'T1 and T2 (two tropes, one antiphon) must raise nothing; groups: ' + all.join(', '));
  const listedT1 = await page.$$eval('[data-testid^=relations-group-] li a', (a) => a.map((x) => x.textContent.trim()));
  expect(!listedT1.includes('T1') && !listedT1.includes('T2') && !listedT1.includes('AN1'), 'T1, T2 and AN1 are fine: ' + listedT1.join(', '));

  // ── a type that is in the list is no longer reported ──
  await page.click('::-p-text(Add a type)');
  const names = await page.$$('[data-testid=relations-type-name]');
  const suffixes = await page.$$('[data-testid=relations-type-suffix]');
  await names[names.length - 1].type('Verse');
  await suffixes[suffixes.length - 1].type('V');
  await page.click('[data-testid=relations-save-types]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-group-type-unknown]'), { timeout: 10000 })
    .catch(() => problems.push('after saving the type "Verse" V1 must no longer be reported'));
  const types = (await idb('monodi_settings')).relationTypes;
  expect(JSON.stringify(types) === JSON.stringify([{ name: 'Primary chant', suffix: 'P', heading: 'Primary chants' }, { name: 'Verse', suffix: 'V' }]), 'the types are stored: ' + JSON.stringify(types));

  // ── a click finds the document in the table ──
  await page.click('[data-testid=relations-group-target-missing] li a');
  await page.waitForFunction(() => !document.querySelector('[data-testid=relations-dialog]'), { timeout: 5000 })
    .catch(() => problems.push('the dialog must close when a document is chosen'));
  await page.waitForFunction(() => /^1 of 7 documents/.test(document.querySelector('[data-testid=mg-count]')?.textContent.trim() ?? ''), { timeout: 5000 })
    .catch(() => problems.push('the table must show only the chosen document'));
  expect(await page.$$eval('.mg-head', (h) => /Related document/.test(h[0]?.textContent ?? '')), 'the grid shows the "Related document" column');
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   relations and units: fields, check, relation types, find in table');
process.exit(problems.length ? 1 : 0);
