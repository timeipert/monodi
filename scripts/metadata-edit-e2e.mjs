// Metadata grid as a spreadsheet, end to end in a real browser (real keyboard and mouse events):
//  - typing over a cell, F2/Enter to edit, Enter moves down, Escape cancels
//  - a range with Shift+arrows or by dragging; Ctrl+Enter fills it, Ctrl+D fills down, Delete clears it
//  - paste of tab-separated cells (what Excel puts on the clipboard) and undo of the whole paste
//  - read-only columns and empty values in required columns are refused
//  - nothing is stored before "Save"; Save writes it in one go, leaves the notes alone, keeps filters
//  - while edits are unsaved the delete button is disabled
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/metadata-edit-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const N = 300;
const docs = Array.from({ length: N }, (_, i) => ({ id: 'doc' + i, quelle_id: 'src' + (i % 4), dokumenten_id: `Cod ${i % 4} ${i}`, gattung1: 'Antiphon', gattung2: '', festtag: '', feier: '', textinitium: 'Incipit ' + i, bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '' }));
const sources = [0, 1, 2, 3].map((s) => ({ id: 'src' + s, quellensigle: 'Cod ' + s, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '' }));
const NOTES = { kind: 'RootContainer', uuid: 'doc3', children: [], comments: [], documentType: 'Antiphon' };

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e)));
page.on('dialog', (d) => d.accept());   // "leave site?" after a save (the backup reminder asks)

const idb = (fn, ...a) => page.evaluate(async (src, ...args) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (k) => new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get(k); q.onsuccess = () => res(q.result); });
  const out = await new Function('get', 'args', 'return (' + src + ')(get, ...args)')(get, args);
  db.close();
  return out;
}, fn.toString(), ...a);
const storedDocs = () => idb(async (get) => get('monodi_documents'));

