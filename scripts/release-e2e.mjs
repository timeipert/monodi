// Release gate, end to end in a real browser: import the Corpus Monodicum export list (.xlsx) in the metadata
// grid, then print. Documents marked "dontpublish" there must not reach the PDF.
//  - the import dialog reads a real .xlsx (shared strings, a repeated column name, a flag with a stray comment in
//    it), matches by UUID and by document ID, and shows what it would change before anything is written
//  - Apply stores the flags as custom fields and the edition status, and adds the grid columns
//  - the same file again changes nothing
//  - the print dialog holds the marked documents back (switch on), shows them with the reason, brings them back
//    when the switch is turned off (with a warning) and the PDF made with the switch on does not contain them
// Needs a dev server (npm start, port 4299) or pass --url, and poppler (pdftotext) for the last check.
// Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/release-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const PDFTOTEXT = existsSync('/opt/homebrew/bin/pdftotext') ? '/opt/homebrew/bin/pdftotext' : 'pdftotext';

const dir = join(here, '../src/app/testdata');
const roots = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort().slice(0, 5).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
// d0 and d1 are marked in the export; d0 has a print edition, so it would have been printed
const docs = ['Aa-1', 'Aa-2', 'Aa-3', 'Aa-4', 'Aa-5'].map((label, i) => ({
  id: `d${i}`, label, incipit: `Incipit ${label}`, genre1: 'Antiphon', sigle: 'Aa 13', edition: i === 0 ? 'CM III' : '', root: roots[i % roots.length],
}));

