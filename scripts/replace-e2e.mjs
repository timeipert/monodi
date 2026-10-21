// Find & replace in the metadata grid, end to end in a real browser (real keyboard and mouse events):
//  - replaces text across every editable column (or a chosen few), in the rows shown now or in all of them, leaving the
//    rest of a cell's text alone; the preview counts matches and cells before anything is written
//  - "Match case" and "Whole word" narrow the match; the change goes into the table as an edit (undo, save as usual)
//  - selecting a whole column first (Ctrl+Space) and opening the dialog with Ctrl+H starts it on "the selected cells",
//    which ignores the column/row choice
//  - choosing no column at all is refused with a message, Apply stays disabled
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/replace-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

// columns: 0 Document ID, 1 Source, 2 Text Initium, 3 Genre 1, 4 Genre 2 …
const docs = ['D1', 'D2', 'D3', 'D4'].map((id, i) => ({
  id: 'doc' + i, quelle_id: 'src1', dokumenten_id: id, gattung1: 'Antiphon', gattung2: '',
  festtag: '', feier: '', textinitium: ['Ton eins', 'Tonart', 'kein Ton', 'nichts'][i],
  bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
}));
const sources = [{ id: 'src1', quellensigle: 'Aa 13', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '' }];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failures = 0;

async function scenario(name, fn) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('dialog', (d) => d.accept());   // "leave site?" after a save (the backup reminder asks)
  try {
    await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
    await page.evaluate(async ({ docs, sources }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('monodi-light');
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('monodi_data')) r.result.createObjectStore('monodi_data'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const put = (k, v) => new Promise((res, rej) => { const tx = db.transaction('monodi_data', 'readwrite'); tx.objectStore('monodi_data').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      await put('monodi_sources', sources); await put('monodi_documents', docs);
      await put('monodi_notes_index', []); await put('monodi_notes_migrated_v1', true); await put('monodi_settings', {});
      db.close();
    }, { docs, sources });
    await page.goto(BASE + '/#/metadata', { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });   // the app's API cache was filled before the seed; force it to read the fresh data
    await page.waitForSelector(cell(0, 2), { timeout: 20000 });
    await fn(page, problems);
  } catch (e) {
    problems.push(String(e).split('\n')[0]);
  } finally {
    console.log(problems.length ? 'FAIL ' : 'ok   ', name, problems.join('; '));
    if (problems.length) failures++;
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 4000))]);
  }
}

const cell = (pos, ci) => `.mg-cell[data-pos="${pos}"][data-ci="${ci}"]`;
const text = (page, pos, ci) => page.$eval(cell(pos, ci), (e) => e.textContent.trim());
const chord = async (page, mod, k) => { await page.keyboard.down(mod); await page.keyboard.press(k); await page.keyboard.up(mod); };
const dialogText = (page) => page.$eval('[data-testid=replace-dialog]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
const count = (page) => page.$eval('[data-testid=replace-count]', (e) => e.textContent.trim()).catch(() => null);

// 1. plain replace across every column, the change lands in the table, is saved and survives a reload
await scenario('replace across all columns, save and reload', async (page, problems) => {
  await page.click('[data-testid=mg-replace]');
  await page.waitForSelector('[data-testid=replace-dialog]', { timeout: 10000 });
  const dlg0 = await dialogText(page);
  expect(problems, /select some first/.test(dlg0), 'without a selection the dialog explains why "the selected cells" is unavailable: ' + dlg0);
  await page.type('[data-testid=replace-find]', 'Ton');
  await page.type('[data-testid=replace-with]', 'Note');
  await page.waitForFunction(() => document.querySelector('[data-testid=replace-count]')?.textContent.trim() === '3', { timeout: 5000 })
    .catch(async () => problems.push('preview should count 3 cells before anything is written: ' + await dialogText(page)));
  const beforeDocs = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result); }; }));
  expect(problems, beforeDocs.every((d) => !d.textinitium.includes('Note')), 'nothing is written while the dialog is still open');
  await page.click('[data-testid=replace-apply]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=replace-dialog]'), { timeout: 5000 });
  const got = [await text(page, 0, 2), await text(page, 1, 2), await text(page, 2, 2), await text(page, 3, 2)];
  expect(problems, JSON.stringify(got) === JSON.stringify(['Note eins', 'Noteart', 'kein Note', 'nichts']), 'the three cells are replaced in place, the fourth untouched: ' + got.join(' | '));
  const dirty = await page.$eval('[data-testid=mg-dirty]', (e) => e.textContent.trim()).catch(() => '');
  expect(problems, /3/.test(dirty), 'the replacement is an undoable edit, not saved yet: ' + dirty);
  await page.click('[data-testid=mg-save]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=mg-dirty]'), { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(cell(0, 2), { timeout: 15000 });
  expect(problems, await text(page, 0, 2) === 'Note eins', 'the replacement survives a reload');
});

