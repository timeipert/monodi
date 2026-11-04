// Smoke test of scripts/export-svg-batch.mjs: writes a small Monodi folder (one source, two chants: one with notation, one
// without), runs the exporter over it into a folder and into a ZIP, and checks the pictures. No browser, no network.
//   node scripts/svg-batch-smoke.mjs          (also: npm run test:svg-batch)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'export-svg-batch.mjs');
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const note = (base, octave, extra = {}) => ({ uuid: uuid(), noteType: 'Normal', base, octave, liquescent: false, focus: false, ...extra });
const syllable = (text, groups) => ({ kind: 'Syllable', uuid: uuid(), text, syllableType: 'Normal', notes: { spaced: groups.map((g) => ({ nonSpaced: [{ grouped: g }] })) } });
const lineChange = () => ({ kind: 'LineChange', uuid: uuid(), focus: false });
const root = (children) => ({ kind: 'RootContainer', uuid: uuid(), comments: [], documentType: 'Level2', children });
const formteil = (children) => ({ kind: 'FormteilContainer', uuid: uuid(), data: [], children });
const paratext = (text) => ({ kind: 'ParatextContainer', uuid: uuid(), text, retro: false, paratextType: 'Gesang' });
const zeile = (children) => ({ kind: 'ZeileContainer', uuid: uuid(), children });

const withNotes = root([formteil([
  paratext('ALLELUIA'),
  zeile([
    syllable('Al-', [[note('G', 4)]]),
    syllable('le-', [[note('A', 4), note('B', 4), note('C', 5)]]),     // a neume with a bracket
    syllable('lu-', [[note('A', 3)], [note('C', 6, { noteType: 'Ascending' })]]),   // ledger lines below and above, a virga
    lineChange(),                                                                   // a tick in the line, not a new system
    syllable('ia', [[note('D', 5, { liquescent: true })], [note('E', 4, { noteType: 'Quilisma' })]]),
  ]),
  zeile([syllable('Amen', [[note('G', 4)]])]),                                      // a second line of notation: a second system
])]);
const withoutNotes = root([formteil([])]);   // nothing to draw: no picture, listed in report.json

const tmp = mkdtempSync(join(tmpdir(), 'svg-smoke-'));
let failed = 0;
const check = (ok, message) => { if (!ok) { failed++; console.error('FAIL: ' + message); } else console.log('ok:   ' + message); };
try {
  const input = join(tmp, 'in');
  const chants = [['c-1', 'Smoke 1-1-1', withNotes], ['c-2', 'Smoke 1-2-1', withoutNotes]];
  mkdirSync(join(input, 'Smoke 1'), { recursive: true });
  writeFileSync(join(input, 'Smoke 1', 'meta.json'), JSON.stringify({ id: 'Smoke 1', quellensigle: 'Smoke 1' }));
  for (const [id, dokumentenId, data] of chants) {
    mkdirSync(join(input, 'Smoke 1', id), { recursive: true });
    writeFileSync(join(input, 'Smoke 1', id, 'meta.json'), JSON.stringify({ id, quelle_id: 'Smoke 1', dokumenten_id: dokumentenId, textinitium: 'Alleluia', additionalData: {} }));
    writeFileSync(join(input, 'Smoke 1', id, 'data.json'), JSON.stringify(data));
  }

  // to a folder
  const out = join(tmp, 'out');
  execFileSync('node', [script, '--dir', input, '--out', out, '--quiet'], { stdio: 'pipe' });
  const file = join(out, 'Smoke 1', 'c-1', 'c-1.svg');
  check(existsSync(file), 'a picture <source>/<chant>/<chant>.svg for the chant with notation');
  check(!existsSync(join(out, 'Smoke 1', 'c-2', 'c-2.svg')), 'no picture for an empty chant');
  const svg = readFileSync(file, 'utf8');
  check(svg.startsWith('<svg ') && svg.endsWith('</svg>'), 'one <svg> document');
  check(/viewBox="0 0 [1-9]\d* [1-9]\d*"/.test(svg), 'a viewBox that fits the drawing');
  check(svg.includes('fill="currentColor"') && svg.includes('stroke="currentColor"'), 'colours come from CSS (currentColor)');
  check(/<path d="M[\d.]+ [\d.]+V[\d.]+"/.test(svg), 'the line change is a tick below the staff');
  check(!/<style|class=|NaN|undefined/.test(svg), 'no style block, no class, no NaN');
  check((svg.match(/<use href="#s/g) ?? []).length === 2, 'one staff per line of notation');
  check((svg.match(/<use href="#g/g) ?? []).length >= 4, 'every note head is a <use> of a shared outline');
  check(/<path id="g\w+" fill-rule="evenodd"/.test(svg), 'outlines are defined once in <defs>');
  check(['ALLELUIA', 'Al–', 'le–', 'lu–', 'ia', 'Amen'].every((t) => svg.includes('>' + t + '</text>')), 'rubric and lyrics are plain <text>');
  check(Buffer.byteLength(svg) < 6000, `compact (${Buffer.byteLength(svg)} bytes)`);
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  check(report.written === 1 && report.errors === 1 && report.files[0].file === 'Smoke 1/c-1/c-1.svg' && report.files[0].systems === 2, 'report.json lists the picture and the chant without a line of notation');

  // to a ZIP, from a ZIP
  const zin = new JSZip();
  for (const rel of ['Smoke 1/meta.json', 'Smoke 1/c-1/meta.json', 'Smoke 1/c-1/data.json', 'Smoke 1/c-2/meta.json', 'Smoke 1/c-2/data.json']) zin.file(rel, readFileSync(join(input, rel)));
  const zipIn = join(tmp, 'in.zip');
  writeFileSync(zipIn, await zin.generateAsync({ type: 'nodebuffer' }));
  const zipOut = join(tmp, 'out.zip');
  execFileSync('node', [script, '--zip', zipIn, '--out', zipOut, '--quiet'], { stdio: 'pipe' });
  const z = await JSZip.loadAsync(readFileSync(zipOut));
  check(Object.keys(z.files).filter((f) => !f.endsWith('/')).sort().join('|') === 'Smoke 1/c-1/c-1.svg|report.json', 'ZIP out holds the pictures and report.json');
  check((await z.file('Smoke 1/c-1/c-1.svg').async('string')) === svg, 'ZIP in, ZIP out: the same picture as folder in, folder out');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('svg-batch smoke test passed');
