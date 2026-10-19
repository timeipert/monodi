// Notation documentation, end to end: a Neume Viewer file is imported through Sources → Import annotations,
// the manuscript is printed with "Notation documentation", and the PDF is read back with poppler.
// Self-contained: the IIIF manifest and the page images are answered by the script (no network).
// Needs a dev server (npm start, port 4299) or --url, and poppler (pdftotext, pdfimages).
// Run: node scripts/notation-doc-e2e.mjs [--url http://localhost:4299]
//
// To look at real files instead (needs network):
//   node scripts/notation-doc-e2e.mjs --file backup.json[,more.json] --sigle "Aa 13,Ba 12" --out result.pdf
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedWorkspace, capturePdfDownloads, openPrintDialog } from './lib/e2e-common.mjs';
import { interceptIiif, writeFixture } from './lib/notation-fixture.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const BASE = opt('--url', 'http://localhost:4299');
const REAL_FILES = opt('--file', '');
const SIGLES = opt('--sigle', 'Fix 1').split(',');
const OUT = opt('--out', '');
const real = !!REAL_FILES;
const bin = (name) => (existsSync('/opt/homebrew/bin/' + name) ? '/opt/homebrew/bin/' + name : name);

const { dir, file: fixtureFile } = writeFixture();

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Permissions policy/i.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
const imageRequests = [];
if (!real) await interceptIiif(page, imageRequests);

let pdf = null;
await capturePdfDownloads(page, (buf) => { pdf = buf; });
const ids = SIGLES.map((_, i) => 'doc' + i);
const root = (k) => {
  const note = { uuid: 'n' + k, noteType: 'Normal', base: 'D', liquescent: false, octave: 4, focus: false };
  return { kind: 'RootContainer', uuid: 'root' + k, documentType: 'Level1', comments: [], children: [{ kind: 'ZeileContainer', uuid: 'z' + k, children: [{ uuid: 's' + k, kind: 'Syllable', text: 'tes', syllableType: 'Normal', notes: { spaced: [{ nonSpaced: [{ grouped: [note] }] }] } }] }] };
};
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
// the standard set of the workspace (Settings → Notation): three patterns, ordered like the neume table
const settings = real ? {} : { notationStandard: [{ pattern: '[*du]', refId: '21' }, { pattern: '*', refId: '10' }, { pattern: '[*dL]', refId: '10+/20-' }, { pattern: '*dd', refId: '30' }], notationOrder: 'neume' };
await seedWorkspace(page, SIGLES.map((sigle, i) => ({ id: ids[i], label: sigle + '-1', sigle, source: 'src' + i, root: root(i) })), settings);
await page.reload({ waitUntil: 'networkidle0' });

// ── import ──────────────────────────────────────────────────────────────────────────────────────
const importFile = async (file) => {
  await (await page.$('#importAnnotationsFile')).uploadFile(file);
  await page.waitForFunction(() => /Import annotations/.test(document.body.innerText), { timeout: 15000 });
  const text = await page.evaluate(() => document.querySelector('.modal-body')?.innerText || '');
  const [btn] = await page.$$('xpath/.//button[contains(., "Import")]');
  const disabled = await btn.evaluate((b) => b.disabled);
  if (!disabled) {
    await btn.click();
    await page.waitForFunction(() => !/Import annotations/.test(document.body.innerText), { timeout: 15000 });
  } else {
    const [cancel] = await page.$$('xpath/.//button[contains(., "Cancel")]');
    await cancel.click();
  }
  await new Promise((r) => setTimeout(r, 600));
  return { text, disabled };
};
for (const file of real ? REAL_FILES.split(',') : [fixtureFile]) {
  const r = await importFile(file);
  console.log(r.text.split('\n').filter(Boolean).slice(-2).join(' | '));
  if (!real) expect(/2 new line regions, 4 new snippets, 3 new table rows, sets the manifest address, adds the notation notes/.test(r.text), 'import preview: ' + r.text.slice(-200));
}
if (!real) {
  const again = await importFile(fixtureFile);
  expect(again.disabled && /Nothing new/.test(again.text), 'importing the same file twice should add nothing: ' + again.text.slice(-200));
}

