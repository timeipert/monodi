/**
 * Benchmark of the analysis methods on a synthetic corpus. Not a test: it prints timings.
 *
 *   cd packages/core && node --import ./src/resolve-ts.mjs src/analysis/bench.ts [chants] [method ...]
 *
 * The default is 22,000 chants (the size of the internal workspace export of 2026-11-03). The chants are random walks
 * with a few shared melodic formulas, so the counting methods see realistic repetition. The timings decide whether a
 * kernel (edit distance, n-gram counting) is worth moving to WebAssembly: if no method is slow on this corpus, it is not.
 */
import { METHODS, runMethod } from './registry.ts';
import { chant, corpusOf } from './test-helpers.ts';

const total = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 22000;
const only = process.argv.slice(3);

let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
const FORMULAS = [[0, 2, 1, 0], [0, 1, 2, 4, 2], [0, -1, 0, 2], [0, 2, 4, 2, 1, 0], [0, 1, 0]];
const GENRES = ['Antiphon', 'Responsory', 'Hymn', 'Sequence', 'Mass'];
const WORDS = ['do', 'mi', 'nus', 'et', 'in', 'ex', 'cel', 'sis', 'glo', 'ri', 'a', 'de', 'o', 'pax', 'ho', 'mi', 'ni', 'bus'];

function randomChant(i: number) {
  const syllables: { text: string; pitches: number[] }[] = [];
  let cur = 28 + Math.floor(rnd() * 8);
  const count = 40 + Math.floor(rnd() * 80);
  for (let s = 0; s < count; s++) {
    const pitches: number[] = [];
    if (rnd() < 0.2) {
      for (const d of FORMULAS[Math.floor(rnd() * FORMULAS.length)]) pitches.push(cur + d);
      cur = pitches[pitches.length - 1];
    } else {
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) { cur = Math.max(21, Math.min(45, cur + Math.floor(rnd() * 5) - 2)); pitches.push(cur); }
    }
    const w = WORDS[Math.floor(rnd() * WORDS.length)];
    syllables.push({ text: rnd() < 0.5 ? `${w}-` : w, pitches });
  }
  void i;
  return chant(syllables);
}

console.log(`Generating ${total} chants ...`);
const chants = Array.from({ length: total }, (_, i) => randomChant(i));
const notes = chants.reduce((s, c) => s + c.pitches.length, 0);
const corpus = corpusOf(chants, (i) => ({
  'doc:gattung1': GENRES[i % GENRES.length],
  'src:quellensigle': `S${i % 60}`,
  'doc:textinitium': `T${i % Math.max(1, Math.floor(total / 4))}`,
}));
console.log(`${total} chants, ${notes} notes\n`);

console.log('method'.padEnd(18), 'seconds'.padStart(8), 'result bytes'.padStart(14));
for (const m of METHODS) {
  if (only.length && !only.includes(m.id)) continue;
  const t0 = performance.now();
  let bytes = -1;
  let note = '';
  try {
    const { result } = runMethod(m.id, corpus, undefined, { progress: () => undefined });
    bytes = JSON.stringify(result).length;
    note = result.summary;
  } catch (e) {
    note = `FAILED: ${(e as Error).message}`;
  }
  const secs = (performance.now() - t0) / 1000;
  console.log(m.id.padEnd(18), secs.toFixed(2).padStart(8), String(bytes).padStart(14), ' ', note.slice(0, 90));
}
