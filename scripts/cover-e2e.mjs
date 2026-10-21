// Cover page and volumes, end to end, through the real print dialog. Needs a running dev server
// (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
//  - the cover editor draws a preview, a preset can be loaded, a variable filled in
//  - "split by region of origin" makes one PDF per region, zipped; every volume has its own cover with the
//    placeholders filled in for ITS documents ($gattung1$en aus $quelle$, $herausgeber$ ...)
//  - the contents page follows the cover, the edition starts behind both and has a running head
//  - without splitting: one PDF with the cover
// Run: node scripts/cover-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedWorkspace, openPrintDialog } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });
const PDFTOTEXT = existsSync('/opt/homebrew/bin/pdftotext') ? '/opt/homebrew/bin/pdftotext' : 'pdftotext';
const PDFTOPPM = existsSync('/opt/homebrew/bin/pdftoppm') ? '/opt/homebrew/bin/pdftoppm' : 'pdftoppm';

const dir = join(here, '../src/app/testdata');
const roots = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort().slice(0, 4).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const SOURCES = {
  aa: { sigle: 'Aa 13', region: 'Rheinland', ort: 'Aachen', bib: 'Domarchiv', sig: 'Hs. G 13' },
  koeln: { sigle: 'K 1', region: 'Rheinland', ort: 'Köln', bib: 'Dombibliothek', sig: 'Cod. 1' },
  ut: { sigle: 'Ut 417', region: 'Niederlande', ort: 'Utrecht', bib: 'UB', sig: 'Ms. 417' },
};
const docs = [
  ['aa', 'Aa-1'], ['aa', 'Aa-2'], ['koeln', 'K-1'], ['ut', 'Ut-1'],
].map(([source, label], i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1: 'Antiphon', source, sigle: SOURCES[source].sigle, root: roots[i % roots.length] }));

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const text = (file, page) => execFileSync(PDFTOTEXT, ['-f', String(page), '-l', String(page), '-layout', file, '-']).toString();
const pageCount = (file) => +/Pages:\s+(\d+)/.exec(execFileSync(PDFTOTEXT.replace('pdftotext', 'pdfinfo'), [file]).toString())[1];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });
page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) problems.push('console.error ' + m.text().slice(0, 200)); });
const captured = [];
await page.exposeFunction('__capture', (type, b64) => captured.push({ type, buf: Buffer.from(b64, 'base64') }));
await page.evaluateOnNewDocument(() => {
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    if (obj instanceof Blob) { const fr = new FileReader(); fr.onload = () => window.__capture(obj.type, String(fr.result).split(',')[1]); fr.readAsDataURL(obj); }
    return orig(obj);
  };
});