// ── print ───────────────────────────────────────────────────────────────────────────────────────
await openPrintDialog(page, BASE, ids);
await page.evaluate(() => { const c = document.querySelector('#oNot'); if (!c.checked) c.click(); });
await page.waitForSelector('#oTree');
await page.evaluate(() => { const c = document.querySelector('#oTree'); if (!c.checked) c.click(); });
await page.evaluate(() => { const b = [...document.querySelectorAll('app-pdf-export-dialog button')].find((x) => /Create PDF/.test(x.innerText)); b.click(); });
await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog') || document.querySelector('#pdfWarnings') || document.querySelector('.alert-danger'), { timeout: 240000 });
const warning = await page.evaluate(() => document.querySelector('#pdfWarnings')?.innerText || document.querySelector('.alert-danger')?.innerText || '');
await new Promise((r) => setTimeout(r, 1500));
if (warning) console.log('DIALOG:', warning.replace(/\n+/g, ' '));
expect(pdf && pdf.length > 1000, 'no PDF arrived');

if (pdf) {
  const file = join(dir, 'out.pdf');
  writeFileSync(file, pdf);
  if (OUT) { writeFileSync(OUT, pdf); console.log('wrote', OUT); }
  if (!real) {
    expect(!warning, 'nothing should be reported: ' + warning);
    const text = execFileSync(bin('pdftotext'), ['-layout', file, '-']).toString();
    expect(/Notation Documentation/.test(text), 'no part title');
    expect(/Transcription equivalents/.test(text), 'no table heading');
    expect(/Sign inventory/.test(text), 'no strips heading');
    expect(/\b8\s*\/\s*6\b/.test(text), 'the recto folio should print without its r ("8 / 6")');
    expect(!/8r\s*\/\s*6/.test(text), 'a recto must not print as "8r / 6"');
    expect(/9v\s*\/\s*2/.test(text), 'the verso keeps its v ("9v / 2")');
    expect(/10\+\s+b\s+9v\s*\/\s*2\s+20-/.test(text), 'a composite ID (10+/20-) stands on two lines');
    // the order of the neume table: the shape with one note, then *dd, *ud (not in the standard set: it has snippets and no ID), *du, then the liquescent
    const at = (re) => text.search(re);
    expect(at(/\b10\b/) < at(/\b30\b/) && at(/\b30\b/) < at(/\b21\b/) && at(/\b21\b/) < at(/10\+/), 'rows should be in the order of the neume table (10, 30, 21, 10+/20-): ' + [at(/\b10\b/), at(/\b30\b/), at(/\b21\b/), at(/10\+/)]);
    expect(/Neume tree/.test(text) && /\[\*du\]/.test(text) && /\[\*dL\]/.test(text), 'the neume tree should be printed, its boxes carrying their codes');
    expect(/10\+20-b/.test(text) && /\b10a\b/.test(text) && /\b21\b/.test(text), 'the frames should carry the ID and variant (10a, 21, 10+20-b)');
    expect(/\*uu/.test(text), 'a snippet of a pattern without an ID is framed with its pattern');
    expect(/Notator A: f\. 8r\./.test(text), 'the notes of the table should be printed');
    const list = execFileSync(bin('pdfimages'), ['-list', file]).toString().split('\n').slice(2).filter(Boolean);
    expect(list.length === 2, `expected one picture per strip (2), the PDF has ${list.length}`);
    expect(imageRequests.length >= 2 && imageRequests.every((u) => /\/pct:[\d.,]+\/\d+,\/0\/default\.jpg$/.test(u)), 'strips are cut at the server by width: ' + imageRequests.join(' '));
  }
}
await browser.close();
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('ok');
