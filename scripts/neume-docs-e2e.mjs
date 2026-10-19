// Neumen-Editor documentation, end to end: the files of a published documentation (neume-docs.json + data/, and
// the same as a ZIP with screenshots in images/) are imported through Sources → Import annotations, the
// manuscripts are printed with "Notation documentation", and the PDF is read back with poppler.
// Self-contained: the IIIF image server is answered by the script (no network). The documentation names no
// manifest, so none may be asked for. Needs a dev server (npm start, port 4299) or --url, and poppler.
// Run: node scripts/neume-docs-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedWorkspace, capturePdfDownloads, openPrintDialog } from './lib/e2e-common.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const BASE = opt('--url', 'http://localhost:4299');
const bin = (name) => (existsSync('/opt/homebrew/bin/' + name) ? '/opt/homebrew/bin/' + name : name);

// a small grey PNG (what the "IIIF server" returns, and the screenshot of a line)
function png(w, h) {
  const crc = (buf) => { const b = Buffer.alloc(4); b.writeUInt32BE(zlib.crc32(buf) >>> 0); return b; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, t, data, crc(Buffer.concat([t, data]))]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x + y) % 40 < 3 ? 40 : 190;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── the documentation, as the editor writes it ──────────────────────────────────────────────────
const crop = (page, r) => `https://iiif.test/img/${page}/pct:${r}/1200,/0/default.jpg`;
const iiif = {
  id: 'Fix 1', source: 'Fix 1', name: 'Fixture on IIIF', notes: 'Notator A: f. 8r.', kind: 'iiif',
  rows: [
    { pattern: '*', refId: '10', notes: '', tier: 'standard' },
    { pattern: '[*du]', refId: '21', notes: '', tier: 'standard' },
    { pattern: '[*dL]', refId: '10+/20-', notes: '', tier: 'standard' },
  ],
  snippets: [
    { id: 's1', pattern: '*', variant: 'a', refId: '10a', folio: '8r', line: 'Line 6', image: '', zoom: '', lineId: 'L1' },
    { id: 's2', pattern: '[*du]', variant: '', refId: '21', folio: '8r', line: 'Line 6', image: '', zoom: '', lineId: 'L1' },
    { id: 's3', pattern: '[*dL]', variant: 'b', refId: '10+/20-b', folio: '9v', line: 'Line 2', image: '', zoom: '', lineId: 'L2' },
  ],
  lines: [
    { id: 'L1', folio: '8r', name: 'Line 6', image: crop('p8', '10,30,70,8'), items: [{ id: 's1', points: '5,10 15,10 15,90 5,90' }, { id: 's2', points: '50,10 60,10 60,90 50,90' }] },
    { id: 'L2', folio: '9v', name: 'Line 2', image: crop('p9', '12,20,70,8'), items: [{ id: 's3', points: '20,20 30,20 30,80 20,80' }] },
  ],
};
const shot = {
  id: 'Shot 1', source: 'Shot 1', name: 'Fixture of screenshots', notes: '', kind: 'collection',
  rows: [{ pattern: '*', refId: '', notes: '', tier: 'standard' }, { pattern: '[*du]', refId: '', notes: '', tier: 'standard' }],
  snippets: [
    { id: 'a', pattern: '*', variant: '', refId: '30', folio: '12r', line: '3', image: 'images/Shot_1/a.png', lineId: 'ln' },
    { id: 'b', pattern: '[*du]', variant: 'b', refId: '31', folio: '12r', line: '3', image: 'images/Shot_1/b.png', lineId: 'ln' },
  ],
  lines: [{ id: 'ln', folio: '12r', name: '3', image: 'images/Shot_1/line-ln.png', items: [{ id: 'a', box: { x: 10, y: 20, w: 20, h: 60 } }, { id: 'b', box: { x: 50, y: 20, w: 20, h: 60 } }] }],
};
const index = (list) => ({
  format: 'neume-docs', version: 1, generated: '2026-10-19', info: { title: 'Fixture documentation', authors: ['e2e'] }, columns: [], signs: {}, discriminateSigns: true,
  manuscripts: list.map((d) => ({ id: d.id, source: d.source, name: d.name, kind: d.kind, meta: {}, file: `data/${d.id.replace(/\W+/g, '_')}.json`, patterns: d.rows.length, snippets: d.snippets.length })),
});
const dir = mkdtempSync(join(tmpdir(), 'monodi-neume-docs-'));
mkdirSync(join(dir, 'files'));
const iiifFiles = [join(dir, 'files', 'neume-docs.json'), join(dir, 'files', 'Fix_1.json')];
writeFileSync(iiifFiles[0], JSON.stringify(index([iiif])));
writeFileSync(iiifFiles[1], JSON.stringify(iiif));
const zip = new JSZip();
zip.file('docs-main/neume-docs.json', JSON.stringify(index([shot])));
zip.file('docs-main/data/Shot_1.json', JSON.stringify(shot));
zip.file('docs-main/images/Shot_1/line-ln.png', png(500, 90));
const zipFile = join(dir, 'documentation.zip');
writeFileSync(zipFile, await zip.generateAsync({ type: 'nodebuffer' }));