// 2. Match case and Whole word narrow the match
await scenario('match case and whole word narrow the preview', async (page, problems) => {
  await page.click('[data-testid=mg-replace]');
  await page.waitForSelector('[data-testid=replace-dialog]', { timeout: 10000 });
  await page.type('[data-testid=replace-find]', 'ton');
  await page.waitForFunction(() => document.querySelector('[data-testid=replace-count]')?.textContent.trim() === '3', { timeout: 5000 });
  await page.click('[data-testid=replace-case]');
  await page.waitForFunction(() => document.querySelector('[data-testid=replace-count]')?.textContent.trim() === '0', { timeout: 5000 })
    .catch(async () => problems.push('"Match case" must drop the lower-case "ton" matches: ' + await count(page)));
  // "Ton" (match case back on, whole word): "Tonart" no longer counts, "Ton eins" and "kein Ton" still do
  await page.click('[data-testid=replace-case]');
  await page.evaluate(() => { const i = document.querySelector('[data-testid=replace-find]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('[data-testid=replace-find]', 'Ton');
  await page.click('[data-testid=replace-word]');
  await page.waitForFunction(() => document.querySelector('[data-testid=replace-count]')?.textContent.trim() === '2', { timeout: 5000 })
    .catch(async () => problems.push('"Whole word" must drop "Tonart": ' + await count(page)));
});

// 3. no column chosen: the message, Apply disabled
await scenario('no column chosen is refused', async (page, problems) => {
  await page.click('[data-testid=mg-replace]');
  await page.waitForSelector('[data-testid=replace-dialog]', { timeout: 10000 });
  await page.type('[data-testid=replace-find]', 'Ton');
  await page.click('[data-testid=replace-cols-none]');
  await page.waitForFunction(() => /Choose at least one column/.test(document.querySelector('[data-testid=replace-preview]')?.textContent ?? ''), { timeout: 5000 })
    .catch(async () => problems.push('choosing no column should explain why: ' + await dialogText(page)));
  const disabled = await page.$eval('[data-testid=replace-apply]', (b) => b.disabled);
  expect(problems, disabled, 'Apply must be disabled with nothing to do');
});

// 4. a whole column selected first (Ctrl+Space), the dialog opened with Ctrl+H starts on "the selected cells"
await scenario('a selected column, opened with Ctrl+H, replaces only there', async (page, problems) => {
  await page.click(cell(0, 3));   // Genre 1, row 0
  await chord(page, 'Control', ' ');
  const range = await page.$eval('[data-testid=mg-range]', (e) => e.textContent.trim()).catch(() => '(none)');
  expect(problems, range === '4 cells', 'Ctrl+Space selects the whole column: ' + range);
  await chord(page, 'Control', 'h');
  await page.waitForSelector('[data-testid=replace-dialog]', { timeout: 10000 });
  expect(problems, await page.$('[data-testid=replace-columns]') === null, 'with a real selection the dialog starts on "the selected cells", not the column picker');
  const dlg = await dialogText(page);
  expect(problems, /4 selected cells/.test(dlg), 'the dialog names the selected cells: ' + dlg);
  await page.type('[data-testid=replace-find]', 'Antiphon');
  await page.type('[data-testid=replace-with]', 'Ant.');
  await page.waitForFunction(() => document.querySelector('[data-testid=replace-count]')?.textContent.trim() === '4', { timeout: 5000 });
  await page.click('[data-testid=replace-apply]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=replace-dialog]'), { timeout: 5000 });
  const genres = [await text(page, 0, 3), await text(page, 1, 3), await text(page, 2, 3), await text(page, 3, 3)];
  expect(problems, genres.every((g) => g === 'Ant.'), 'all four selected cells were replaced: ' + genres.join(' | '));
  expect(problems, await text(page, 0, 2) === 'Ton eins', 'the column that was not selected is untouched');
});

function expect(problems, cond, msg) { if (!cond) problems.push(msg); }

await browser.close();
if (!failures) console.log('ok   find and replace: all columns, match case / whole word, selection, no column chosen');
process.exit(failures ? 1 : 0);