const clickText = async (sel, label) => { const el = await page.waitForSelector(`${sel} ::-p-text(${label})`, { timeout: 15000 }); await el.click(); };
const openDialog = async () => {
  await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Cover test');
  await page.waitForFunction((n) => (document.querySelector('app-pdf-export-dialog')?.querySelectorAll('ol li').length || 0) >= n, { timeout: 30000 }, docs.length);
};
const waitCaptured = async (n, ms = 120000) => { const t0 = Date.now(); while (captured.length < n) { if (Date.now() - t0 > ms) throw new Error('no download'); await new Promise((r) => setTimeout(r, 200)); } };

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  // sources with the data the placeholders read
  await page.evaluate(async (sources) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = db.transaction('monodi_data', 'readwrite');
    const store = tx.objectStore('monodi_data');
    const list = await new Promise((res) => { const g = store.get('monodi_sources'); g.onsuccess = () => res(g.result); });
    for (const s of list) {
      const d = sources[s.id];
      Object.assign(s, { quellensigle: d.sigle, herkunftsregion: d.region, bibliotheksort: d.ort, bibliothek: d.bib, bibliothekssignatur: d.sig });
    }
    store.put(list, 'monodi_sources');
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  }, SOURCES);
  await page.reload({ waitUntil: 'networkidle0' });
  await openDialog();

  // ── the cover editor ──
  await clickText('app-pdf-export-dialog .nav-link', 'Cover page');
  await page.waitForSelector('app-pdf-export-dialog iframe[title="Cover preview"]', { timeout: 20000 })
    .catch(async (e) => { throw new Error(e.message.split('\n')[0] + ' — dialog says: ' + (await page.evaluate(() => document.querySelector('app-pdf-export-dialog .col-lg-5')?.innerText.replace(/\s+/g, ' ')))); });
  await page.select('app-pdf-export-dialog select[aria-label="Preset"]', 'corpus-monodicum');
  await clickText('app-pdf-export-dialog button', 'Load preset');
  const valueInput = await page.waitForSelector('app-pdf-export-dialog input[aria-label="Variable value"]');
  await valueInput.type('Isabel Kraft');
  const ta = await page.$$('app-pdf-export-dialog textarea[aria-label^="Text of block"]');
  expect(ta.length === 10, `the Corpus Monodicum preset has 10 blocks, found ${ta.length}`);
  // a placeholder chip inserts into the block that was edited last
  await ta[0].click();
  await clickText('app-pdf-export-dialog button', '$ jahr $');
  expect((await page.evaluate((el) => el.value, ta[0])).includes('$jahr$'), 'the chip puts $jahr$ into the focused block');
  await page.evaluate((el) => { el.value = 'CORPUS MONODICUM'; el.dispatchEvent(new Event('input', { bubbles: true })); }, ta[0]);
  await page.waitForFunction(() => document.querySelector('app-pdf-export-dialog iframe[title="Cover preview"]')?.src.startsWith('blob:'), { timeout: 20000 });
  await page.waitForFunction(() => !!document.querySelector('app-pdf-export-dialog [id="oCover2"]'));
  if (!(await page.$eval('#oCover2', (e) => e.checked))) await page.click('#oCover2');

  // page numbers count the cover and the contents: the edition (its part page) is page 3, as in a printed volume
  await clickText('app-pdf-export-dialog .nav-link', 'Print');
  await page.waitForSelector('#oCount', { timeout: 10000 });
  if (!(await page.$eval('#oCount', (e) => e.checked))) await page.click('#oCount');

  // ── volumes: one PDF per region of origin ──
  await clickText('app-pdf-export-dialog .nav-link', 'Volumes');
  // only fields that give a volume context are offered: no folio, line, shelfmark ...
  const offered = await page.$$eval('app-pdf-export-dialog #splitBy option', (os) => os.map((o) => o.value));
  expect(offered.includes('genre') && offered.includes('herkunftsregion') && offered.includes('quelle-id'), `split offers genre, region, manuscript: ${offered}`);
  expect(!offered.some((k) => ['foliostart', 'zeilenstart', 'bibliothekssignatur', 'bibliographischerverweis'].includes(k)), `split does not offer folio, line, shelfmark, reference: ${offered}`);
  // genre & region of origin: one volume per combination, the cover knows both values apart
  await page.select('app-pdf-export-dialog #splitBy', 'genre');
  await page.waitForSelector('app-pdf-export-dialog #splitThen', { timeout: 10000 });
  await page.select('app-pdf-export-dialog #splitThen', 'herkunftsregion');
  await page.waitForFunction(() => document.querySelectorAll('app-pdf-export-dialog li.list-group-item').length === 2, { timeout: 10000 });
  const combos = await page.$$eval('app-pdf-export-dialog li.list-group-item label', (ls) => ls.map((l) => l.textContent.trim()).sort());
  expect(JSON.stringify(combos) === JSON.stringify(['Antiphon · Niederlande', 'Antiphon · Rheinland']), `genre & region make one volume per combination: ${combos}`);
  await page.select('app-pdf-export-dialog #splitThen', '');
  await page.select('app-pdf-export-dialog #splitBy', 'herkunftsregion');
  await page.waitForFunction(() => document.querySelectorAll('app-pdf-export-dialog li.list-group-item').length === 2, { timeout: 10000 });
  captured.length = 0;
  await clickText('app-pdf-export-dialog button', 'Create 2 PDFs');
  await waitCaptured(1);
  const zipPath = join(outDir, 'cover-volumes.zip');
  const zipBlob = captured.find((c) => /zip/.test(c.type));
  expect(!!zipBlob, 'several volumes arrive as one ZIP file');
  if (zipBlob) {
    writeFileSync(zipPath, zipBlob.buf);
    const tmp = mkdtempSync(join(tmpdir(), 'cover-'));
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp]);
    const names = readdirSync(tmp).sort();
    expect(JSON.stringify(names) === JSON.stringify(['Documents_Niederlande.pdf', 'Documents_Rheinland.pdf']), `file names ${names}`);
    for (const [name, want, several] of [['Documents_Rheinland.pdf', ['Aachen, Domarchiv, Hs. G 13; Köln, Dombibliothek, Cod. 1'], true], ['Documents_Niederlande.pdf', ['Utrecht, UB, Ms. 417'], false]]) {
      const f = join(tmp, name);
      const p1 = text(f, 1);
      expect(/CORPUS MONODICUM/.test(p1), `${name}: cover shows the title`);
      expect(/Antiphonen aus/.test(p1), `${name}: "$gattung1$en aus" became "Antiphonen aus"`);
      for (const w of want) expect(p1.replace(/\s+/g, ' ').includes(w), `${name}: cover shows "${w}", got: ${p1.replace(/\s+/g, ' ').slice(0, 400)}`);
      expect(/Isabel Kraft/.test(p1), `${name}: the variable $herausgeber$ is filled in`);
      expect(/herausgegeben von/.test(p1), `${name}: "herausgegeben von" stays`);
      expect(!/\$/.test(p1), `${name}: no placeholder is left on the cover`);
      expect(!/\bSeite\b|\|/.test(p1.replace(/Im Auftrag[^\n]*|am Zentrum[^\n]*/g, '')), `${name}: the cover has no running head`);
      const p2 = text(f, 2);
      if (several) {
        expect(/CONTENTS/i.test(p2), `${name}: the contents page follows the cover`);
        expect(/\b(Aa 13|K 1|Ut 417)\b/.test(p2), `${name}: the contents list the manuscripts of the volume`);
        expect(/Edition/.test(text(f, 3)), `${name}: the edition starts behind the cover and the contents (page 3)`);
        expect(/^\s*Edition[ .]+3\s*$/m.test(p2), `${name}: the contents say the edition begins on page 3, got: ${p2.replace(/[ .]{3,}/g, ' … ').replace(/\s+/g, ' ').slice(0, 200)}`);
      } else {
        // a volume of one document has no contents; its title page (metadata) follows the cover
        expect(/Ut-1/.test(p2), `${name}: the title page of the single document follows the cover`);
      }
      expect(!/\bSeite\b/.test(p2) && !/^\s*\d+\s*$/m.test(p2.split('\n').slice(0, 3).join('\n')), `${name}: the page behind the cover has no running head`);
      expect(pageCount(f) >= 3, `${name}: more than the front matter`);
    }
    // the volume of the other region does not mention the first one's manuscripts
    expect(!/Utrecht/.test(text(join(tmp, 'Documents_Rheinland.pdf'), 1)), 'Rheinland cover does not list Utrecht');
    expect(!/Aachen/.test(text(join(tmp, 'Documents_Niederlande.pdf'), 1)), 'Niederlande cover does not list Aachen');
    // pictures for a look
    for (const name of names) execFileSync(PDFTOPPM, ['-r', '70', '-f', '1', '-l', '1', '-png', join(tmp, name), join(outDir, 'cover-' + name.replace(/\.pdf$/, ''))]);
  }

  // ── nothing split: one PDF with the cover (the dialog remembers the cover choice and the template) ──
  await openDialog();
  captured.length = 0;
  await clickText('app-pdf-export-dialog button', 'Create PDF');
  await waitCaptured(1);
  const pdf = captured.find((c) => /pdf/.test(c.type));
  expect(!!pdf, 'without splitting the PDF comes directly');
  if (pdf) {
    const f = join(outDir, 'cover-single.pdf');
    writeFileSync(f, pdf.buf);
    const p1 = text(f, 1);
    expect(/Antiphonen aus/.test(p1) && /Aachen, Domarchiv, Hs. G 13; Köln, Dombibliothek, Cod. 1; Utrecht, UB, Ms. 417/.test(p1.replace(/\s+/g, ' ')), 'all three manuscripts on the cover of the whole print');
  }
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}
console.log(problems.length ? 'FAIL ' : 'ok   ', 'cover page and volumes', problems.join('\n      '));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(problems.length ? 1 : 0);
