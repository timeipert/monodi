// Checks that every document of a Monodi ZIP can be printed: each document is drawn alone by Monodi-Zero's own PDF
// export (the same call as the print dialog, in Node, no browser), nothing is saved, and the documents that fail or warn
// are listed by document ID with the reason.
//
//   node scripts/check-pdf-all.mjs (--zip <monodi.zip> | --dir <folder>) --out <check.jsonl>
//        [--source <siglum>] [--limit <n>] [--resume] [--slow <ms>]
//
// What it is for: issue timeipert/monodi#7. A workspace holds thousands of documents (22,252 in the internal export of
// 2026-11-03); one document that breaks the export stops a whole print, and the print dialog does not say which.
// Input:  a ZIP or folder in the Monodi+ layout (see scripts/export-pdf-batch.mjs). Only the small meta.json files are read
//         up front; each data.json is read when its document is drawn, so the memory use does not grow with the workspace.
// Output: <check.jsonl>, one line per document, written as it goes: {id, uuid, source, status, pages, systems, ms, messages}.
//         status: "ok"; "warning" (the export logged a warning, or a chant with notes got no staff line, or it took longer
//         than --slow, 10 000 ms by default); "error" (the export threw); "stopped" (the run ended while this document was
//         being drawn: it hung or crashed the process). Next to it <check>.problems.csv lists every document that is not "ok".
// Stop:   Ctrl-C finishes the current document and writes the summary. --resume skips the documents already in <check.jsonl>
//         (a document left as "started" by a crash is recorded as "stopped" and skipped).
import { build } from 'esbuild';
import JSZip from 'jszip';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const zipPath = opt('zip');
const dirPath = opt('dir');
const outPath = opt('out');
const onlySource = opt('source');
const limit = Number(opt('limit', '0')) || Infinity;
const slowMs = Number(opt('slow', '10000'));
const resume = args.includes('--resume');
if ((!zipPath && !dirPath) || !outPath || !outPath.endsWith('.jsonl')) {
  console.error('usage: node scripts/check-pdf-all.mjs (--zip <monodi.zip> | --dir <folder>) --out <check.jsonl> [--source <siglum>] [--limit <n>] [--resume] [--slow <ms>]');
  process.exit(2);
}
const say = (m) => process.stdout.write(m + '\n');

// what the export logs while it draws one document: warnings and errors are kept, the rest is dropped
let logged = [];
console.debug = () => {};
console.log = () => {};
console.info = () => {};
console.warn = (...a) => { logged.push('warning: ' + a.map(String).join(' ').slice(0, 300)); };
console.error = (...a) => { logged.push('error: ' + a.map(String).join(' ').slice(0, 300)); };

let stopRequested = false;
process.on('SIGINT', () => {
  if (stopRequested) process.exit(130);
  stopRequested = true;
  say('\nstopping after the current document (Ctrl-C again to quit at once)');
});

/** True when the document has at least one note: a chant without notes may rightly have no staff line. */
function hasNotes(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasNotes);
  if (node.kind === 'Syllable') return (node.notes?.spaced || []).some((s) => (s.nonSpaced || []).some((g) => (g.grouped || []).length > 0));
  return Object.values(node).some((v) => typeof v === 'object' && hasNotes(v));
}