/** An .xlsx written the way Excel does: shared strings, cell references, a header row with a repeated name. */
async function buildXlsx(rows) {
  const zip = new JSZip();
  const shared = [];
  const idx = new Map();
  const si = (s) => { if (!idx.has(s)) { idx.set(s, shared.length); shared.push(s); } return idx.get(s); };
  const col = (i) => String.fromCharCode(65 + i);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === '' ? '' : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join('')}</row>`).join('');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheet}</sheetData></worksheet>`);
  zip.file('xl/sharedStrings.xml', `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  zip.file('xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  return zip.generateAsync({ type: 'nodebuffer' });
}
const HEADER = ['Dokumenten_ID', 'Editionsstatus', "Doc-Id' (intern)", 'dontpublish', 'Publish', 'Dokumenten ID', "please don't publish metadata"];
const xlsx = await buildXlsx([
  HEADER,
  ['Aa-1', 'none', 'd0', 'x', 'all', 'dup', ''],                                    // marked, matched by UUID
  ['Aa-2', 'ediert', '', 'Zweite Melodie Quelle: Alme rex pie', 'all', 'dup', ''],  // stray comment in the flag column, matched by ID
  ['Aa-3', 'ediert', 'd2', '', 'all', 'dup', 'x'],                                  // fine
  ['Elsewhere-1', 'none', 'u-unknown-1', 'x', 'all', 'dup', ''],                    // marked, not in this workspace
  ['Elsewhere-2', 'ediert', 'u-unknown-2', '', 'all', 'dup', ''],
]);
const file = join(mkdtempSync(join(tmpdir(), 'monodi-release-')), 'export_full.xlsx');
writeFileSync(file, xlsx);

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1500, height: 1000 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
const pdfs = [];
await capturePdfDownloads(page, (buf) => pdfs.push(buf));

const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const importOnce = async () => {
  await page.goto(BASE + '/#/metadata', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=mg-grid]', { timeout: 20000 });
  await page.click('[data-testid=mg-import-cm]');
  await page.waitForSelector('[data-testid=cm-import-dialog]');
  await (await page.$('[data-testid=cm-file]')).uploadFile(file);
  await page.waitForSelector('[data-testid=cm-summary]', { timeout: 20000 });
  return norm(await page.$eval('[data-testid=cm-summary]', (e) => e.textContent));
};

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  await page.reload({ waitUntil: 'networkidle0' });

  // ── the import dialog shows first what it would do ──
  const summary = await importOnce();
  expect(/5 documents in the list, 3 found/.test(summary), 'summary counts: ' + summary.slice(0, 160));
  expect(/2 are marked "don't publish"/.test(summary), 'two documents are marked (one by a stray comment): ' + summary.slice(0, 260));
  expect(/1 of them have a print edition/.test(summary), 'the marked document with a print edition is pointed out');
  expect(/1 marked documents are not in this workspace/.test(summary), 'the marked row without a document here is counted');
  expect(/1 cells in a flag column hold text/.test(summary) && summary.includes('Zweite Melodie Quelle'), 'the stray comment is reported');
  expect((await idb('monodi_documents')).every((d) => !d.custom), 'nothing may be written before Apply');

  // ── apply ──
  await page.click('[data-testid=cm-apply]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=cm-import-dialog]'), { timeout: 20000 });
  const stored = Object.fromEntries((await idb('monodi_documents')).map((d) => [d.id, d]));
  expect(stored.d0.custom?.dontpublish === 'x' && stored.d0.editionsstatus === 'none', 'd0 marked, status none');
  expect(stored.d1.custom?.dontpublish?.startsWith('Zweite Melodie') && stored.d1.editionsstatus === 'ediert', 'd1 matched by document ID and marked');
  expect(!stored.d2.custom?.dontpublish && stored.d2.custom?.dontpublish_metadata === 'x' && stored.d2.editionsstatus === 'ediert', 'd2 not marked, metadata flag set');
  expect(stored.d3.editionsstatus === '' && !stored.d3.custom, 'd3 is not in the export and stays as it was');
  const settings = await idb('monodi_settings');
  expect(['dontpublish', 'dontpublish_metadata'].every((k) => settings.customDocumentFields?.some((f) => f.key === k)), 'the two columns are registered');
  await page.waitForFunction(() => /Don't publish/.test(document.querySelector('.mg-head')?.textContent ?? ''), { timeout: 10000 })
    .catch(() => problems.push("the grid shows no \"Don't publish\" column after the import"));

  // ── the same file again: nothing to do ──
  await importOnce();
  expect(await page.$eval('[data-testid=cm-apply]', (b) => b.disabled), 'a second import of the same file must have nothing to apply');

  // ── print ──
  await page.goto(BASE + '/#/search', { waitUntil: 'networkidle0' });
  await page.waitForSelector('app-search', { timeout: 30000 });
  await page.evaluate((ids) => {
    const c = window.ng.getComponent(document.querySelector('app-search'));
    const seen = new Set();
    const findZone = (o, depth) => {
      if (!o || typeof o !== 'object' || seen.has(o) || depth > 3) return null;
      seen.add(o);
      if (typeof o.run === 'function' && typeof o.runOutsideAngular === 'function') return o;
      for (const k of Object.keys(o)) { let v; try { v = o[k]; } catch { continue; } const z = findZone(v, depth + 1); if (z) return z; }
      return null;
    };
    const zone = findZone(c, 0);
    if (!zone) throw new Error('no NgZone found');
    zone.run(() => c.pdfDialog.open({ ids, title: 'Release test' }));
  }, docs.map((d) => d.id));
  await page.waitForSelector('app-pdf-export-dialog [data-testid=pdf-hold]', { timeout: 20000 });
  const listed = () => page.$$eval('app-pdf-export-dialog ol li', (li) => li.length);
  expect(await listed() === 3, `3 documents stay in the print list, found ${await listed()}`);
  const hold = norm(await page.$eval('[data-testid=pdf-hold]', (e) => e.textContent));
  expect(/\(2\)/.test(hold), 'two documents are held back: ' + hold);
  await page.evaluate(() => document.querySelector('[data-testid=pdf-hold] details').open = true);
  const why = norm(await page.$eval('[data-testid=pdf-hold]', (e) => e.textContent));
  expect(why.includes('Aa-1') && why.includes('Aa-2') && /don't publish/.test(why), 'the held documents are named with the reason: ' + why);

  await page.click('[data-testid=pdf-hold-switch]');
  await page.waitForFunction(() => document.querySelectorAll('app-pdf-export-dialog ol li').length === 5, { timeout: 5000 })
    .catch(() => problems.push('with the switch off all 5 documents must be in the list'));
  expect(/2 documents marked "don't publish" will be printed/.test(norm(await page.$eval('[data-testid=pdf-hold]', (e) => e.textContent))), 'a warning says marked documents will be printed');
  await page.click('[data-testid=pdf-hold-switch]');
  await page.waitForFunction(() => document.querySelectorAll('app-pdf-export-dialog ol li').length === 3, { timeout: 5000 })
    .catch(() => problems.push('with the switch on again the list must have 3 documents'));

  // the PDF made with the switch on
  const before = pdfs.length;
  await (await page.waitForSelector('app-pdf-export-dialog ::-p-text(Create PDF)')).click();
  const t0 = Date.now();
  while (pdfs.length === before) {
    if (Date.now() - t0 > 120000) throw new Error('no PDF arrived');
    await new Promise((r) => setTimeout(r, 200));
  }
  const pdfFile = join(dirname(file), 'out.pdf');
  writeFileSync(pdfFile, pdfs[pdfs.length - 1]);
  const text = execFileSync(PDFTOTEXT, ['-layout', pdfFile, '-']).toString();
  for (const kept of ['Aa-3', 'Aa-4', 'Aa-5']) expect(text.includes(kept), `${kept} must be in the PDF`);
  for (const held of ['Aa-1', 'Aa-2']) expect(!text.includes(held), `${held} is marked "don't publish" and must not be in the PDF`);
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   export list import and print gate (2 of 5 documents held back)');
process.exit(problems.length ? 1 : 0);
