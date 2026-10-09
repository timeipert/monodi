// Extracts a small, deterministic set of real transcription documents from the
// sibling corpus ZIPs into src/app/testdata/ (used by the layout/PDF tests).
// Usage: node scripts/extract-fixtures.mjs [path/to/examples]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const examples = process.argv[2] || join(here, '../../cm-neumen-editor/examples');
const out = join(here, '../src/app/testdata');
mkdirSync(out, { recursive: true });

const zips = ['german-origin.zip', 'french-origin.zip', 'italian-origin.zip', 'english-origin.zip', 'bohemia-moravia.zip'];
const MIN = 2500, MAX = 70000, PER_ZIP = 4;
const unzip = (args) => execFileSync('unzip', args, { maxBuffer: 1 << 28 });

function hasRealNotes(json) {
  let doc; try { doc = JSON.parse(json); } catch { return false; }
  let normal = 0, total = 0;
  (function walk(c) {
    if (!c || typeof c !== 'object') return;
    if (c.kind === 'Syllable') { total++; if (c.syllableType === 'Normal') normal++; }
    (c.children || []).forEach(walk);
  })(doc);
  return normal >= 25 && normal / Math.max(1, total) >= 0.6;
}

const picked = [];
for (const z of zips) {
  const listing = unzip(['-l', join(examples, z)]).toString().split('\n');
  const docs = listing
    .map((l) => l.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+\/data\.json)$/))
    .filter(Boolean)
    .map((m) => ({ size: +m[1], path: m[2] }))
    .filter((d) => d.size >= MIN && d.size <= MAX)
    .sort((a, b) => a.path.localeCompare(b.path));
  // Prefer Halberstadt in the German set (the printed reference page 101 is Halb 45).
  // Many documents are placeholders (syllables without notes) - keep only real transcriptions.
  const real = docs.filter((d) => hasRealNotes(unzip(['-p', join(examples, z), d.path]).toString()));
  const pref = z.startsWith('german') ? real.filter((d) => /^Halb/.test(d.path)) : [];
  const rest = real.filter((d) => !pref.includes(d));
  const step = Math.max(1, Math.floor(rest.length / PER_ZIP));
  const chosen = [...pref.slice(0, 2), ...rest.filter((_, i) => i % step === 0).slice(0, PER_ZIP)];
  for (const d of chosen) picked.push({ zip: z, ...d });
}

const manifest = [];
for (const p of picked) {
  const json = unzip(['-p', join(examples, p.zip), p.path]).toString();
  JSON.parse(json); // validate
  const name = p.path.split('/').slice(0, 2).join('__').replace(/[^\w.-]+/g, '_') + '.json';
  writeFileSync(join(out, name), json);
  manifest.push({ file: name, source: p.zip, path: p.path, bytes: p.size });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote ${manifest.length} fixtures to ${out}`);
