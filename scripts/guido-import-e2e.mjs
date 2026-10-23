// GUIDO (Word) import, end to end: Sources -> import a .docx typed in the GUIDO font.
// The .docx is built here (JSZip): one table, three code rows.
//   - "Str-1": a virga after a punctum (flag V), a plica, a quilisma, a short gap (n) and a full gap (-)
//   - "Str-2": the same melody written in grey (a copy, not attested) except one syllable of its own text
//   - "Str-9": only grey, so nothing is imported for it
// The dialog must list the sources, the import must store the documents with the right notes, a second
// import must offer to keep / copy / replace, and a template saved in the dialog must stay in the settings.
// Needs a dev server (npm start, port 4299) or pass --url. Fresh headless-Chrome profile, never touches your data.
// Run: node scripts/guido-import-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const run = (text, { font, grey } = {}) =>
  `<w:r><w:rPr>${font ? `<w:rFonts w:ascii="${font}"/>` : ''}${grey ? '<w:color w:val="BFBFBF"/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const cell = (xml) => `<w:tc><w:p>${xml}</w:p></w:tc>`;
const code = (t, grey) => cell(run(t, { grey }));                 // no font set: the document's default is the GUIDO font
const word = (t) => cell(run(t, { font: 'Times New Roman' }));
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const blank = cell('');
const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>
  <w:p>${run('R 7_Test chant', { font: 'Times New Roman' })}</w:p>
  <w:tbl>
    ${row(word('Str-1'), code('<--'), code('4t¬5%--6\\7----'), code('4t-n6u'))}
    ${row(blank, blank, word('Do-'), word('mine'))}
    ${row(word('Str-2'), code('<--'), code('4t¬5%--6\\7----', true), code('5555'))}
    ${row(blank, blank, blank, word('mi-ne'))}
    ${row(word('Str-9'), code('<--'), code('4', true), code('5', true))}
  </w:tbl></w:body></w:document>`;
const styles = `<w:styles ${NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="guido6+"/></w:rPr></w:style></w:styles>`;
const zip = new JSZip();
zip.file('word/document.xml', doc);
zip.file('word/styles.xml', styles);
const file = join(mkdtempSync(join(tmpdir(), 'monodi-guido-')), 'R 7.docx');
writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));

const problems = [];
const expect = (cond, msg) => { if (!cond) problems.push(msg); };
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));

