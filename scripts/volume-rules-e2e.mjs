// Volume rules, end to end through the real print dialog (Volumes tab → "Volume rules"):
//  - a volume can hold several genres (Kyrie, Gloria, Sanctus → "Ordinary")
//  - the first rule that fits decides: a play (documents with a Unit ID) comes before the genre rules, and its antiphon
//    is not in the antiphon volume as well; "one volume per value" makes a volume per play
//  - the volumes stand in the order of the rules, the documents no rule fits come last
//  - moving a rule changes the order; the rules can be kept for the project and come back in a new dialog
//  - the PDF of one volume holds exactly the documents of that volume
// Needs a dev server (npm start, port 4299) or pass --url, and poppler (pdftotext). Fresh headless-Chrome profile.
// Run: node scripts/volume-rules-e2e.mjs [--url http://localhost:4299]
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
const SPEC = [['Kyr-1', 'Kyrie'], ['Glo-1', 'Gloria'], ['San-1', 'Sanctus'], ['Tro-1', 'Tropus'], ['Ant-1', 'Antiphon'], ['Pla-1', 'Antiphon'], ['Pla-2', 'Hymnus'], ['Hym-1', 'Hymnus']];
const docs = SPEC.map(([label, genre1], i) => ({ id: `d${i}`, label, incipit: `Incipit ${label}`, genre1, sigle: 'Aa 13', root: roots[i % roots.length] }));
const units = { d5: 'play-1', d6: 'play-1' };   // Pla-1 and Pla-2 belong to one play

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1500, height: 1100 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
const pdfs = [];
await capturePdfDownloads(page, (buf) => pdfs.push(buf));

