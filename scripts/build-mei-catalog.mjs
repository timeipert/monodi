#!/usr/bin/env node
/**
 * Builds a schema catalog (JSON) from a RelaxNG file, with the same parser the app uses to load a
 * schema at runtime (src/app/mei/schema/rng-to-catalog.ts).
 *
 *   node scripts/build-mei-catalog.mjs <schema.rng> <out.json> --id mei-5.0-all --label "MEI 5.0 (all)" --version 5.0
 *
 * The bundled catalog is rebuilt with `npm run build:mei-catalog` after the bundled schema
 * (src/app/mei/mei-all.rng) is replaced. The output is committed in src/assets/mei/.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!input || !output) {
  console.error('usage: build-mei-catalog.mjs <schema.rng> <out.json> [--id ID] [--label TEXT] [--version V]');
  process.exit(2);
}

// The parser is TypeScript; compile the two modules it needs to a temporary folder and import them.
const tmp = mkdtempSync(join(tmpdir(), 'mei-catalog-'));
for (const f of ['mei-schema-catalog', 'rng-to-catalog']) {
  const src = readFileSync(resolve('src/app/mei/schema', `${f}.ts`), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace(/from '\.\/mei-schema-catalog'/g, "from './mei-schema-catalog.mjs'");
  writeFileSync(join(tmp, `${f}.mjs`), out);
}
const { rngToCatalog } = await import(pathToFileURL(join(tmp, 'rng-to-catalog.mjs')).href);

const doc = new DOMParser({ errorHandler: { warning() {}, error: (m) => { throw new Error(m); }, fatalError: (m) => { throw new Error(m); } } })
  .parseFromString(readFileSync(input, 'utf8'), 'application/xml');
const catalog = rngToCatalog(doc, {
  id: flag('id', 'mei-5.0-all'),
  label: flag('label', 'MEI 5.0 (all)'),
  schemaVersion: flag('version', '5.0'),
  origin: 'bundled',
  source: input.split('/').pop()
});
writeFileSync(output, JSON.stringify(catalog));
console.log(`${output}: ${Object.keys(catalog.elements).length} elements, ${Object.keys(catalog.attrDefs).length} attribute definitions`);
