// Multi-document print: opens a manuscript (source view), clicks "Print manuscript (PDF)",
// confirms the dialog and checks the real PDF: title page with contents table (ID, incipit,
// genre, page), documents on their own pages, running head numbering, collected apparatus
// divided by document. Run: node scripts/multi-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { seedWorkspace, capturePdfDownloads } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:4299';
const outDir = join(here, '../scratch/compare');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'multi-manuscript.pdf');
const PDFTOTEXT = '/opt/homebrew/bin/pdftotext';
const dir = join(here, '../src/app/testdata');
const load = (prefix, sub = '') => JSON.parse(readFileSync(join(dir, sub, readdirSync(join(dir, sub)).find((f) => f.startsWith(prefix) && f.endsWith('.json'))), 'utf8'));

const docs = [
  { id: 'doc-1', label: 'Abb 7-12r-1', incipit: 'Gratuletur omnis caro', genre1: 'Antiphon', genre2: 'Introitus', root: load('Abb_7') },
  { id: 'doc-2', label: 'Abb 7-12v-1', incipit: 'Terribilis est locus iste', genre1: 'Responsorium', genre2: '', root: load('x12', 'extreme') },
  { id: 'doc-3', label: 'Abb 7-13r-1', incipit: 'Kyrie eleison', genre1: 'Ordinarium', genre2: 'Kyrie', root: load('x01', 'extreme') },
];

function words(file) {
  const xml = execFileSync(PDFTOTEXT, ['-bbox', file, '-']).toString();
  const pageW = +(/<page width="([\d.]+)"/.exec(xml)?.[1] ?? 595);
  const list = [];
  xml.split('<page ').slice(1).forEach((pg, page) => {
    for (const m of pg.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      list.push({ page, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] });
    }
  });
  return { pageW, list, pages: Math.max(...list.map((w) => w.page)) + 1 };
}
// same line: the centres of the boxes agree (bold and regular text have different box heights)
const lineOf = (list, w) => list.filter((x) => x.page === w.page && Math.abs((x.y0 + x.y1) / 2 - (w.y0 + w.y1) / 2) < 4).sort((a, b) => a.x0 - b.x0);

const watchdog = setTimeout(() => { console.log('FAIL  multi-document print: timed out'); process.exit(2); }, 240000);
const step = (m) => console.log('  ..', m);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const problems = [];
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !/NG0100|NG0103/.test(m.text())) problems.push('console ' + m.text().slice(0, 200)); });
let resolveDl; const dl = new Promise((r) => (resolveDl = r));
await capturePdfDownloads(page, (buf) => { writeFileSync(out, buf); resolveDl(); });
try {
  step('seed'); await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
  await seedWorkspace(page, docs, {});
  step('open manuscript'); await page.goto(BASE + '/#/source/src1?tab=documents', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  step('find button'); const btn = await page.waitForSelector('button ::-p-text(Print manuscript)', { timeout: 30000 });
  step('click'); await btn.click();
  await page.waitForSelector('app-pdf-export-dialog', { timeout: 10000 });
  const hasRows = await page.evaluate(() => document.querySelectorAll('app-pdf-export-dialog ol li').length);
  if (hasRows !== 3) problems.push(`dialog lists ${hasRows} documents, expected 3`);
  const create = await page.waitForSelector('app-pdf-export-dialog button ::-p-text(Create PDF)');
  step('create'); await create.click();
  await Promise.race([dl, new Promise((_, rej) => setTimeout(() => rej(new Error('no download')), 120000))]);

  const { pageW, list, pages } = words(out);
  const text = execFileSync(PDFTOTEXT, [out, '-']).toString();
  // --- title page + contents
  if (!list.some((w) => w.page === 0 && w.t === 'CONTENTS')) problems.push('no CONTENTS heading on the title page');
  const rows = docs.map((d) => {
    const idWord = list.find((w) => w.page === 0 && w.t === d.label.split(' ')[0] && lineOf(list, w).some((x) => x.t === d.label.split(' ')[1]));
    if (!idWord) { problems.push(`contents has no row for ${d.label}`); return null; }
    const ln = lineOf(list, idWord).map((x) => x.t).join(' ');
    for (const need of [d.label, d.incipit.split(' ')[0], d.genre1]) if (!ln.includes(need)) problems.push(`contents row of ${d.label} lacks "${need}": ${ln}`);
    const pageNo = Number(lineOf(list, idWord).at(-1).t);
    return { d, pageNo };
  });
  // --- each document starts where the contents say, on its own page
  const headNo = (pg) => list.find((w) => w.page === pg && /^\d+$/.test(w.t) && w.y1 < 70 && w.x1 > pageW - 56.7 - 3);
  let titlePages = 0; while (titlePages < pages && !headNo(titlePages)) titlePages++;
  if (titlePages < 1) problems.push('no title page');
  for (let pg = titlePages; pg < pages; pg++) if (!headNo(pg) || headNo(pg).t !== String(pg - titlePages + 1)) problems.push(`page ${pg + 1}: head number ${headNo(pg)?.t}`);
  // documents run on in one flow: each begins with a heading line (ID in bold, incipit, genre)
  // on exactly the page the contents name — and not every one on a page of its own
  const startPages = [];
  for (const r of rows.filter(Boolean)) {
    const [idA, idB] = r.d.label.split(' ');
    const first = r.d.incipit.split(' ')[0];
    const heading = list.find((w) => w.page >= titlePages && w.t === idA && lineOf(list, w).some((x) => x.t === idB) && lineOf(list, w).some((x) => x.t === first));
    if (!heading) { problems.push(`heading line of ${r.d.label} not found`); continue; }
    const logical = heading.page - titlePages + 1;
    startPages.push(logical);
    if (logical !== r.pageNo) problems.push(`${r.d.label}: contents says page ${r.pageNo}, heading is on ${logical}`);
  }
  if (new Set(startPages).size === startPages.length && startPages.length === docs.length) problems.push('every document starts on a page of its own; they should run on in one flow');
  // --- collected apparatus, divided by document (only docs that have comments)
  if (!list.some((w) => w.t === 'APPARATUS')) problems.push('no CRITICAL APPARATUS heading');
  const apparatusRow = list.find((w) => w.page === 0 && w.t === 'Apparatus' && lineOf(list, w).some((x) => x.t === 'Critical'));
  if (!apparatusRow) problems.push('contents does not list the apparatus');
  const appPage = list.find((w) => w.t === 'APPARATUS')?.page ?? 0;
  const afterApp = list.filter((w) => w.page >= appPage);
  const subIds = docs.filter((d) => afterApp.some((w) => w.t === d.label.split(' ')[0] && lineOf(list, w).some((x) => x.t === d.label.split(' ')[1])));
  const wantIds = [docs[0], docs[1]]; // doc-3 has no comments
  if (subIds.map((d) => d.id).join() !== wantIds.map((d) => d.id).join()) problems.push(`apparatus sub-headings for ${subIds.map((d) => d.label).join(', ')}; expected ${wantIds.map((d) => d.label).join(', ')}`);
  for (const w of ['Gratuletur]', 'Terribi]']) if (!text.includes(w)) problems.push(`apparatus lacks the lemma "${w}"`);
  console.log(problems.length ? 'FAIL ' : 'ok   ', `multi-document print (${pages} pages, ${titlePages} title page(s))`, problems.join('; '));
} catch (e) {
  await page.screenshot({ path: join(outDir, 'multi-failure.png') }).catch(() => {});
  problems.push(String(e).split('\n')[0]);
  console.log('FAIL  multi-document print', problems.join('; '));
}
clearTimeout(watchdog);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(problems.length ? 1 : 0);
