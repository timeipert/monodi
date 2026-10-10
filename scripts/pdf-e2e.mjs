// End-to-end PDF export check. Needs a running dev server (npm start) or pass --url.
// Seeds a fresh headless-Chrome profile (never touches your real data), loads a
// fixture document, triggers the real PDF export in each clef mode and writes the
// PDFs to scratch/compare/. Run: node scripts/pdf-e2e.mjs [fixture-substring] [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const filter = args[0] || '';
const fixtureDirs = [join(here, '../src/app/testdata'), join(here, '../src/app/testdata/extreme')].filter(existsSync);
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });

const MODES = ['document-start', 'every-line', 'every-break'];
// export options per mode: A4 without title page / 21x27 with title page / A4 with title page
const OPTIONS = {
  'document-start': { titlePage: false },
  'every-line': { titlePage: true },
  'every-break': { titlePage: true },
};
const files = fixtureDirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f.includes(filter)).map((f) => join(d, f)));


const PDFTOTEXT = existsSync('/opt/homebrew/bin/pdftotext') ? '/opt/homebrew/bin/pdftotext' : 'pdftotext';
const PDFINFO = existsSync('/opt/homebrew/bin/pdfinfo') ? '/opt/homebrew/bin/pdfinfo' : 'pdfinfo';

function expectedSyllables(root) {
  const out = []; let diastematic = false;
  (function walk(c, adia) {
    if (!c || typeof c !== 'object') return;
    if (c.kind === 'ZeileContainer') adia = c.notation === 'adiastematic';
    if (c.kind === 'Syllable') {
      if (!adia) diastematic = true;
      const t = String(c.text || '').replace(/[-–]+$/g, '').trim();
      if (t && !/^(X|\.\.\.|<\.\.\.>)$/.test(t) && !t.includes(' ')) out.push(t);
    }
    (c.children || []).forEach((k) => walk(k, adia));
  })(root, false);
  return { syllables: out, diastematic };
}