// ── the browser ─────────────────────────────────────────────────────────────────────────────────
const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Permissions policy/i.test(m.text())) console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
const imageRequests = [];
const otherRequests = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  const cors = { 'access-control-allow-origin': '*' };
  if (url.startsWith('https://iiif.test/img/')) { imageRequests.push(url); return req.respond({ status: 200, contentType: 'image/png', headers: cors, body: png(600, 120) }); }
  if (/^https?:\/\/iiif\.test\//.test(url)) { otherRequests.push(url); return req.respond({ status: 404, headers: cors, body: '' }); }
  req.continue();
});

let pdf = null;
await capturePdfDownloads(page, (buf) => { pdf = buf; });
const SIGLES = ['Fix 1', 'Shot 1'];
const ids = SIGLES.map((_, i) => 'doc' + i);
const root = (k) => {
  const note = { uuid: 'n' + k, noteType: 'Normal', base: 'D', liquescent: false, octave: 4, focus: false };
  return { kind: 'RootContainer', uuid: 'root' + k, documentType: 'Level1', comments: [], children: [{ kind: 'ZeileContainer', uuid: 'z' + k, children: [{ uuid: 's' + k, kind: 'Syllable', text: 'tes', syllableType: 'Normal', notes: { spaced: [{ nonSpaced: [{ grouped: [note] }] }] } }] }] };
};
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, SIGLES.map((sigle, i) => ({ id: ids[i], label: sigle + '-1', sigle, source: 'src' + i, root: root(i) })));
await page.reload({ waitUntil: 'networkidle0' });

// ── import ──────────────────────────────────────────────────────────────────────────────────────
const importFiles = async (files) => {
  await (await page.$('#importAnnotationsFile')).uploadFile(...files);
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
const a = await importFiles(iiifFiles);
console.log(a.text.split('\n').filter(Boolean).slice(-3).join(' | '));
expect(/Fix 1/.test(a.text) && /2 new line regions, 3 new snippets, 3 new table rows, adds the notation notes/.test(a.text), 'files: import preview: ' + a.text.slice(-250));
const b = await importFiles([zipFile]);
console.log(b.text.split('\n').filter(Boolean).slice(-3).join(' | '));
expect(/Shot 1/.test(b.text) && /1 new line region, 2 new snippets, 2 new table rows, 1 line picture kept on this computer/.test(b.text), 'zip: import preview: ' + b.text.slice(-250));
const again = await importFiles(iiifFiles);
expect(again.disabled && /Nothing new/.test(again.text), 'importing the same files twice should add nothing: ' + again.text.slice(-200));
// the index alone says what is missing
await (await page.$('#importAnnotationsFile')).uploadFile(iiifFiles[0]);
await new Promise((r) => setTimeout(r, 1200));
const toast = await page.evaluate(() => document.body.innerText);
expect(/index of a documentation/.test(toast), 'the index alone should say that the manuscript files are missing');

// ── print ───────────────────────────────────────────────────────────────────────────────────────
await openPrintDialog(page, BASE, ids);
await page.evaluate(() => { const c = document.querySelector('#oNot'); if (!c.checked) c.click(); });
await page.evaluate(() => { const b = [...document.querySelectorAll('app-pdf-export-dialog button')].find((x) => /Create PDF/.test(x.innerText)); b.click(); });
await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog') || document.querySelector('#pdfWarnings') || document.querySelector('.alert-danger'), { timeout: 240000 });
const warning = await page.evaluate(() => document.querySelector('#pdfWarnings')?.innerText || document.querySelector('.alert-danger')?.innerText || '');
await new Promise((r) => setTimeout(r, 1500));
if (warning) console.log('DIALOG:', warning.replace(/\n+/g, ' '));
expect(pdf && pdf.length > 1000, 'no PDF arrived');

if (pdf) {
  const file = join(dir, 'out.pdf');
  writeFileSync(file, pdf);
  expect(!/without image/.test(warning), 'all strips should have their picture: ' + warning);
  const text = execFileSync(bin('pdftotext'), ['-layout', file, '-']).toString();
  expect(/Notation Documentation/.test(text), 'no part title');
  expect(/\b8\s*\/\s*6\b/.test(text) && /9v\s*\/\s*2\b/.test(text), 'the places of the IIIF manuscript (8 / 6, 9v / 2)');
  expect(/\b12\s*\/\s*3\b/.test(text), 'the place of the screenshot line (12 / 3)');
  expect(/10\+20-b/.test(text) && /\b10a\b/.test(text) && /\b21\b/.test(text), 'frames of the IIIF manuscript (10a, 21, 10+20-b)');
  expect(/\b30\b/.test(text) && /\b31b\b/.test(text), 'frames of the screenshots take the Reference ID of the snippet (30, 31b)');
  expect(/Notator A: f\. 8r\./.test(text), 'the notes of the table should be printed');
  const list = execFileSync(bin('pdfimages'), ['-list', file]).toString().split('\n').slice(2).filter(Boolean);
  expect(list.length === 3, `expected one picture per strip (3), the PDF has ${list.length}`);
  expect(imageRequests.length === 2 && imageRequests.every((u) => /\/p[89]\/pct:[\d.,]+\/\d+,\/0\/default\.jpg$/.test(u)), 'the two IIIF strips are cut at the server from the pages the file named: ' + imageRequests.join(' '));
  expect(imageRequests.some((u) => /\/p8\/pct:9\.3,29\.04,71\.4,9\.92\//.test(u)), 'the strip of folio 8 is cut from the line the file named (padded): ' + imageRequests.join(' '));
  expect(otherRequests.length === 0, 'no manifest or other address may be asked for: ' + otherRequests.join(' '));
}
await browser.close();
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('ok');