const idb = (key) => page.evaluate((key) => new Promise((res, rej) => {
  const r = indexedDB.open('monodi-light');
  r.onsuccess = () => { const q = r.result.transaction('monodi_data').objectStore('monodi_data').get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), key);
const syllables = (root) => {
  const out = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.kind === 'Syllable') out.push(o); Object.values(o).forEach(walk); } };
  walk(root.children);
  return out;
};
const neumes = (s) => s.notes.spaced.map((ne) => ne.nonSpaced.map((g) => g.grouped.map((n) => `${n.base}${n.octave}${n.noteType === 'Quilisma' ? '~' : ''}${(n.flags ?? []).join('')}`)));
const dialogText = () => page.evaluate(() => document.getElementById('guido-import-dialog')?.innerText ?? '');
const pick = async () => {
  await (await page.waitForSelector('#importGuidoFile')).uploadFile(file);
  await page.waitForSelector('#guido-import-dialog', { timeout: 20000 });
  await page.waitForFunction(() => /syllables/.test(document.getElementById('guido-import-dialog')?.innerText ?? ''), { timeout: 20000 });
};
const click = (sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast-message')].map((e) => e.innerText).join(' | '));

try {
  await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });

  // 1. first import
  await pick();
  const t1 = await dialogText();
  expect(/Str-1\s+—\s+2 syllables/.test(t1), 'the dialog must list Str-1 with 2 syllables: ' + t1.slice(0, 300));
  expect(/Str-2\s+—\s+1 syllables/.test(t1), 'the dialog must list Str-2 with its one attested syllable');
  expect(/Nothing attested[^]*Str-9/.test(t1), 'Str-9 (only grey) must be reported as not imported');
  expect(/V, P, T, F, H, U/.test(t1), 'the dialog must say which note flags it adds');
  await click('#guido-confirm');
  await page.waitForFunction(() => !document.getElementById('guido-import-dialog'), { timeout: 20000 });
  expect(/3 new sources|2 new sources/.test(await toasts()), 'the import must report its sources: ' + await toasts());

  const d1 = await idb('monodi_notes_doc_Str-1-R 7');
  if (!d1) problems.push('Str-1: the notes were not stored');
  else {
    const s = syllables(d1);
    expect(JSON.stringify(s.map((x) => x.text)) === '["Do-","mine"]', 'Str-1 texts: ' + JSON.stringify(s.map((x) => x.text)));
    // 4 t(virga) ¬(quilisma step 3) 5 + plica | 6 7 : one neume, the full gap "--" splits before 6
    expect(JSON.stringify(neumes(s[0])) === JSON.stringify([[['G4', 'A4V', 'F4~', 'A4P']], [['B4', 'C5']]]),
      'Str-1 "Do-": ' + JSON.stringify(neumes(s[0])));
    // 4 t - n 6 u : full gap, then a short gap with nothing before it, then 6 u
    expect(JSON.stringify(neumes(s[1])) === JSON.stringify([[['G4', 'A4V']], [['B4', 'C5V']]]), 'Str-1 "mine": ' + JSON.stringify(neumes(s[1])));
  }
  const d2 = await idb('monodi_notes_doc_Str-2-R 7');
  const s2 = d2 ? syllables(d2) : [];
  expect(JSON.stringify(s2.map((x) => x.text)) === '["mi-ne"]', 'Str-2 keeps only its own, own-text syllable: ' + JSON.stringify(s2.map((x) => x.text)));
  expect((await idb('monodi_notes_doc_Str-9-R 7')) === null, 'Str-9 must not be imported');
  const settings = await idb('monodi_settings');
  expect(JSON.stringify((settings?.noteFlags ?? []).map((f) => f.key)) === '["V","P","T","F","H","U"]', 'the settings must get the note flags: ' + JSON.stringify(settings?.noteFlags));

  // 2. importing the same file again: keep (default), then copy
  await pick();
  const t2 = await dialogText();
  expect(/2 of these documents are already in the workspace/.test(t2), 'a second import must find the documents: ' + t2.slice(0, 400));
  expect(await page.evaluate(() => document.getElementById('guido-confirm').disabled), 'keeping everything leaves nothing to import');
  await click('#guido-copy');
  await page.waitForFunction(() => !document.getElementById('guido-confirm').disabled, { timeout: 10000 });
  await click('#guido-confirm');
  await page.waitForFunction(() => !document.getElementById('guido-import-dialog'), { timeout: 20000 });
  expect((await idb('monodi_notes_doc_Str-1-R 7 (2)')) !== null, 'copy mode must store "Str-1-R 7 (2)"');
  expect((await idb('monodi_notes_doc_Str-1-R 7')) !== null, 'the original must stay');

  // 3. a template saved in the dialog stays in the settings and is used
  await pick();
  await page.evaluate(() => [...document.querySelectorAll('#guido-import-dialog button')].find((b) => /Edit/.test(b.innerText)).click());
  await page.waitForSelector('#guido-template-json');
  await page.evaluate(() => {
    const ta = document.getElementById('guido-template-json');
    const t = JSON.parse(ta.value); t.id = 'e2e'; t.name = 'e2e template'; t.mapping.shapes.virga = { noteType: 'Descending' };
    ta.value = JSON.stringify(t); ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#guido-import-dialog button')].find((b) => /Save as template/.test(b.innerText)).click();
  });
  await page.waitForFunction(() => document.getElementById('guido-template')?.selectedOptions[0]?.innerText === 'e2e template', { timeout: 10000 });
  expect(JSON.stringify(((await idb('monodi_settings'))?.guidoImportTemplates ?? []).map((t) => t.id)) === '["e2e"]', 'the template must be in the settings');
  await page.evaluate(() => {
    const ta = document.getElementById('guido-template-json');
    ta.value = '{"id":"bad","name":"b","glyphTable":"nope"}'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#guido-import-dialog button')].find((b) => /Save as template/.test(b.innerText)).click();
  });
  await page.waitForFunction(() => /Unknown glyph table/.test(document.getElementById('guido-import-dialog')?.innerText ?? ''), { timeout: 10000 })
    .catch(() => problems.push('a bad template must show its error'));
} catch (e) {
  problems.push(String(e).split('\n')[0]);
}

await browser.close();
for (const p of problems) console.log('FAIL', p);
if (!problems.length) console.log('ok   GUIDO import: dialog, notes (virga flag V, quilisma, plica, gaps), keep/copy, templates');
process.exit(problems.length ? 1 : 0);
