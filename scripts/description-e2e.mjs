// Source descriptions as the printed volume sets them, through the real print dialog and poppler:
//  - bold text in running text and lists is small capitals, `<sc>` too; `<sup>` is raised; `<br>` in a table cell breaks the line
//  - long German words are hyphenated, a list of references has no bullets, a picture with a number as its alt text is no caption
//  - the running head: a recto has the manuscript on the left and the number on the right, a verso the number on the left
//    and "part | manuscript" on the right
// Needs a dev server (npm start, port 4299) or --url, and poppler (pdftotext, pdfimages).
// Run: node scripts/description-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { seedWorkspace, capturePdfDownloads, openPrintDialog } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });
const bin = (n) => '/opt/homebrew/bin/' + n;
const dir = join(here, '../src/app/testdata');
const root = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('Abb_7') && f.endsWith('.json'))), 'utf8'));

// a small PNG (portrait, 40 x 50) as a data address
function png() {
  const w = 40, h = 50;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 6; raw[o + 1] = y * 5; raw[o + 2] = 128; }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of buf) r = t[(r ^ b) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const para = 'Handschriftenbeschreibung und Überlieferungsgeschichte der Aachener Marienstiftsbibliothek, Kirchenjahresanordnung der Festformulare, Quellenüberlieferung im Domarchiv und Gottesdienstordnungen des Mittelalters.';
const md = [
  '# Aa 13', '', 'Aachen, Domarchiv, Hs. G 13', '', 'Graduale – Tropar', '',
  '## Lagen', '', para + ' Vgl. **Hesbert** 1961 und <sc>Euw</sc> 2001.', '', para, '',
  `![0.4](${png()})`, '',
  '## Inhalt', '', '| Folio | Inhalt |', '| --- | --- |', '| 1–107v | **Graduale**<br>Anlage: Weihnachten |', '| Nach f. 98v Lakune | |', '| 107v–111v | **Tropar** |', '',
  '## Herkunft', '', para, '', para + ' XIII<sup>e</sup> siècle.', '', para, '', para, '', para, '', para, '', para, '', para, '', para, '', para, '', para, '',
  '## Literatur', '', '- **Arlt** 1993b: Wulf **Arlt**, Schichten und Wege in der Überlieferung der älteren Tropen zum Introitus des Petrus-Festes, in: Recherches nouvelles 1993, S. 13–93.',
  '- **Eisenlohr** 1989: Erika **Eisenlohr**, Die älteste Niederschrift der Sequenz Urbs Aquensis im letzten Viertel des 12. Jahrhunderts, Aachen 1989.', '',
].join('\n');

const docs = ['Aa 13-1', 'Aa 13-2'].map((label, i) => ({ id: 'doc-' + i, label, incipit: 'Cantus ' + i, genre1: 'Antiphon', source: 'src1', sigle: 'Aa 13', sourceDescription: md, root }));
const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 200)));
const file = join(outDir, 'description.pdf');
let got = false;
await capturePdfDownloads(page, (buf) => { writeFileSync(file, buf); got = true; });
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, docs, { pdfShowPageNumbers: true });
await page.reload({ waitUntil: 'networkidle0' });
await openPrintDialog(page, BASE, docs.map((d) => d.id));
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => { const c = document.querySelector('#oDesc'); if (c && !c.checked) c.click(); });
await page.evaluate(() => { const b = [...document.querySelectorAll('app-pdf-export-dialog button')].find((x) => /Create PDF/.test(x.innerText)); b.click(); });
await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog') || document.querySelector('.alert-danger'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
expect(got, 'no PDF arrived');

if (got) {
  const pages = Number(execFileSync(bin('pdfinfo'), [file]).toString().match(/Pages:\s+(\d+)/)[1]);
  const text = execFileSync(bin('pdftotext'), [file, '-']).toString();
  const layout = (n) => execFileSync(bin('pdftotext'), ['-layout', '-f', String(n), '-l', String(n), file, '-']).toString();
  const all = execFileSync(bin('pdftotext'), ['-layout', file, '-']).toString();

  expect(!/<br>|<sup>|<\/sup>|<sc>|<\/sc>|&lt;/i.test(text), 'no markup of the description may show: ' + (text.match(/<[^>]*>/) || [''])[0]);
  // (a long word may be hyphenated: HES-BERT)
  expect(/HES-?\s*BERT/.test(text) && !/Hesbert/.test(text), 'bold text in a paragraph is set in small capitals (HESBERT)');
  expect(/EUW/.test(text) && !/\bEuw\b/.test(text), '<sc> is set in small capitals (EUW)');
  expect(/ARLT/.test(text) && /EISENLOHR/.test(text), 'the authors in the list are small capitals');
  expect(/XIII/.test(text) && /siècle/.test(text), 'the raised "e" stays with its word');
  expect(!/•/.test(text), 'the list of references has no bullets');
  expect(!/\b0\.4\b/.test(text), 'a number as the alt text is no caption');
  expect(/[a-zäöüß]-(\s{2,}\S|[ \t]*$)/m.test(all), 'long words are hyphenated at the end of a line');
  // the table: <br> breaks the line inside the cell, the row with one cell runs across
  const lines = all.split('\n');
  const iG = lines.findIndex((l) => /1–107v/.test(l));
  const iA = lines.findIndex((l) => /Anlage/.test(l));
  expect(iG >= 0 && iA === iG + 1, `"Graduale" and "Anlage" stand on two lines (${iG}, ${iA})`);
  expect(lines.some((l) => /Nach f\. 98v Lakune/.test(l)), 'a row with one cell is not broken up');
  // the picture
  const imgs = execFileSync(bin('pdfimages'), ['-list', file]).toString().split('\n').slice(2).filter(Boolean);
  expect(imgs.length === 1, `one picture expected, ${imgs.length} found`);

  // running heads of the description pages: the part page is the first page of the description
  let first = 0;
  for (let n = 1; n <= pages; n++) if (/Source Description/.test(layout(n)) && !/Aa 13/.test(layout(n))) first = n;
  expect(first > 0, 'no part page for the description');
  let recto = 0, verso = 0;
  for (let n = first + 1; n <= pages; n++) {
    const head = layout(n).split('\n').find((l) => l.trim()) || '';
    if (n % 2) { recto++; expect(/^\s*Aa 13\s+\d+\s*$/.test(head), `page ${n} (recto): manuscript left, number right: "${head.trim()}"`); }
    else { verso++; expect(/^\s*\d+\s+Source Description \| Aa 13\s*$/.test(head), `page ${n} (verso): number left, part and manuscript right: "${head.trim()}"`); }
  }
  expect(recto > 0 && verso > 0, `the description should run over a recto and a verso page (${recto}, ${verso})`);
}
await browser.close();
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('ok    source descriptions as in the printed volume');