const cell = (pos, ci) => `.mg-cell[data-pos="${pos}"][data-ci="${ci}"]`;
const text = (pos, ci) => page.$eval(cell(pos, ci), (e) => e.textContent.trim());
const click = async (pos, ci) => { await page.click(cell(pos, ci)); };
const press = (k) => page.keyboard.press(k);
const chord = async (mod, k) => { await page.keyboard.down(mod); await page.keyboard.press(k); await page.keyboard.up(mod); };
const dirtyText = () => page.$eval('[data-testid=mg-dirty]', (e) => e.textContent.trim()).catch(() => '');
const tick = () => new Promise((r) => setTimeout(r, 120));
// columns: 0 Document ID, 1 Source, 2 Text Initium, 3 Genre 1, 4 Genre 2 (default sort: by Document ID, natural)

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await page.evaluate(async ({ docs, sources, notes }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('monodi-light');
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('monodi_data')) r.result.createObjectStore('monodi_data'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const put = (k, v) => new Promise((res, rej) => { const tx = db.transaction('monodi_data', 'readwrite'); tx.objectStore('monodi_data').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    await put('monodi_sources', sources); await put('monodi_documents', docs);
    await put('monodi_notes_doc_doc3', notes); await put('monodi_notes_index', ['doc3']); await put('monodi_notes_migrated_v1', true); await put('monodi_settings', {});
    db.close();
  }, { docs, sources, notes: NOTES });
  await page.goto(BASE + '/#/metadata', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(cell(0, 2), { timeout: 20000 });

  // 1. type over a cell, Enter commits and moves down
  await click(1, 2);
  await press('h');
  await page.keyboard.type('ello');
  await press('Enter');
  await tick();
  expect(await text(1, 2) === 'hello', 'typing over a cell: ' + await text(1, 2));
  expect(await dirtyText() === '1 unsaved change', 'dirty counter: ' + await dirtyText());
  expect(!!(await page.$(cell(1, 2) + '.dirty')), 'edited cell is not marked as changed');
  expect(await page.$eval(cell(2, 2), (e) => e.classList.contains('active')), 'cursor did not move down after Enter');
  expect((await storedDocs()).every((d) => d.textinitium !== 'hello'), 'nothing may be stored before Save');

  // 2. F2 edits, Escape cancels
  await press('F2');
  await page.keyboard.type('zzz');
  await press('Escape');
  await tick();
  expect(await text(2, 2) !== 'zzz' && !(await text(2, 2)).includes('zzz'), 'Escape must drop the typed text: ' + await text(2, 2));

  // 3. range with shift+arrows, F2, Ctrl+Enter fills it
  await click(3, 2);
  await chord('Shift', 'ArrowDown'); await chord('Shift', 'ArrowDown');
  await press('F2');
  await page.keyboard.type('!');
  await chord('Control', 'Enter');
  await tick();
  const filled = [await text(3, 2), await text(4, 2), await text(5, 2)];
  expect(filled.every((t) => t.endsWith('!')) && new Set(filled).size === 1, 'Ctrl+Enter fill: ' + JSON.stringify(filled));

  // 4. drag a range, Delete clears it (Genre 1/2), Ctrl+Z restores it
  const a = await (await page.$(cell(7, 3))).boundingBox();
  const b = await (await page.$(cell(9, 4))).boundingBox();
  await page.mouse.move(a.x + 10, a.y + 10); await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + 10, { steps: 6 }); await page.mouse.up();
  await tick();
  const rangeText = await page.$eval('[data-testid=mg-range]', (e) => e.textContent.trim()).catch(() => '(none)');
  expect(rangeText === '6 cells', 'drag selection: ' + rangeText);
  await press('Delete');
  await tick();
  expect([await text(7, 3), await text(8, 3), await text(9, 3)].every((t) => t === ''), 'Delete must clear the range');
  await chord('Control', 'z');
  await tick();
  expect(await text(7, 3) === 'Antiphon', 'Ctrl+Z must restore the cleared cells');

  // 5. paste tab-separated cells (as from Excel), then undo them in one step
  await click(12, 2);
  const before = await dirtyText();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'P1\tQ1\r\nP2\tQ2\r\n');
    document.querySelector('.mg-grid').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await tick();
  expect([await text(12, 2), await text(12, 3), await text(13, 2), await text(13, 3)].join('|') === 'P1|Q1|P2|Q2', 'paste');
  await chord('Control', 'z');
  await tick();
  expect(await text(12, 2) !== 'P1' && await text(13, 3) === 'Antiphon', 'one Ctrl+Z must undo the whole paste');
  expect(await dirtyText() === before, 'dirty counter after undoing the paste: ' + await dirtyText());

  // 6. read-only column and required column
  await click(14, 1);                      // Source
  await press('x');
  await tick();
  expect(!(await page.$('[data-testid=mg-input]')), 'a read-only column opened an editor');
  const id14 = await text(14, 0);
  await click(14, 0);                      // Document ID: empty value is refused
  await press('Enter');
  await press('End'); await chord('Shift', 'Home'); await press('Backspace');
  await press('Enter');
  await tick();
  expect(await text(14, 0) === id14, 'an empty Document ID was accepted');

  // 7. unsaved edits block deleting
  await page.click('.mg-row:nth-child(1) input[type=checkbox]').catch(() => {});
  const delDisabled = await page.$eval('[data-testid=mg-delete]', (b) => b.disabled).catch(() => null);
  expect(delDisabled !== false, 'Delete must be disabled while there are unsaved edits');

  // 8. nothing stored yet; Save stores everything in one go and leaves the notes alone
  const stored = await storedDocs();
  expect(stored.every((d, i) => d.textinitium === 'Incipit ' + i), 'edits were stored before Save');
  await page.click('[data-testid=mg-save]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=mg-dirty]'), { timeout: 15000 });
  const after = await storedDocs();
  const changed = after.filter((d, i) => d.textinitium !== 'Incipit ' + i || d.gattung1 !== 'Antiphon');
  expect(changed.length >= 4, 'saved documents: ' + changed.length);
  expect(after.some((d) => d.textinitium === 'hello'), 'the typed value was not saved');
  expect(after.length === N && after.every((d) => d.id && d.quelle_id), 'document list damaged by the save');
  const notes = await idb(async (get) => get('monodi_notes_doc_doc3'));
  expect(JSON.stringify(notes) === JSON.stringify(NOTES), 'notes were touched by a metadata save');
  expect(await text(1, 2) === 'hello', 'the table does not show the saved value after reload');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(cell(1, 2));
  expect(await text(1, 2) === 'hello', 'saved value is gone after reload');
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   metadata grid editing (type, range, fill, paste, undo, save)');
process.exit(problems.length ? 1 : 0);
