// Metadata grid, end to end in a real browser: "delete every document whose ID ends on GS".
// A seeded workspace has documents that end on GS (in two spellings), documents that only contain or start with
// GS (these must survive: "ends with" is not a substring match), and enough rows that the table has to scroll.
// The test filters through the real UI, selects all matching rows with the header checkbox, deletes them through
// the confirmation dialog (typing the count) and then reads what is left from IndexedDB.
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/metadata-grid-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const N = 600;
const docs = [];
for (let i = 0; i < N; i++) {
  let label = `Cod ${i % 4} ${i}`;
  if (i % 5 === 0) label += ' GS';          // ends on GS
  else if (i % 13 === 0) label += ' gs';    // ends on gs (other case)
  else if (i % 11 === 0) label = `GS ${label}`;   // starts with GS, must stay
  else if (i % 17 === 0) label += ' GSX';   // GS in the middle of the end, must stay
  docs.push({ id: 'doc' + i, quelle_id: 'src' + (i % 4), dokumenten_id: label, gattung1: 'Antiphon', gattung2: '', festtag: '', feier: '', textinitium: 'Incipit ' + i, bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '' });
}
const sources = [0, 1, 2, 3].map((s) => ({ id: 'src' + s, quellensigle: 'Cod ' + s, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '' }));
const doomed = docs.filter((d) => /gs$/i.test(d.dokumenten_id));
const kept = docs.filter((d) => !/gs$/i.test(d.dokumenten_id));

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e)));

const readDocs = () => page.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get('monodi_documents'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}));
const countText = () => page.$eval('[data-testid=mg-count]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
const waitCount = (shown) => page.waitForFunction((n) => /^\d+/.test(document.querySelector('[data-testid=mg-count]')?.textContent.trim() ?? '') && Number(document.querySelector('[data-testid=mg-count] strong').textContent) === n, { timeout: 15000 }, shown);

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
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid=mg-grid]', { timeout: 20000 });
  await waitCount(N);

  // virtual scroll: far fewer rows in the DOM than in the table
  const domRows = await page.$$eval('.mg-row', (r) => r.length);
  expect(domRows > 0 && domRows < 100, `expected a virtual-scrolled body, found ${domRows} row elements for ${N} documents`);

  // the rule: Document ID ends with GS
  await page.click('[data-testid=mg-add-filter]');
  await page.select('.mg-filter .mg-col', 'dokumenten_id');
  await page.select('.mg-filter .mg-op', 'endsWith');
  await page.click('.mg-filter .mg-value');
  await page.keyboard.type('GS');
  await waitCount(doomed.length);
  expect(await countText() === `${doomed.length} of ${N} documents`, 'status line: ' + await countText());

  // select every matching row, not only the visible ones, and delete
  await page.click('[data-testid=mg-select-all]');
  await page.waitForFunction((n) => document.querySelector('[data-testid=mg-selected]')?.textContent.trim() === `${n} selected`, { timeout: 5000 }, doomed.length);
  await page.click('[data-testid=mg-delete]');
  await page.waitForSelector('[data-testid=mg-delete-dialog]');
  expect(await page.$eval('[data-testid=mg-confirm-delete]', (b) => b.disabled), 'confirm must be disabled until the count is typed');
  await page.type('[data-testid=mg-typed]', String(doomed.length));
  expect(!(await page.$eval('[data-testid=mg-confirm-delete]', (b) => b.disabled)), 'confirm must be enabled once the count is typed');
  await page.click('[data-testid=mg-confirm-delete]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=mg-delete-dialog]'), { timeout: 20000 });

  const left = await readDocs();
  expect(left.length === kept.length, `stored documents: ${left.length}, expected ${kept.length}`);
  expect(!left.some((d) => /gs$/i.test(d.dokumenten_id)), 'a document ending on GS is still stored');
  expect(kept.every((k) => left.some((d) => d.id === k.id)), 'a document that does not end on GS was deleted');
  await waitCount(0);     // the rule is still there, nothing matches any more
  expect(/of \d+ documents$/.test(await countText()) && (await countText()).endsWith(`of ${kept.length} documents`), 'status after delete: ' + await countText());
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   delete documents whose ID ends on GS (' + doomed.length + ' of ' + N + ')');
process.exit(problems.length ? 1 : 0);
