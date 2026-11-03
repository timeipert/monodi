// End-to-end check of the MEI annotations: the settings tabs "Rules" and "Schema", and the right-click dialog
// that sets MEI attributes by hand on a note. Fails on any console error or uncaught exception.
// Run: node scripts/mei-annotations-e2e.mjs [--url http://localhost:4299]
import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedWorkspace } from './lib/e2e-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const BASE = urlIdx >= 0 ? args[urlIdx + 1] : 'http://localhost:4299';
const dir = join(here, '../src/app/testdata');
const root = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('Abb_7') && f.endsWith('.json'))), 'utf8'));
const IGNORE = /Permissions policy violation|favicon|Failed to load resource.*(404|net::ERR)/i;

const problems = [];
const fail = (m) => problems.push(m);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) fail('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => fail('pageerror: ' + String(e).slice(0, 200)));
await page.goto(BASE + '/#/sources', { waitUntil: 'networkidle0' });
await seedWorkspace(page, [{ id: 'doc-1', label: 'Abb 7-12r-1', incipit: 'Gratuletur omnis caro', genre1: 'Antiphon', root }], {});

const clickByText = async (selector, text) => {
  const ok = await page.evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text));
    if (!el) return false; el.click(); return true;
  }, selector, text);
  if (!ok) fail(`no ${selector} starting with "${text}"`);
  await tick(300);
  return ok;
};

/** Context-menu entries react to a real mouse press, not to element.click(). */
const clickMenu = async (text) => {
  const h = await page.evaluateHandle((text) => [...document.querySelectorAll('.custom-context-menu .menu-item')].find((e) => e.textContent.trim().startsWith(text)), text);
  const el = h.asElement();
  if (!el) { fail(`no menu entry starting with "${text}"`); return false; }
  const b = await el.boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2);
  await tick(400);
  return true;
};