const tmp = mkdtempSync(join(tmpdir(), 'pdf-check-'));
try {
  const bundlePath = join(tmp, 'pdf-batch.mjs');
  await build({
    entryPoints: [join(here, 'lib/pdf-batch-entry.ts')], bundle: true, outfile: bundlePath, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    external: ['canvg', 'html2canvas', 'dompurify'],
  });
  const { renderVolume, useAssetsFrom } = await import(pathToFileURL(bundlePath).href);
  useAssetsFrom(join(root, 'src'));

  // the files: read lazily
  const files = new Map();
  if (zipPath) {
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    for (const name of Object.keys(zip.files)) if (!zip.files[name].dir && !name.includes('__MACOSX')) files.set(name, () => zip.file(name).async('string'));
  } else {
    const walk = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name), rel + e.name + '/');
        else files.set(rel + e.name, async () => readFileSync(join(d, e.name), 'utf8'));
      }
    };
    walk(resolve(dirPath), '');
  }
  const sources = new Map();
  const chants = [];
  for (const name of [...files.keys()].filter((n) => n.endsWith('meta.json'))) {
    const folder = name.slice(0, -'meta.json'.length);
    const meta = JSON.parse(await files.get(name)());
    if (files.has(folder + 'data.json')) chants.push({ meta, dataPath: folder + 'data.json' });
    else sources.set(meta.id, meta);
  }
  const sigleOf = (m) => sources.get(m.quelle_id)?.quellensigle ?? '';
  let todo = chants
    .filter((c) => !onlySource || sigleOf(c.meta) === onlySource)
    .sort((a, b) => sigleOf(a.meta).localeCompare(sigleOf(b.meta)) || String(a.meta.dokumenten_id ?? '').localeCompare(String(b.meta.dokumenten_id ?? ''), undefined, { numeric: true }));

  // --resume: skip what is done; a document left as "started" (the process died while drawing it) becomes "stopped"
  const done = new Set();
  if (resume && existsSync(outPath)) {
    const lines = readFileSync(outPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const finished = new Set(lines.filter((l) => l.status !== 'started').map((l) => l.uuid));
    for (const l of lines) {
      if (l.status === 'started' && !finished.has(l.uuid)) {
        appendFileSync(outPath, JSON.stringify({ ...l, status: 'stopped', messages: ['the run ended while this document was drawn (hang or crash)'] }) + '\n');
        finished.add(l.uuid);
      }
    }
    for (const u of finished) done.add(u);
  } else writeFileSync(outPath, '');
  todo = todo.filter((c) => !done.has(c.meta.id)).slice(0, limit);
  say(`${todo.length} documents to check${done.size ? ` (${done.size} done before)` : ''}`);

  const started = Date.now();
  const count = { ok: 0, warning: 0, error: 0 };
  let n = 0;
  for (const { meta, dataPath } of todo) {
    if (stopRequested) break;
    const base = { id: meta.dokumenten_id ?? '', uuid: meta.id, source: sigleOf(meta) };
    appendFileSync(outPath, JSON.stringify({ ...base, status: 'started' }) + '\n');
    logged = [];
    const t0 = Date.now();
    let rec;
    try {
      const rootNode = JSON.parse(await files.get(dataPath)());
      const result = await renderVolume([{ root: rootNode, document: meta, source: sources.get(meta.quelle_id) ?? {} }], {});
      const ms = Date.now() - t0;
      if (result.error) rec = { ...base, status: 'error', ms, messages: [result.error.split('\n').slice(0, 3).join(' | '), ...logged] };
      else {
        const messages = [...logged, ...(result.notationProblems ?? [])];
        if (!result.systems && hasNotes(rootNode)) messages.push('the chant has notes, but no staff line was drawn');
        if (ms > slowMs) messages.push(`slow: ${ms} ms`);
        rec = { ...base, status: messages.length ? 'warning' : 'ok', pages: result.pages, systems: result.systems, ms, messages };
      }
    } catch (e) {
      rec = { ...base, status: 'error', ms: Date.now() - t0, messages: [String(e?.message ?? e).slice(0, 300), ...logged] };
    }
    appendFileSync(outPath, JSON.stringify(rec) + '\n');
    count[rec.status]++;
    if (++n % 250 === 0) say(`${n} / ${todo.length}  ok ${count.ok}  warning ${count.warning}  error ${count.error}  (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  // summary over the whole file (this run and earlier ones)
  const last = new Map();
  for (const l of readFileSync(outPath, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x))) if (l.status !== 'started') last.set(l.uuid, l);
  const all = [...last.values()];
  const problems = all.filter((l) => l.status !== 'ok');
  const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  writeFileSync(outPath.replace(/\.jsonl$/, '.problems.csv'),
    ['status,source,id,uuid,ms,message', ...problems.map((l) => [l.status, l.source, l.id, l.uuid, l.ms, (l.messages ?? []).join(' / ')].map(csvCell).join(','))].join('\n') + '\n');
  const by = (s) => all.filter((l) => l.status === s).length;
  say(`checked ${all.length} documents: ok ${by('ok')}, warning ${by('warning')}, error ${by('error')}, stopped ${by('stopped')}` +
      `${stopRequested ? ' (stopped early; run again with --resume)' : ''} -> ${outPath}`);
  if (by('error') || by('stopped')) process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
