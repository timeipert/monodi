// A ZIP import of an export that was zipped a second time (Finder or the browser wraps a downloaded .zip when it is
// compressed again, so the file holds nothing but the real archive): Sources → import a monodi+ ZIP opens the inner
// archive and imports it. A ZIP with nothing useful in it still says so.
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/zip-nested-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const inner = new JSZip();
inner.file('Src A/meta.json', JSON.stringify({ id: 'Src A', quellensigle: 'Src A' }));
inner.file('Src A/doc1/meta.json', JSON.stringify({ id: 'doc1', quelle_id: 'Src A', dokumenten_id: 'Src A-1' }));
inner.file('Src A/doc1/data.json', JSON.stringify({ kind: 'RootContainer', uuid: 'root', documentType: 'Level1', comments: [], children: [] }));
const innerBytes = await inner.generateAsync({ type: 'nodebuffer' });
const dir = mkdtempSync(join(tmpdir(), 'monodi-nested-'));
const write = async (name, files) => {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  const f = join(dir, name);
  writeFileSync(f, await z.generateAsync({ type: 'nodebuffer' }));
  return f;
};
const wrapped = await write('wrapped.zip', { 'monodi-zero-edition.zip': innerBytes, '__MACOSX/._monodi-zero-edition.zip': 'noise' });
const useless = await write('useless.zip', { 'readme.txt': 'nothing to import', 'other.zip': innerBytes, 'second.txt': 'x' });

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
const docs = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result ?? []); q.onerror = () => res([]); };
  r.onerror = () => res([]);
}));
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast-message')].map((e) => e.textContent.trim()).join(' | '));

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  // a ZIP with nothing useful: the message, no import
  await (await page.$('#importOmmrFile')).uploadFile(useless);
  await page.waitForFunction(() => /No meta\.json files found/.test(document.body.innerText), { timeout: 15000 }).catch(() => problems.push('a ZIP without an export must say that there is no meta.json: ' + document.title));
  expect((await docs()).length === 0, 'nothing is imported from a useless ZIP');
  await page.evaluate(() => { const i = document.querySelector('#importOmmrFile'); i.value = ''; });
  // an export wrapped in a ZIP: the inner one is imported
  await (await page.$('#importOmmrFile')).uploadFile(wrapped);
  await page.waitForFunction(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const n = await new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res((q.result || []).length); q.onerror = () => res(0); });
    db.close();
    return n > 0;
  }, { timeout: 30000, polling: 500 }).catch(async () => problems.push('the wrapped export was not imported; messages: ' + await toasts()));
  const list = await docs();
  expect(list.length === 1 && list[0].dokumenten_id === 'Src A-1', 'the document of the inner export is there: ' + JSON.stringify(list.map((d) => d.dokumenten_id)));
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}
await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   a ZIP that wraps the export ZIP is imported; a useless ZIP is refused');
process.exit(problems.length ? 1 : 0);
