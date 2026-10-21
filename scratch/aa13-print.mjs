// Imports a Monodi ZIP export (real ZIP import), prints some of its documents with the volume options and writes the PDF.
// Run: node scratch/aa13-print.mjs --zip <file.zip> --out <file.pdf> [--genre Tropus] [--max 14] [--notation] [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import { capturePdfDownloads, openPrintDialog } from '../scripts/lib/e2e-common.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const BASE = opt('--url', 'http://localhost:4299');
const ZIP = opt('--zip', '');
const OUT = opt('--out', 'aa13.pdf');
const GENRE = opt('--genre', 'Tropus');
const MAX = Number(opt('--max', '14'));
const NOTATION = flag('--notation');
const ALSO = opt('--also', '').split(',').map((x) => x.trim()).filter(Boolean);
const PRINT_HEADING = flag('--print-heading');
const REL_FIELD = opt('--relation-field', '');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Permissions policy/i.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
let pdf = null;
await capturePdfDownloads(page, (buf) => { pdf = buf; });

await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await (await page.$('#importOmmrFile')).uploadFile(ZIP);
// the import confirms with a dialog or just runs; wait until the documents are stored
await page.waitForFunction(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const n = await new Promise((res) => { try { const q = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res((q.result || []).length); q.onerror = () => res(0); } catch { res(0); } });
  db.close();
  return n > 0;
}, { timeout: 120000, polling: 1000 });
await new Promise((r) => setTimeout(r, 2000));
const confirm = await page.$$('xpath/.//button[contains(., "Import")]');
console.log('import confirm buttons:', confirm.length);

const docs = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const q = await new Promise((res) => { const g = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); g.onsuccess = () => res(g.result); });
  db.close();
  return q;
});
console.log('documents imported:', docs.length);
const folioNum = (d) => parseInt(d.foliostart, 10) + (/v/.test(d.foliostart) ? 0.5 : 0);
const picked = docs.filter((d) => d.gattung1 === GENRE).sort((a, b) => folioNum(a) - folioNum(b) || a.dokumenten_id.localeCompare(b.dokumenten_id, 'de', { numeric: true })).slice(0, MAX);
picked.push(...docs.filter((d) => ALSO.includes(d.dokumenten_id) && !picked.includes(d)));
console.log('printing', picked.map((d) => d.dokumenten_id).join(', '));

if (PRINT_HEADING || REL_FIELD) {
  // the heading of the printed volume: the reference only
  await page.evaluate(async (PRINT_HEADING, REL_FIELD) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const tx = db.transaction('monodi_data', 'readwrite'); tx.objectStore('monodi_data').put({ ...(PRINT_HEADING ? { pdfDocHeadingFields: [{ key: 'bibliographischerverweis', style: 'normal' }] } : {}), ...(REL_FIELD ? { relationFields: { target: REL_FIELD } } : {}), pdfShowPageNumbers: true }, 'monodi_settings'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  }, PRINT_HEADING, REL_FIELD);
}
await page.reload({ waitUntil: 'networkidle0' });
await openPrintDialog(page, BASE, picked.map((d) => d.id));
const tick = (id, on) => page.evaluate((id, on) => { const c = document.querySelector('#' + id); if (c && c.checked !== on) c.click(); }, id, on);
await new Promise((r) => setTimeout(r, 800));
for (const [id, on] of [['oTitle', true], ['oContents', true], ['oMeta', true], ['oApp', true], ['oDesc', true], ['oNot', NOTATION], ['oHold', false]]) await tick(id, on);
await page.evaluate(() => { const b = [...document.querySelectorAll('app-pdf-export-dialog button')].find((x) => /Create PDF/.test(x.innerText)); b.click(); });
await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog') || document.querySelector('#pdfWarnings') || document.querySelector('.alert-danger'), { timeout: 400000 });
const warning = await page.evaluate(() => document.querySelector('#pdfWarnings')?.innerText || document.querySelector('.alert-danger')?.innerText || '');
await new Promise((r) => setTimeout(r, 2000));
if (warning) console.log('DIALOG:', warning.replace(/\n+/g, ' '));
if (!pdf) { console.log('no PDF'); process.exitCode = 1; } else { writeFileSync(OUT, pdf); console.log('wrote', OUT, pdf.length); }
await browser.close();