try {
  // ---- settings: Rules tab -------------------------------------------------------------------
  await page.goto(BASE + '/#/settings?tab=mei', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('app-mei-mapping-editor', { timeout: 20000 });
  await clickByText('app-mei-mapping-editor button.nav-link', 'Annotations');
  await clickByText('app-mei-mapping-editor .mei-subtabs button', 'Rules');
  await page.waitForSelector('app-mei-rules-panel', { timeout: 5000 });
  await clickByText('app-mei-rules-panel button', 'New rule');
  await page.waitForSelector('app-mei-rules-panel input.form-control-sm', { timeout: 5000 });
  const neume = await page.$('app-mei-rules-panel input[placeholder="any neume"]');
  await neume.type('[*u]');
  await tick(200);
  const rulesText = await page.$eval('app-mei-rules-panel', (e) => e.textContent);
  if (!/Matches\s+\d+\s+place/.test(rulesText)) fail('the rules panel shows no match count');
  const attrInput = await page.$('app-mei-rules-panel app-mei-attr-picker input');
  await attrInput.type('tilt');
  await attrInput.press('Enter');
  await tick(200);
  const valueInput = await page.$('app-mei-rules-panel .input-group input[placeholder^="value"]');
  await valueInput.type('q');
  await tick(300);
  const afterBad = await page.$eval('app-mei-rules-panel', (e) => e.textContent);
  if (!/not one of: n, e, s, w/.test(afterBad)) fail('an invalid @tilt value is not reported by the schema check');
  await valueInput.evaluate((e) => e.select());
  await valueInput.type('n');
  await tick(300);
  const afterGood = await page.$eval('app-mei-rules-panel', (e) => e.textContent);
  if (/not one of: n, e, s, w/.test(afterGood)) fail('a valid @tilt value is still reported');

  // ---- settings: the three areas; the header section carries the publication data --------------
  await clickByText('app-mei-mapping-editor button.nav-link', 'Export format');
  await clickByText('app-mei-mapping-editor .mei-subtabs button', 'Header');
  if (!(await page.$eval('app-mei-mapping-editor', (e) => /Publication data/.test(e.textContent) && /Header level/.test(e.textContent)))) fail('the Header section does not show the header level and the publication data');
  if ((await page.$$('#publicationSettings')).length !== 1) fail('the publication data is not shown exactly once');

  // ---- settings: Schema tab ------------------------------------------------------------------
  await clickByText('app-mei-mapping-editor button.nav-link', 'Schema');
  await page.waitForSelector('app-mei-schema-panel select', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('app-mei-schema-panel select option').length >= 2, { timeout: 15000 })
    .catch(() => fail('the schema list has fewer than two entries (bundled schema not loaded?)'));

  // ---- settings: Note flags tab, connection to the MEI vocabulary ------------------------------
  await clickByText('app-mei-mapping-editor button.nav-link', 'Annotations');
  await clickByText('app-mei-mapping-editor .mei-subtabs button', 'Flags');
  await page.waitForSelector('#flagLabel', { timeout: 5000 });
  await (await page.$('#flagLabel')).type('Virga');
  await clickByText('app-mei-mapping-editor button', 'Add flag');
  await tick(300);
  const flagText = await page.$eval('app-mei-mapping-editor', (e) => e.textContent);
  if (!flagText.includes('<nc type="virga"/>')) fail('a flag named Virga is not connected to <nc type="virga"/>');
  if (await page.$eval('select[id^="flagType"]', (e) => e.value) !== 'virga') fail('the MEI form of the Virga flag is not preselected');
  await clickByText('app-mei-mapping-editor button', '+ punctum');
  if (!(await page.$eval('app-mei-mapping-editor', (e) => e.textContent.includes('<nc type="punctum"/>')))) fail('the standard flag punctum was not added with its MEI form');

  // ---- editor: right-click a note -> MEI attributes ------------------------------------------
  await page.goto(BASE + '/#/document/src1/doc-1', { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('app-notes', { timeout: 30000 });
  await tick(1000);
  const target = await page.evaluateHandle(() => document.querySelector('app-notes g[style*="opacity"]'));
  const box = await target.asElement()?.boundingBox();
  if (!box) fail('no note found to right-click');
  else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForSelector('.custom-context-menu', { timeout: 5000 });
    await clickMenu('MEI attributes');
    await clickMenu('On this note');
    await page.waitForSelector('app-mei-annotation-dialog', { timeout: 5000 });
    await page.waitForFunction(() => /Schema: MEI 5\.0/.test(document.querySelector('app-mei-annotation-dialog')?.textContent ?? ''), { timeout: 15000 })
      .catch(() => fail('the dialog did not list schema attributes'));
    const name = await page.$('app-mei-annotation-dialog app-mei-attr-picker input');
    await name.type('pen stroke');                       // a word of the description finds the attribute
    await tick(200);
    if (!(await page.$$eval('.mei-picker-item .mei-picker-name', (els) => els.some((e) => e.textContent.includes('@tilt'))))) fail('the picker does not find @tilt by its description');
    await name.evaluate((e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
    await page.evaluate(() => [...document.querySelectorAll('app-mei-attr-picker button')].find((b) => b.textContent.includes('Browse')).click());
    await tick(300);
    const heads = await page.$$eval('.mei-picker-section-head', (els) => els.map((e) => e.textContent.trim()));
    if (heads.length < 4 || !heads.some((h) => /Neume component|ncForm|Form of the neume/.test(h))) fail('browse mode shows no sections by attribute class: ' + heads.join(' | '));
    await page.evaluate(() => [...document.querySelectorAll('.mei-picker-main')].find((b) => b.textContent.includes('@tilt')).click());
    await tick(200);
    if (!(await page.$eval('.mei-picker-detail', (e) => /pen stroke/.test(e.textContent) && /in a northern direction/i.test(e.textContent)).catch(() => false))) fail('the detail view does not list the values with their meaning');
    await page.evaluate(() => [...document.querySelectorAll('app-mei-attr-picker button')].find((b) => b.textContent.includes('Browse')).click());
    await name.type('tilt');
    await name.press('Enter');
    await tick(200);
    const value = await page.$('app-mei-annotation-dialog .input-group input.font-monospace');
    await value.type('s');
    await clickByText('app-mei-annotation-dialog button', 'Apply');
    await tick(500);
    const stored = await page.evaluate(() => {
      const notes = document.querySelectorAll('app-notes');
      for (const el of notes) {
        const syl = window.ng.getComponent(el)?.model;
        for (const n of syl?.notes?.spaced?.flatMap((s) => s.nonSpaced.flatMap((g) => g.grouped)) ?? []) if (n.meiAttrs) return n.meiAttrs;
      }
      return null;
    });
    // ---- sidebar: MEI tab, display choices, list view, marker in the staff ----------------------
    // (no page load here: leaving a document with changes asks for confirmation)
    await page.evaluate(() => [...document.querySelectorAll('.inspector-tabs button')].find((b) => b.textContent.trim() === 'MEI').click());
    await tick(500);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('app-notes')) {
        const n = window.ng.getComponent(el).model.notes.spaced.flatMap((s) => s.nonSpaced.flatMap((g) => g.grouped));
        if (n.length > 1) { n[1].meiAttrs = { tilt: 's' }; return; }
      }
    });
    await tick(400);
    const dots = await page.$$eval('app-notes circle[fill="#a00"]', (e) => e.length);
    if (dots < 1) fail('an annotated note carries no dot in the staff');
    const noteEl = (await page.$$('app-notes g[style*="opacity"]'))[1];
    const nb = await noteEl.boundingBox();
    await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await tick(600);
    const tabText = () => page.$eval('.mei-tab', (e) => e.textContent);
    if (!/pname/.test(await tabText())) fail('the MEI tab lists no generated attribute (pname)');
    await page.evaluate(() => document.querySelector('.mei-switch[title^="Show the attributes"]').click());
    await tick(300);
    const hidden = await tabText();
    if (/pname/.test(hidden) || !/tilt/.test(hidden)) fail('switching the generated rows off must hide pname and keep tilt');
    await page.evaluate(() => document.querySelector('.mei-switch[title^="Mark annotated"]').click());
    await tick(300);
    if ((await page.$$eval('app-notes circle[fill="#a00"]', (e) => e.length)) !== 0) fail('the staff dots stay although they are switched off');
    await page.evaluate(() => [...document.querySelectorAll('.mei-toolbar button')].find((b) => b.textContent.includes('All annotated')).click());
    await tick(800);
    if ((await page.$$eval('.mei-pgroup', (e) => e.length)) < 1) fail('the list of annotated places shows no group');
    if ((await page.$$eval('.mei-place', (e) => e.length)) < 1) fail('the list of annotated places is empty');
    await page.select('.mei-groupby select', 'element');
    await tick(300);
    if (!(await page.$eval('.mei-groups', (e) => /Notes \(nc\)/.test(e.textContent)))) fail('grouping by element does not show the group "Notes (nc)"');
    await page.evaluate(() => { localStorage.removeItem('monodi_mei_view'); });

    if (!stored || stored.tilt !== 's') fail('the note did not receive meiAttrs {tilt: "s"}: ' + JSON.stringify(stored));
  }
} catch (e) {
  fail('script: ' + String(e).split('\n')[0]);
}

await browser.close();
if (problems.length) { console.error('FAILED\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('mei-annotations-e2e: ok');
