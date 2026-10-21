// Renaming a siglum and merging two sources, end to end in a real browser:
//  - the dialog on the source page shows what would change before anything is written (cancel writes nothing)
//  - a rename: the source and the places in the settings that repeat the siglum follow; the documents stay where they are;
//    only that source is marked for the next push
//  - a merge (the new siglum is that of another source): the documents move over, what only the absorbed source knew is
//    taken over, a conflict is decided in the dialog, the settings follow; the stayed source is marked for upload and the
//    absorbed one for deletion *after* it (the push cache holds that order)
//  - a merge that would lose something (the same document in both with different content) is refused and writes nothing
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/sigle-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const src = (id, quellensigle, more = {}) => ({ id, quellensigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '', quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...more });
const doc = (id, quelle_id, dokumenten_id, more = {}) => ({ id, quelle_id, dokumenten_id, gattung1: 'Antiphon', gattung2: '', festtag: '', feier: '', textinitium: 'Incipit ' + id, bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '', ...more });
const note = (id) => ({ kind: 'RootContainer', uuid: id, children: [], comments: [], documentType: 'Antiphon' });

const SOURCES = () => [
  src('src-a', 'Aa 13', { herkunftsort: 'Aachen', custom: { description: 'About A' } }),
  src('src-b', 'Bb 7', { herkunftsort: 'Bonn', datierung: '12th c.', custom: { description: 'About B' } }),
  src('src-c', 'Cc 1'),
];
const DOCS = () => [doc('da1', 'src-a', 'A-1'), doc('da2', 'src-a', 'A-2'), doc('db1', 'src-b', 'B-1'), doc('db2', 'src-b', 'A-2'), doc('dc1', 'src-c', 'C-1')];
const SETTINGS = () => ({
  quellensigle: ['Aa 13', 'Bb 7', 'Cc 1'],
  meiProfiles: [{ version: 2, id: 'p1', name: 'P', skeleton: [], emitHeader: false, entities: {}, patternRules: [
    { id: 'r1', pattern: '[*u]', sigle: 'Bb 7', enabled: true, nc: [] },
    { id: 'r2', pattern: '[*u]', sigle: 'Cc 1', enabled: true, nc: [] },
  ] }],
  volumeRules: [{ name: 'Volume', field: 'quelle-id', op: 'in', values: ['Bb 7', 'Cc 1'] }],
});
const NOTE_IDS = ['da1', 'da2', 'db1', 'db2', 'dc1'];

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e)));
page.on('dialog', (d) => d.accept());

const idb = (fn, ...a) => page.evaluate(async (srcText, ...args) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monodi-light'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const get = (k) => new Promise((res) => { const q = db.transaction('monodi_data').objectStore('monodi_data').get(k); q.onsuccess = () => res(q.result); });
  const out = await new Function('get', 'args', 'return (' + srcText + ')(get, ...args)')(get, args);
  db.close();
  return out;
}, fn.toString(), ...a);
const stored = (key) => idb(async (get, k) => get(k), key);
const storedAll = async () => ({
  sources: await stored('monodi_sources'), documents: await stored('monodi_documents'), settings: await stored('monodi_settings'),
  clean: await stored('monodi_push_clean_manuscripts'), deleted: await stored('monodi_push_pending_deletions'),
  after: await stored('monodi_push_deletions_after'),
  notes: await idb(async (get, ids) => Promise.all(ids.map((i) => get('monodi_notes_doc_' + i))), NOTE_IDS),
});