const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const volumes = () => page.$$eval('app-pdf-export-dialog li.list-group-item', (li) => li.map((e) => `${e.querySelector('label').textContent.trim()} ${e.querySelector('.badge').textContent.trim()}`));
const dlg = (sel) => 'app-pdf-export-dialog ' + sel;
const clickText = async (sel, text) => {
  const el = await page.waitForSelector(`${sel} ::-p-text(${text})`, { timeout: 10000 });
  await el.click();
};

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, { customDocumentFields: [{ key: 'unit_id', label: 'Unit ID' }] });
  await page.evaluate(async (units) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const list = await new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result); });
    for (const d of list) if (units[d.id]) d.custom = { unit_id: units[d.id] };
    await new Promise((res) => { const t = db.transaction('monodi_data', 'readwrite'); t.objectStore('monodi_data').put(list, 'monodi_documents'); t.oncomplete = res; });
    db.close();
  }, units);
  await page.reload({ waitUntil: 'networkidle0' });

  await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Rules test');
  await clickText('app-pdf-export-dialog .nav-link', 'Volumes');
  await page.select(dlg('#splitBy'), '@rules');
  await page.waitForSelector(dlg('[data-testid=vr-editor]'));

  // ── rule 1: the ordinary, three genres in one volume ──
  await page.type(dlg('[data-testid=vr-rule-0] [data-testid=vr-name]'), 'Ordinary');
  await page.type(dlg('[data-testid=vr-rule-0] [data-testid=vr-values]'), 'Kyrie, Gloria, Sanctus');
  const hint = norm(await page.$eval(dlg('[data-testid=vr-rule-0]'), (e) => e.textContent));
  expect(/Kyrie \(1\)/.test(hint) && /Hymnus \(2\)/.test(hint), 'the rule shows the genres of the selection with their counts: ' + hint);
  // ── rule 2: tropes and antiphons ──
  await page.click(dlg('[data-testid=vr-add]'));
  await page.type(dlg('[data-testid=vr-rule-1] [data-testid=vr-name]'), 'Tropes and antiphons');
  await page.type(dlg('[data-testid=vr-rule-1] [data-testid=vr-values]'), 'Tropus; Antiphon');
  // ── rule 3: a volume per play; added last, then moved to the top ──
  await page.click(dlg('[data-testid=vr-add]'));
  await page.type(dlg('[data-testid=vr-rule-2] [data-testid=vr-name]'), 'Play');
  await page.select(dlg('[data-testid=vr-rule-2] [data-testid=vr-field]'), 'unit_id');
  await page.select(dlg('[data-testid=vr-rule-2] [data-testid=vr-op]'), 'set');
  await page.click(dlg('[data-testid=vr-rule-2] [data-testid=vr-each]'));

  let vols = await volumes();
  // before the move the play rule is last: Pla-1, an antiphon, is taken by the genre rule above it (first rule wins)
  expect(vols.join(' | ') === ['Ordinary 3', 'Tropes and antiphons 3', 'Play · play-1 1', '(no rule fits) 1'].join(' | '),
    'the first rule that fits decides, so Pla-1 stays with the antiphons while the play rule is last: ' + vols.join(' | '));

  for (let k = 0; k < 2; k++) await page.click(dlg('[data-testid=vr-rule-' + (2 - k) + '] button[aria-label="Move up"]'));
  vols = await volumes();
  expect(vols.join(' | ') === ['Play · play-1 2', 'Ordinary 3', 'Tropes and antiphons 2', '(no rule fits) 1'].join(' | '),
    'the volumes stand in the order of the rules, the play first, the rest last: ' + vols.join(' | '));

  // ── keep the rules, they come back in a new dialog ──
  await page.click(dlg('[data-testid=vr-save]'));
  await page.waitForFunction(() => document.querySelector('app-pdf-export-dialog [data-testid=vr-save]')?.disabled, { timeout: 10000 })
    .catch(() => problems.push('"Keep the rules" must be greyed out after saving'));
  const kept = (await idb('monodi_settings')).volumeRules;
  expect(kept?.length === 3 && kept[0].name === 'Play' && kept[0].each === true && kept[0].field === 'unit_id' && kept[1].values.join() === 'Kyrie,Gloria,Sanctus', 'the rules are stored with the project: ' + JSON.stringify(kept));

  // the first dialog is closed like a user would (Cancel), then a new one opens
  await page.evaluate(() => [...document.querySelectorAll('app-pdf-export-dialog button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await page.waitForFunction(() => !document.querySelector('app-pdf-export-dialog'), { timeout: 5000 });
  await openPrintDialog(page, BASE, docs.map((d) => d.id), 'Rules test 2');
  await clickText('app-pdf-export-dialog .nav-link', 'Volumes');
  await page.select(dlg('#splitBy'), '@rules');
  await page.waitForSelector(dlg('[data-testid=vr-rule-2]'), { timeout: 5000 }).catch(() => problems.push('the kept rules must be in the new dialog'));
  expect((await volumes()).length === 4, 'the kept rules make the same four volumes: ' + (await volumes()).join(' | '));

  // ── the PDF of one volume holds its documents and no others ──
  await page.evaluate(() => [...document.querySelectorAll('app-pdf-export-dialog button')].find((b) => b.textContent.trim() === 'None').click());
  await page.waitForFunction(() => /0 selected/.test(document.querySelector('app-pdf-export-dialog')?.textContent ?? ''), { timeout: 5000 });
  const li = await page.waitForSelector(dlg('li.list-group-item ::-p-text(Ordinary)'));
  await li.click();   // the label switches its checkbox
  await page.waitForFunction(() => /1 selected/.test(document.querySelector('app-pdf-export-dialog')?.textContent ?? ''), { timeout: 5000 })
    .catch(() => problems.push('one volume must be selected'));
  const before = pdfs.length;
  await page.waitForFunction(() => document.querySelector('app-pdf-export-dialog .btn-danger.px-4')?.textContent.trim() === 'Create PDF', { timeout: 5000 })
    .catch(() => problems.push('with one volume selected the button must say "Create PDF"'));
  await page.click(dlg('.btn-danger.px-4'));
  const t0 = Date.now();
  while (pdfs.length === before) {
    if (Date.now() - t0 > 120000) throw new Error('no PDF arrived');
    await new Promise((r) => setTimeout(r, 200));
  }
  const out = join(mkdtempSync(join(tmpdir(), 'monodi-rules-')), 'ordinary.pdf');
  writeFileSync(out, pdfs[pdfs.length - 1]);
  const text = execFileSync(PDFTOTEXT, ['-layout', out, '-']).toString();
  for (const kept of ['Kyr-1', 'Glo-1', 'San-1']) expect(text.includes(kept), `${kept} belongs to the ordinary volume`);
  for (const other of ['Tro-1', 'Ant-1', 'Pla-1', 'Pla-2', 'Hym-1']) expect(!text.includes(other), `${other} is not in the ordinary volume`);
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   volume rules (merged genres, first rule wins, one volume per play, kept for the project)');
process.exit(problems.length ? 1 : 0);