/** Words of the PDF in reading order with geometry, via pdftotext -bbox. */
function pdfWords(file) {
  const xml = execFileSync(PDFTOTEXT, ['-bbox', file, '-']).toString();
  const pageW = +(/<page width="([\d.]+)"/.exec(xml)?.[1] ?? 595);
  const words = [];
  xml.split('<page ').slice(1).forEach((pg, pageNo) => {
    for (const m of pg.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      words.push({ page: pageNo, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') });
    }
  });
  return { pageW, words };
}

function verify(name, mode, file, root, stats = {}) {
  const problems = [];
  const { pageW, words } = pdfWords(file);
  const pageH = +(/<page width="[\d.]+" height="([\d.]+)"/.exec(execFileSync(PDFTOTEXT, ['-bbox', file, '-']).toString())?.[1] ?? 0);
  // page format: the 'cm' run is the printed edition's 21 x 27 cm, the others A4
  const [wantW, wantH] = mode === 'every-line' ? [595.28, 765.35] : [595.28, 841.89];
  if (Math.abs(pageW - wantW) > 1 || Math.abs(pageH - wantH) > 1) problems.push(`page size ${pageW}x${pageH}, expected ${wantW}x${wantH}`);
  // nothing may run into the bottom margin, and no rubric may end a page by itself
  const pageCountAll = Math.max(...words.map((w) => w.page)) + 1;
  for (let pg = 0; pg < pageCountAll; pg++) {
    const onPage = words.filter((w) => w.page === pg);
    const low = onPage.filter((w) => w.y1 > pageH - 56.7 + 2);
    if (low.length) problems.push(`page ${pg + 1}: "${low[0].t}" runs into the bottom margin`);
    const lastY = Math.max(...onPage.map((w) => w.y1));
    const isTitlePage = OPTIONS[mode].titlePage && !words.some((w) => w.page === pg && /^\d+$/.test(w.t) && w.y1 < 70 && w.x1 > pageW - 56.7 - 3);
    if (!isTitlePage && onPage.some((w) => /^RUBRIKBLOCK/.test(w.t) && Math.abs(w.y1 - lastY) < 3) && pg < pageCountAll - 1) problems.push(`page ${pg + 1} ends with a rubric`);
  }
  // a single document has no framed number (that belongs to a printed series), and the Band
  // metadata is never used for it
  if (!OPTIONS[mode].titlePage) {
    if (words.some((w) => w.page === 0 && w.x0 >= 56.7 && w.x0 < 70 && w.t === 'Test' && w.y0 > 40)) problems.push('a single document must not get a framed manuscript label in the margin');
  }
  const pages = +(/Pages:\s+(\d+)/.exec(execFileSync(PDFINFO, [file]).toString())?.[1] ?? 0);
  if (pages < 1) problems.push('no pages');
  const exp = expectedSyllables(root);
  // order-preserving subsequence match (ignoring hyphens, title and paratext words)
  // reading order: cluster words into lines by their bottom edge (runs of different size
  // differ by a fraction of a point), then left to right
  const byBottom = [...words].sort((a, b) => a.page - b.page || a.y1 - b.y1);
  let lineNo = -1, lineY = -1e9, linePage = -1;
  for (const w of byBottom) {
    if (w.page !== linePage || w.y1 - lineY > 2.5) { lineNo++; lineY = w.y1; linePage = w.page; }
    w.line = lineNo;
  }
  const sorted = byBottom.sort((a, b) => a.line - b.line || a.x0 - b.x0);
  const got = sorted.map((w) => w.t.replace(/[-–]+$/g, ''));
  let gi = 0, missing = 0;
  for (const e of exp.syllables) {
    const k = got.indexOf(e, gi);
    if (k < 0) { missing++; } else gi = k + 1;
  }
  // syllables on one system share a text row but y can jitter by <1pt: allow 2% to be mis-sorted
  if (missing > Math.max(2, exp.syllables.length * 0.02)) {
    // small capitals split a syllable into several words: fall back to the concatenated text
    const joined = got.join('');
    let pos = 0, miss2 = 0;
    for (const e of exp.syllables) { const k = joined.indexOf(e.replace(/[-–]/g, ''), pos); if (k < 0) miss2++; else pos = k + e.length; }
    if (miss2 > Math.max(2, exp.syllables.length * 0.02)) problems.push(`${miss2}/${exp.syllables.length} syllables missing or out of order`);
  }
  // right margin (skip stress cases that are wider than the page by design)
  if (!/long-syllable|one-syllable|300-notes/.test(name)) {
    const over = words.filter((w) => w.x1 > pageW - 56.7 + 1);
    if (over.length) problems.push(`${over.length} words beyond right margin (e.g. "${over[0].t}")`);
  }
  // folio labels must all be present; those with room are set flush right at the margin
  const folios = []; (function walk(c) { if (c?.kind === 'FolioChange' && c.text) folios.push(String(c.text).trim()); (c?.children || []).forEach(walk); })(root);
  for (const f of folios) {
    const last = f.split(/\s+/).pop();
    if (!words.some((w) => w.t === last || f.includes(w.t) && w.t.length > 2)) problems.push(`folio label "${f}" missing`);
  }
  // running head on every edition page (page number flush right at the top, numbered from 1);
  // title page(s) carry neither head nor number
  const pageCount = Math.max(...words.map((w) => w.page)) + 1;
  const headNo = (pg) => words.find((w) => w.page === pg && /^\d+$/.test(w.t) && w.y1 < 70 && w.x1 > pageW - 56.7 - 3);
  let titlePages = 0;
  while (titlePages < pageCount && !headNo(titlePages)) titlePages++;
  const wantTitle = OPTIONS[mode].titlePage;
  if (wantTitle ? titlePages < 1 : titlePages !== 0) problems.push(`${titlePages} title page(s), expected ${wantTitle ? 'at least 1' : 'none'}`);
  for (let pg = titlePages; pg < pageCount; pg++) {
    const h = headNo(pg);
    if (!h || h.t !== String(pg - titlePages + 1)) problems.push(`page ${pg + 1}: running head shows "${h?.t}", expected ${pg - titlePages + 1}`);
  }
  // a single document has no contents table (that belongs to printing several documents)
  if (words.some((w) => w.page < titlePages && w.t === 'CONTENTS')) problems.push('a single document must not get a contents table');
  const clefs = words.filter((w) => w.t === 'G').length;
  return { problems, clefs, diastematic: exp.diastematic };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failures = 0;
const clefCounts = {}; const diastematicOf = {};
for (const file of files) {
  const name = file.split('/').pop().replace(/\.json$/, '');
  const root = JSON.parse(readFileSync(file, 'utf8'));
  const id = name.split('__').pop().slice(0, 36) || name;
  for (const mode of MODES) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const out = join(outDir, `${name.slice(0, 40)}.${mode}.pdf`);
    page.on('console', (m) => { if ((['error', 'warning'].includes(m.type()) || /PDFDBG/.test(m.text())) && !/webpack|deprecat|NG0100/i.test(m.text())) console.log('  [page]', m.type(), m.text().slice(0, 3000)); });
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
    try {
      let resolveDl; const dl = new Promise((r) => (resolveDl = r));
      await capturePdfDownloads(page, (buf) => { writeFileSync(out, buf); resolveDl(); });
      await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
      await seedWorkspace(page, [{ id, label: 'FIX-' + id.slice(0, 6), root, edition: '9' }], { clefDisplayMode: mode, pdfFormat: mode === 'every-line' ? 'cm' : 'a4', pdfOrientation: 'portrait' });
      await page.goto(BASE + `/#/document/src1/${id}`, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' }); // APIService caches sources/documents at first read
      await page.waitForSelector('app-root-section', { timeout: 20000 });
      await page.evaluate(async (opts) => {
        const el = document.querySelector('app-document');
        const cmp = window.ng.getComponent(el);
        // A real click runs inside Angular's zone; from here we must flush change
        // detection ourselves so the read-only (print) rendering is in the DOM.
        cmp.printTitlePage = opts.titlePage;
        cmp.printIncludeMetadata = true; cmp.printApparatus = true;
        const done = cmp.confirmPdfExport();
        window.ng.applyChanges(cmp);
        await done;
      }, OPTIONS[mode]);
      await Promise.race([dl, new Promise((_, rej) => setTimeout(() => rej(new Error('no download')), 60000))]);
      const stats = await page.evaluate(() => window.ng.getComponent(document.querySelector('app-document')).lastPdfStats);
      const v = verify(name, mode, out, root, stats);
      v.clefs = stats.clefs; // the clef is a vector path now, so it is counted by the exporter
      (clefCounts[name] ||= {})[mode] = v.clefs;
      if (v.problems.length) { failures++; console.log('FAIL ', name, mode, v.problems.join('; ')); }
      else console.log('ok   ', name, mode, `(clefs: ${v.clefs})`);
      diastematicOf[name] = v.diastematic;
    } catch (e) {
      failures++;
      console.log('FAIL ', name, mode, String(e).split('\n')[0]);
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
for (const [name, c] of Object.entries(clefCounts)) {
  const [ds, el, eb] = MODES.map((m) => c[m]);
  const bad = [];
  if (ds === undefined || el === undefined || eb === undefined) continue;
  if (!(ds <= el && el <= eb)) bad.push(`clef counts not monotonic (${ds}/${el}/${eb})`);
  if (diastematicOf[name] && ds > 1) bad.push(`document-start shows ${ds} clefs`);
  if (!diastematicOf[name] && eb > 0) bad.push('clef on adiastematic document');
  if (bad.length) { failures++; console.log('FAIL ', name, 'clef policy:', bad.join('; ')); }
}
process.exit(failures ? 1 : 0);
