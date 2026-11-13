// Smoke test of scripts/export-pdf-batch.mjs: writes a small Monodi folder (one source, a trope and the antiphon it names
// as its related document), runs the exporter with a job file and without, and checks the PDF and its report.
// No browser, no network.
//   node scripts/pdf-batch-smoke.mjs          (also: npm run test:pdf-batch)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'export-pdf-batch.mjs');
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const note = (base, octave) => ({ uuid: uuid(), noteType: 'Normal', base, octave, liquescent: false, focus: false });
const syllable = (text, groups) => ({ kind: 'Syllable', uuid: uuid(), text, syllableType: 'Normal', notes: { spaced: groups.map((g) => ({ nonSpaced: [{ grouped: g }] })) } });
const root = (words) => ({ kind: 'RootContainer', uuid: uuid(), comments: [], documentType: 'Level2', children: [
  { kind: 'FormteilContainer', uuid: uuid(), data: [], children: [{ kind: 'ZeileContainer', uuid: uuid(), children: words.map((w) => syllable(w, [[note('G', 4)], [note('A', 4)]])) }] }] });

const tmp = mkdtempSync(join(tmpdir(), 'pdf-smoke-'));
let failed = 0;
const check = (ok, message) => { if (!ok) { failed++; console.error('FAIL: ' + message); } else console.log('ok:   ' + message); };
const run = (args) => execFileSync('node', [script, ...args, '--quiet'], { stdio: 'pipe' });
const report = (pdf) => JSON.parse(readFileSync(pdf.replace(/\.pdf$/, '.report.json'), 'utf8'));
const docLines = (r) => r.outline.filter((o) => o.depth === 2).map((o) => o.label.split(' | ')[0]);
try {
  const input = join(tmp, 'in');
  // the antiphon comes first in the source; the trope names it in relation_target
  const chants = [
    ['a-1', 'Smoke 1-1-1', 'Antiphon', 'Puer natus', {}, ['Pu-', 'er', 'na-', 'tus']],
    ['t-1', 'Smoke 1-5-1', 'Tropus', 'Hodie cantandus', { relation_target: 'Smoke 1-1-1', Band_Genre: 'Tropus' }, ['Ho-', 'di-', 'e']],
  ];
  mkdirSync(join(input, 'Smoke 1'), { recursive: true });
  writeFileSync(join(input, 'Smoke 1', 'meta.json'), JSON.stringify({ id: 'Smoke 1', quellensigle: 'Smoke 1', herkunftsort: 'Testort' }));
  for (const [id, dok, genre, incipit, extra, words] of chants) {
    mkdirSync(join(input, 'Smoke 1', id), { recursive: true });
    writeFileSync(join(input, 'Smoke 1', id, 'meta.json'), JSON.stringify({ id, quelle_id: 'Smoke 1', dokumenten_id: dok, gattung1: genre, textinitium: incipit, additionalData: extra }));
    writeFileSync(join(input, 'Smoke 1', id, 'data.json'), JSON.stringify(root(words)));
  }

  // defaults: no job file
  const plain = join(tmp, 'plain.pdf');
  run(['--dir', input, '--out', plain]);
  check(existsSync(plain) && readFileSync(plain).subarray(0, 5).toString() === '%PDF-', 'a PDF without a job file');
  const r0 = report(plain);
  check(r0.documents === 2 && r0.pages >= 2, `report: 2 documents on ${r0.pages} pages`);
  check(docLines(r0).join(',') === 'Smoke 1-5-1,Smoke 1-1-1', 'the related antiphon stands behind its trope (relation_target read from additionalData)');

  // a job file: cover, relation type with a heading, order
  const job = join(tmp, 'job.json');
  writeFileSync(job, JSON.stringify({
    title: 'Smoke volume', cover: 'plain', coverGroup: 'Band 1',
    settings: { relationTypes: [{ name: 'Primärgesang', suffix: 'P', heading: 'Primärgesänge' }] },
    options: { countFrontPages: true, arrangeRelated: true },
    order: ['t-1', 'a-1'],
  }));
  const withJob = join(tmp, 'job.pdf');
  run(['--dir', input, '--out', withJob, '--job', job]);
  const r1 = report(withJob);
  check(r1.frontPages >= 2 && r1.pages > r0.pages, `cover and title page in front (${r1.frontPages} front pages)`);
  check(docLines(r1).join(',') === 'Smoke 1-5-1,Smoke 1-1-1', 'with a job file the antiphon still follows its trope (section of the relation type)');

  // without arranging: the order of the job file
  writeFileSync(job, JSON.stringify({ options: { arrangeRelated: false }, order: ['a-1', 't-1'] }));
  const flat = join(tmp, 'flat.pdf');
  run(['--dir', input, '--out', flat, '--job', job]);
  check(docLines(report(flat)).join(',') === 'Smoke 1-1-1,Smoke 1-5-1', 'arrangeRelated false keeps the order of the job file');

  // the settings of a printed volume: front pages, parts of running text, chapter title from a source field, source
  // description and notation documentation as Markdown, parts in the order of the book
  writeFileSync(join(input, 'Smoke 1', 'meta.json'), JSON.stringify({ id: 'Smoke 1', quellensigle: 'Smoke 1', herkunftsort: 'Testort',
    beschreibung: '## Smoke 1\n\nA test source.', notationsdokumentation: 'Neumes of the **test** source.', additionalData: { Kapiteltitel: 'Chapter by origin' } }));
  writeFileSync(job, JSON.stringify({
    title: 'Smoke volume', cover: 'plain', coverPages: ['plain', 'plain'],
    textParts: { front: [{ title: 'Notes on use', markdown: 'How to read the volume.' }, { title: 'Introduction', markdown: '*Placeholder.*' }],
      back: [{ title: 'Literature', markdown: '- A book' }] },
    settings: { pdfChapterTitleField: 'Kapiteltitel', pdfPartOrder: ['descriptions', 'notation', 'apparatus'], pdfNotationMarkdownField: 'notationsdokumentation',
      pdfLanguage: 'de' },
    options: { countFrontPages: true, sourceDescriptions: true, notationDocumentation: true, apparatus: true },
  }));
  const book = join(tmp, 'book.pdf');
  run(['--dir', input, '--out', book, '--job', job]);
  const r2 = report(book);
  const top = r2.outline.filter((o) => o.depth === 0).map((o) => o.label);
  check(r2.frontPages >= 4, `cover and two further front pages before the contents (${r2.frontPages} front pages)`);
  check(top.indexOf('Notes on use') >= 0 && top.indexOf('Notes on use') < top.indexOf('Introduction') && top.indexOf('Introduction') < top.indexOf('Edition'),
    'front parts of running text before the edition: ' + top.join(' / '));
  check(top.indexOf('Die Quelle') > top.indexOf('Edition') && top.indexOf('Die Quelle') < top.indexOf('Die Notationen')
    && top.indexOf('Literature') === top.length - 1, 'parts in the order of pdfPartOrder, back text last (German labels; one source: "Die Quelle")');
  check(r2.outline.some((o) => o.label.includes('Chapter by origin')), 'the chapter is named by the source field of pdfChapterTitleField');

  // from a ZIP: the same documents
  writeFileSync(join(input, 'Smoke 1', 'meta.json'), JSON.stringify({ id: 'Smoke 1', quellensigle: 'Smoke 1', herkunftsort: 'Testort' }));
  const zin = new JSZip();
  for (const rel of ['Smoke 1/meta.json', 'Smoke 1/a-1/meta.json', 'Smoke 1/a-1/data.json', 'Smoke 1/t-1/meta.json', 'Smoke 1/t-1/data.json']) zin.file(rel, readFileSync(join(input, rel)));
  const zipIn = join(tmp, 'in.zip');
  writeFileSync(zipIn, await zin.generateAsync({ type: 'nodebuffer' }));
  const fromZip = join(tmp, 'zip.pdf');
  run(['--zip', zipIn, '--out', fromZip]);
  check(report(fromZip).pages === r0.pages && docLines(report(fromZip)).join(',') === docLines(r0).join(','), 'ZIP in: the same volume as folder in');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('pdf-batch smoke test passed');
