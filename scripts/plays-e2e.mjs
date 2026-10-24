// All plays in one volume, a chapter per play, through the real print dialog (Volumes tab → "Volume rules"):
// the rule "Unit ID has a value" (without "one volume per value") collects the documents of every play in one volume; in the
// PDF every play is a chapter named by its Unit ID, the numbering starts again in each, and the documents that are no play
// are not in it. Needs a dev server (npm start, port 4299) or pass --url, and poppler (pdftotext).
// Run: node scripts/plays-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, capturePdfDownloads, openPrintDialog } from './lib/e2e-common.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const dir = join(here, '../src/app/testdata');
const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const root = JSON.parse(readFileSync(join(dir, readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort()[0]), 'utf8'));
const SPEC = [['Ant-1', 'Antiphon', ''], ['P1-a', 'Antiphon', 'Osterspiel'], ['P1-b', 'Hymnus', 'Osterspiel'], ['P2-a', 'Antiphon', 'Weihnachtsspiel'], ['P2-b', 'Hymnus', 'Weihnachtsspiel'], ['Hym-1', 'Hymnus', '']];
const docs = SPEC.map(([label, genre1], i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1, source: i < 3 ? 'srcA' : 'srcB', sigle: i < 3 ? 'Aa 13' : 'Bb 2', root }));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
let pdf = null; await capturePdfDownloads(page, (b) => { pdf = b; });
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, docs, { customDocumentFields: [{ key: 'unit_id', label: 'Unit ID' }], volumeRules: [{ name: 'Plays', field: 'unit_id', op: 'set', values: [] }, { name: 'Rest', field: 'genre', op: 'in', values: ['Antiphon', 'Hymnus'] }] });
await page.evaluate(async (units) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const list = await new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result); });
  for (const d of list) if (units[d.id]) d.custom = { unit_id: units[d.id] };
  await new Promise((res) => { const t = db.transaction('monodi_data', 'readwrite'); t.objectStore('monodi_data').put(list, 'monodi_documents'); t.oncomplete = res; });
  db.close();
}, { d1: 'Osterspiel', d2: 'Osterspiel', d3: 'Weihnachtsspiel', d4: 'Weihnachtsspiel' });
await page.reload({ waitUntil: 'networkidle0' });
await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Spiele');
const click = async (sel, t) => (await page.waitForSelector(`${sel} ::-p-text(${t})`, { timeout: 10000 })).click();
await click('app-pdf-export-dialog .nav-link', 'Volumes');
await page.select('app-pdf-export-dialog #splitBy', '@rules');
await new Promise((r) => setTimeout(r, 800));
const listed = await page.$$eval('app-pdf-export-dialog li.list-group-item', (li) => li.map((e) => e.querySelector('label').textContent.trim() + ' ' + e.querySelector('.badge').textContent.trim()));
expect(JSON.stringify(listed) === JSON.stringify(['Plays 4', 'Rest 2']), 'volumes: ' + listed.join(' | '));
// only the first volume (the plays)
await page.evaluate(() => { const c = [...document.querySelectorAll('app-pdf-export-dialog li.list-group-item input')]; c.forEach((x, i) => { if ((i === 0) !== x.checked) x.click(); }); });
await page.evaluate(() => { for (const id of ['oTitle', 'oContents']) { const c = document.querySelector('#' + id); if (c && !c.checked) c.click(); } });
await click('app-pdf-export-dialog button', 'Create');
await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
expect(!!pdf, 'no PDF arrived');
if (pdf) {
  const file = join(mkdtempSync(join(tmpdir(), 'plays-')), 'plays.pdf');
  writeFileSync(file, pdf);
  const text = execFileSync(process.env.PDFTOTEXT || '/opt/homebrew/bin/pdftotext', ['-layout', file, '-']).toString();
  expect(/1\. Osterspiel/.test(text) && /2\. Weihnachtsspiel/.test(text), 'every play is a chapter named by its Unit ID');
  expect(/P1-a/.test(text) && /P1-b/.test(text) && /P2-a/.test(text) && /P2-b/.test(text), 'all four documents of the plays are in the volume');
  expect(!/Ant-1|Hym-1/.test(text), 'a document that is no play is not in the plays volume');
  expect((text.match(/^\s*1\s+P\d-a/gm) || []).length === 2, 'the numbering starts again in each play');
}
await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   plays: one volume, a chapter per play');
process.exit(problems.length ? 1 : 0);
