// Units and related documents in the print, end to end through the real print dialog:
//  - a unit (play) stands as one block at the place of its first document, in the order of its positions
//  - the antiphon that a trope names as its related document stands directly behind it and is numbered 1P
//  - the documents that follow are numbered on, as before
//  - with the switch off the print keeps the order of the list and numbers 1, 2, 3 …
//  - a document of a unit that is held back (don't publish) is named in a warning: the unit would be printed with gaps
// Needs a dev server (npm start, port 4299) or pass --url, and poppler (pdftotext). Fresh headless-Chrome profile.
// Run: node scripts/arrange-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, capturePdfDownloads, openPrintDialog } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const PDFTOTEXT = existsSync('/opt/homebrew/bin/pdftotext') ? '/opt/homebrew/bin/pdftotext' : 'pdftotext';

const dir = join(here, '../src/app/testdata');
const roots = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort().slice(0, 4).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
// the order of the list; T-1 names AN-1 as its primary chant; P-1..P-3 are a play, P-3 is held back
const LABELS = ['T-1', 'X-1', 'P-2', 'AN-1', 'X-2', 'P-1', 'P-3'];
const docs = LABELS.map((label, i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1: 'Antiphon', sigle: 'Aa 13', root: roots[i % roots.length] }));
const custom = {
  d0: { relation_target: 'AN-1' },
  d2: { unit_id: 'play-1', unit_position: '2' },
  d5: { unit_id: 'play-1', unit_position: '1' },
  d6: { unit_id: 'play-1', unit_position: '3', dontpublish: 'x' },
};

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1500, height: 1100 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
const pdfs = [];
await capturePdfDownloads(page, (buf) => pdfs.push(buf));
const tmp = mkdtempSync(join(tmpdir(), 'monodi-arrange-'));

/** "number id" of every document heading in the PDF, in the order they are printed. */
const headings = (buf, name) => {
  const file = join(tmp, name);
  writeFileSync(file, buf);
  const text = execFileSync(PDFTOTEXT, ['-layout', file, '-']).toString();
  // the apparatus names the documents again behind the edition: only the first heading of each counts
  const seen = new Set();
  return [...text.matchAll(/^\s*(\d+P*)\s+(T-1|X-1|X-2|AN-1|P-1|P-2|P-3)\b/gm)].filter((m) => !seen.has(m[2]) && seen.add(m[2])).map((m) => `${m[1]} ${m[2]}`);
};
const makePdf = async (switchOff) => {
  await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Arrange test');
  await page.waitForSelector('#oArrange', { timeout: 20000 });
  const on = await page.$eval('#oArrange', (e) => e.checked);
  if (on === switchOff) await page.click('#oArrange');
  const before = pdfs.length;
  await page.click('app-pdf-export-dialog .btn-danger.px-4');
  const t0 = Date.now();
  while (pdfs.length === before) {
    if (Date.now() - t0 > 120000) throw new Error('no PDF arrived');
    await new Promise((r) => setTimeout(r, 200));
  }
  return pdfs[pdfs.length - 1];
};

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
  await page.reload({ waitUntil: 'networkidle0' });

  // ── the warning: P-3 is held back, the play would be printed with a gap ──
  await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Arrange test');
  await page.waitForSelector('[data-testid=pdf-unit-warnings]', { timeout: 20000 })
    .catch(() => problems.push('a unit with a held-back document must raise a warning'));
  const warn = (await page.$eval('[data-testid=pdf-unit-warnings]', (e) => e.textContent).catch(() => '')).replace(/\s+/g, ' ');
  expect(/play-1/.test(warn) && /held back/.test(warn) && /P-3/.test(warn), 'the warning names the unit, the reason and the document: ' + warn);
  await page.evaluate(() => [...document.querySelectorAll('app-pdf-export-dialog button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog'), { timeout: 5000 });

  // ── on: a play as a block, the antiphon behind its trope as 1P ──
  const arranged = headings(await makePdf(false), 'arranged.pdf');
  expect(arranged.join(' | ') === '1 T-1 | 1P AN-1 | 2 X-1 | 3 P-1 | 4 P-2 | 5 X-2',
    'arranged: trope, its antiphon as 1P, then the play in order of its positions (P-3 is held back): ' + arranged.join(' | '));

  // ── off: the order of the list, numbered 1, 2, 3 ──
  const plain = headings(await makePdf(true), 'plain.pdf');
  expect(plain.join(' | ') === '1 T-1 | 2 X-1 | 3 P-2 | 4 AN-1 | 5 X-2 | 6 P-1', 'with the switch off the list order and plain numbers stay: ' + plain.join(' | '));
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   units and related documents in the print (order, 1P, warning for gaps)');
process.exit(problems.length ? 1 : 0);
