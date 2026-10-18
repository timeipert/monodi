// Placeholder notes on ZIP import, end to end: Sources → import a monodi+ ZIP.
// The ZIP holds one document with
//   - "tes": a syllable whose only note is a D6 and that has no comment (a lone placeholder, as in the OMMR4all-era data)
//   - "mo": a melody that runs through F3 (a real low note, must stay)
//   - "ia": a syllable whose F3 carries a comment (the old convention; the comment moves onto the syllable)
// With the defaults the lone D6 and the commented F3 are gone and the melody is intact. With the setting
// "remove lone placeholder notes" switched off, the lone D6 stays (the commented F3 still goes).
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/placeholder-import-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const note = (uuid, base, octave) => ({ uuid, noteType: 'Normal', base, liquescent: false, octave, focus: false });
const syl = (uuid, text, notes) => ({ uuid, kind: 'Syllable', text, syllableType: 'Normal', notes: { spaced: [{ nonSpaced: [{ grouped: notes }] }] } });
const root = {
  kind: 'RootContainer', uuid: 'root', documentType: 'Level1',
  comments: [{ startUUID: 'nF3c', endUUID: 'nF3c', text: 'illegible' }],
  children: [{ kind: 'ZeileContainer', uuid: 'z', children: [
    syl('sLone', 'tes', [note('nD6', 'D', 6)]),
    syl('sMelody', 'mo', [note('m1', 'B', 3), note('mF3', 'F', 3), note('m3', 'G', 3)]),
    syl('sCommented', 'ia', [note('nF3c', 'F', 3)]),
  ] }],
};
const zip = new JSZip();
zip.file('Src A/meta.json', JSON.stringify({ id: 'Src A', quellensigle: 'Src A' }));
zip.file('Src A/doc1/meta.json', JSON.stringify({ id: 'doc1', quelle_id: 'Src A', dokumenten_id: 'Src A-1' }));
zip.file('Src A/doc1/data.json', JSON.stringify(root));
const file = join(mkdtempSync(join(tmpdir(), 'monodi-ph-')), 'export.zip');
writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const idb = (page, key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const notesOf = (doc, text) => {
  const lines = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.kind === 'Syllable') lines.push(o); Object.values(o).forEach(walk); } };
  walk(doc.children);
  const s = lines.find((x) => x.text === text);
  return s ? s.notes.spaced.flatMap((a) => a.nonSpaced.flatMap((b) => b.grouped)).map((n) => n.base + n.octave) : null;
};

async function run(label, settings, expectLone) {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push(`${label} console: ` + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push(`${label} pageerror: ` + String(e).slice(0, 200)));
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await page.evaluate(async (settings) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('monodi-light');
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('monodi_data')) r.result.createObjectStore('monodi_data'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const put = (k, v) => new Promise((res, rej) => { const tx = db.transaction('monodi_data', 'readwrite'); tx.objectStore('monodi_data').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    await put('monodi_sources', []); await put('monodi_documents', []);
    await put('monodi_notes_index', []); await put('monodi_notes_migrated_v1', true); await put('monodi_settings', settings);
    db.close();
  }, settings);
  await page.reload({ waitUntil: 'networkidle0' });
  await (await page.waitForSelector('#importOmmrFile')).uploadFile(file);
  await page.waitForFunction(() => /Import complete/.test(document.body.innerText), { timeout: 60000 })
    .catch(() => problems.push(`${label}: the import did not finish`));
  const doc = await idb(page, 'monodi_notes_doc_doc1');
  if (!doc) { problems.push(`${label}: the document's notes were not stored`); await page.close(); return; }
  expect(JSON.stringify(notesOf(doc, 'mo')) === '["B3","F3","G3"]', `${label}: the melody through F3 must stay intact, got ${JSON.stringify(notesOf(doc, 'mo'))}`);
  const lone = notesOf(doc, 'tes');
  expect(expectLone ? lone?.length === 1 : lone?.length === 0, `${label}: lone D6 ${expectLone ? 'must stay' : 'must be removed'}, got ${JSON.stringify(lone)}`);
  expect(notesOf(doc, 'ia')?.length === 0, `${label}: the commented F3 must be moved off its syllable, got ${JSON.stringify(notesOf(doc, 'ia'))}`);
  expect(doc.comments[0].startUUID === 'sCommented' && doc.comments[0].endUUID === 'sCommented', `${label}: the comment must sit on the syllable`);
  await page.close();
}

try {
  await run('default settings', {}, false);
  await run('clearLonePlaceholders off', { clearLonePlaceholders: false }, true);
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   ZIP import clears lone placeholder notes (setting respected), keeps real F3 in melodies');
process.exit(problems.length ? 1 : 0);
