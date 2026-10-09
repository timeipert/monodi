// Synopsis check: three witnesses of one chant (original, altered notes, shortened text),
// every alignment mode, stacked and one-line view. Exports the real synopsis PDF and a
// screenshot per case into scratch/compare/synopsis/. Run: node scripts/synopsis-e2e.mjs [fixture-substring] [--url ...]
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
const filter = args[0] || 'AcT_1';
const outDir = join(here, '../scratch/compare/synopsis');
mkdirSync(outDir, { recursive: true });
const PDFTOTEXT = '/opt/homebrew/bin/pdftotext';

const dir = join(here, '../src/app/testdata');
const fixture = readdirSync(dir).find((f) => f.includes(filter) && f.endsWith('.json') && f !== 'manifest.json');
const base = JSON.parse(readFileSync(join(dir, fixture), 'utf8'));

let seq = 0;
const clone = () => JSON.parse(JSON.stringify(base), (k, v) => (k === 'uuid' && typeof v === 'string' ? `w${++seq}-${v}` : v));
const BASES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
function syllables(c, out = []) { if (c?.kind === 'Syllable') out.push(c); (c?.children || []).forEach((k) => syllables(k, out)); return out; }
function notesOf(s) { return s.notes.spaced.flatMap((n) => n.nonSpaced.flatMap((g) => g.grouped)); }

const A = clone();
const B = clone();   // every 3rd syllable: pitches moved by a step, one neume dropped
syllables(B).forEach((s, i) => { if (i % 3 === 0) notesOf(s).forEach((n) => { n.base = BASES[(BASES.indexOf(n.base) + 1) % 7]; }); });
const C = clone();   // shortened + different spelling
{
  const ss = syllables(C);
  for (const z of (function zs(c, o = []) { if (c?.kind === 'ZeileContainer') o.push(c); (c?.children || []).forEach((k) => zs(k, o)); return o; })(C)) {
    z.children = z.children.filter((p, i) => !(p.kind === 'Syllable' && i % 5 === 4));
  }
  ss.forEach((s, i) => { if (i % 4 === 1) s.text = String(s.text).replace(/a/g, 'ae'); });
}
const docs = [
  { id: 'doc-A', label: 'Wit A', root: A },
  { id: 'doc-B', label: 'Wit B', root: B },
  { id: 'doc-C', label: 'Wit C', root: C },
];

const MODES = ['signature', 'structure', 'sequential', 'melody', 'text'];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failures = 0;
for (const mode of MODES) {
  for (const single of [false, true]) {
    const tag = `${mode}.${single ? 'oneline' : 'stacked'}`;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    const problems = [];
    page.on('pageerror', (e) => problems.push('pageerror ' + String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !/NG0100/.test(m.text())) problems.push('console ' + m.text().slice(0, 200)); });
    let resolveDl; const dl = new Promise((r) => (resolveDl = r));
    let pdfFile = join(outDir, `${tag}.pdf`);
    await capturePdfDownloads(page, (buf) => { writeFileSync(pdfFile, buf); resolveDl(); });
    try {
      await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
      await seedWorkspace(page, docs, {});
      await page.goto(`${BASE}/#/search?compare=doc-A,doc-B,doc-C&synopsis=true&align=${mode}`, { waitUntil: 'networkidle0' });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.synopsis-view', { timeout: 30000 });
      await page.evaluate((single) => {
        const cmp = window.ng.getComponent(document.querySelector('app-search'));
        cmp.showSingleLineSynopsis = single;
        if (single) cmp.onSingleLineToggle?.();
        window.ng.applyChanges(cmp);
      }, single);
      await new Promise((r) => setTimeout(r, 1500));
      await page.waitForSelector('.synopsis-view svg', { timeout: 30000 });
      const shot = await page.$('.synopsis-view');
      await shot.screenshot({ path: join(outDir, `${tag}.png`) });
      await page.evaluate(async () => {
        const cmp = window.ng.getComponent(document.querySelector('app-search'));
        const p = cmp.exportSynopsisPDF();
        window.ng.applyChanges(cmp);
        await p;
      });
      await Promise.race([dl, new Promise((_, rej) => setTimeout(() => rej(new Error('no download')), 90000))]);
      const txt = execFileSync(PDFTOTEXT, [pdfFile, '-']).toString();
      if (!/Synoptic Comparison/.test(txt)) problems.push('no title in PDF');
      const seen = ['Wit A', 'Wit B', 'Wit C'].filter((w) => txt.includes(w)).length;
      if (seen < 3) problems.push(`only ${seen}/3 witnesses listed`);
      const firstSylls = syllables(A).slice(0, 6).map((s) => String(s.text).replace(/[-–]+$/g, '')).filter((t) => t && !t.includes(' '));
      const missing = firstSylls.filter((t) => !txt.includes(t));
      if (missing.length > 1) problems.push('syllables missing: ' + missing.join(','));
      const clefG = (txt.match(/(^|\s)G(\s|$)/gm) || []).length;
      console.log(problems.length ? 'FAIL ' : 'ok   ', tag, `(G glyphs in text: ${clefG})`, problems.join('; '));
      if (problems.length) failures++;
    } catch (e) {
      failures++;
      console.log('FAIL ', tag, String(e).split('\n')[0], problems.join('; '));
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