async function seed({ docs = DOCS() } = {}) {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await page.evaluate(async ({ sources, docs, settings, notes, noteIds }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('monodi-light');
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('monodi_data')) r.result.createObjectStore('monodi_data'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const put = (k, v) => new Promise((res, rej) => { const tx = db.transaction('monodi_data', 'readwrite'); tx.objectStore('monodi_data').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    await put('monodi_sources', sources); await put('monodi_documents', docs); await put('monodi_settings', settings);
    for (const n of notes) await put('monodi_notes_doc_' + n.uuid, n);
    await put('monodi_notes_index', noteIds); await put('monodi_notes_migrated_v1', true);
    await put('monodi_push_clean_manuscripts', sources.map((s) => s.id)); await put('monodi_push_pending_deletions', []); await put('monodi_push_deletions_after', {});
    db.close();
  }, { sources: SOURCES(), docs, settings: SETTINGS(), notes: NOTE_IDS.map(note), noteIds: NOTE_IDS });
}

/** Opens the source page, its metadata panel and the siglum dialog. */
async function openDialog(id) {
  await page.goto(BASE + '/#/source/' + id, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Edit Metadata/.test(b.textContent)), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Edit Metadata/.test(b.textContent)).click());
  await page.waitForSelector('[data-testid=sigle-open]');
  await page.click('[data-testid=sigle-open]');
  await page.waitForSelector('[data-testid=sigle-dialog]');
}
async function typeSigle(text) {
  await page.focus('[data-testid=sigle-input]');
  await page.$eval('[data-testid=sigle-input]', (e) => e.select());
  await page.keyboard.type(text);
}
const preview = async (kind) => { await page.waitForSelector(`[data-testid=sigle-preview][data-kind=${kind}]`, { timeout: 10000 }); return page.$eval('[data-testid=sigle-preview]', (e) => e.textContent.replace(/\s+/g, ' ').trim()); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  // ── 1. cancel writes nothing; the preview of a rename ───────────────────────────────────────────────
  await seed();
  const before = await storedAll();
  await openDialog('src-c');
  await typeSigle('Cc 1b');
  const text1 = await preview('rename');
  expect(/becomes Cc 1b/.test(text1), 'rename preview: ' + text1);
  expect(await page.$eval('[data-testid=sigle-settings]', (e) => e.textContent).then((t) => /list of sigla/.test(t) && /1 MEI rule/.test(t) && /1 volume rule/.test(t)), 'the preview does not say which settings follow');
  expect(same(await storedAll(), before), 'the preview wrote something');
  await page.click('[data-testid=sigle-cancel]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=sigle-dialog]'));
  expect(same(await storedAll(), before), 'cancel wrote something');

  // ── 2. rename ────────────────────────────────────────────────────────────────────────────────────────
  await openDialog('src-c');
  await typeSigle('Cc 1b');
  await preview('rename');
  await page.click('[data-testid=sigle-apply]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=sigle-dialog]'), { timeout: 10000 });
  const r = await storedAll();
  expect(same(r.sources.map((s) => s.quellensigle), ['Aa 13', 'Bb 7', 'Cc 1b']), 'rename: sources ' + JSON.stringify(r.sources.map((s) => s.quellensigle)));
  expect(same(r.documents, before.documents), 'rename: the document list changed');
  expect(same(r.notes, before.notes), 'rename: notes changed');
  expect(same(r.settings.quellensigle, ['Aa 13', 'Bb 7', 'Cc 1b']), 'rename: list of sigla ' + JSON.stringify(r.settings.quellensigle));
  expect(r.settings.meiProfiles[0].patternRules.map((x) => x.sigle).join() === 'Bb 7,Cc 1b', 'rename: MEI rule not followed');
  expect(same(r.settings.volumeRules[0].values, ['Bb 7', 'Cc 1b']), 'rename: volume rule not followed');
  expect(same([...r.clean].sort(), ['src-a', 'src-b']), 'rename: only the renamed source may be marked for upload: clean = ' + JSON.stringify(r.clean));
  expect(same(r.deleted, []), 'rename: nothing may be marked for deletion');
  expect(await page.$eval('.source-title', (e) => e.textContent.trim()) === 'Cc 1b', 'rename: the page still shows the old siglum');

  // ── 3. merge: preview, conflicts, decision ───────────────────────────────────────────────────────────
  await seed();
  const before3 = await storedAll();
  await openDialog('src-b');
  await typeSigle('Aa 13');
  const text3 = await preview('merge');
  expect(await page.$eval('[data-testid=sigle-moved]', (e) => e.textContent.trim()) === '2', 'merge preview: documents moved: ' + text3);
  expect(/Bb 7 is merged into Aa 13/.test(text3), 'merge preview text: ' + text3);
  expect((await page.$eval('[data-testid=sigle-clashes]', (e) => e.textContent).catch(() => '')).includes('A-2'), 'the document ID used in both is not shown');
  const conflicts = await page.$$eval('[data-testid=sigle-conflicts] select', (els) => els.map((e) => e.dataset.testid));
  expect(same(conflicts, ['sigle-choice-herkunftsort', 'sigle-choice-custom.description']), 'merge conflicts: ' + JSON.stringify(conflicts));
  await page.select('[data-testid=sigle-choice-herkunftsort]', 'other');
  await page.select('[data-testid="sigle-choice-custom.description"]', 'both');
  await page.waitForFunction(() => document.querySelector('[data-testid=sigle-choice-herkunftsort]').value === 'other');
  expect(/first, then deletes Bb 7/.test(await page.$eval('[data-testid=sigle-upload]', (e) => e.textContent.replace(/\s+/g, ' '))), 'the preview does not say in which order the push goes');
  expect(same(await storedAll(), before3), 'the preview of a merge wrote something');

  // ── 4. merge: apply ──────────────────────────────────────────────────────────────────────────────────
  await page.click('[data-testid=sigle-apply]');
  await page.waitForFunction(() => location.hash === '#/source/src-a', { timeout: 10000 });
  const m = await storedAll();
  expect(same(m.sources.map((s) => s.id), ['src-a', 'src-c']), 'merge: sources ' + JSON.stringify(m.sources.map((s) => s.id)));
  expect(same(m.documents.map((d) => [d.id, d.quelle_id]), [['da1', 'src-a'], ['da2', 'src-a'], ['db1', 'src-a'], ['db2', 'src-a'], ['dc1', 'src-c']]), 'merge: documents ' + JSON.stringify(m.documents.map((d) => [d.id, d.quelle_id])));
  expect(same(m.documents.map((d) => d.dokumenten_id), DOCS().map((d) => d.dokumenten_id)), 'merge: a document ID changed');
  const kept = m.sources[0];
  expect(kept.herkunftsort === 'Bonn' && kept.datierung === '12th c.', 'merge: chosen value / value only the absorbed source knew: ' + JSON.stringify(kept));
  expect(kept.custom.description === 'About A\n\nAbout B', 'merge: description ' + JSON.stringify(kept.custom));
  expect(same(m.notes, before3.notes), 'merge: notes changed');
  expect(same(m.settings.quellensigle, ['Aa 13', 'Cc 1']), 'merge: list of sigla ' + JSON.stringify(m.settings.quellensigle));
  expect(same(m.settings.meiProfiles[0].patternRules.map((x) => [x.id, x.sigle]), [['r1', 'Aa 13'], ['r2', 'Cc 1']]), 'merge: MEI rule ' + JSON.stringify(m.settings.meiProfiles[0].patternRules));
  expect(same(m.settings.volumeRules[0].values, ['Aa 13', 'Cc 1']), 'merge: volume rule ' + JSON.stringify(m.settings.volumeRules[0].values));
  expect(same(m.clean, ['src-c']), 'merge: only the untouched source may be clean: ' + JSON.stringify(m.clean));
  expect(same(m.deleted, ['src-b']), 'merge: the absorbed source must be marked for deletion: ' + JSON.stringify(m.deleted));
  expect(same(m.after, { 'src-b': 'src-a' }), 'merge: the deletion must wait for the source that took over: ' + JSON.stringify(m.after));
  await page.waitForFunction(() => document.body.innerText.includes('B-1'), { timeout: 10000 });
  expect(await page.$eval('.source-title', (e) => e.textContent.trim()) === 'Aa 13', 'merge: the page does not show the source that stays');

  // ── 5. a merge that would lose a document is refused ─────────────────────────────────────────────────
  await seed({ docs: [doc('da1', 'src-a', 'A-1', { textinitium: 'one' }), doc('da1', 'src-b', 'A-1', { textinitium: 'two' })] });
  const before5 = await storedAll();
  await openDialog('src-b');
  await typeSigle('Aa 13');
  await page.waitForSelector('[data-testid=sigle-problem]', { timeout: 10000 });
  expect(await page.$eval('[data-testid=sigle-apply]', (b) => b.disabled), 'a refused merge can be applied');
  expect(same(await storedAll(), before5), 'a refused merge wrote something');
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   siglum rename and merge (preview, rename, merge with conflicts, refused merge, push order marks)');
process.exit(problems.length ? 1 : 0);
