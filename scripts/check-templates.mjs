// Fails when a template uses something its component does not have: a method that was never written or was
// renamed, a property that does not exist. Such a template compiles and ships (the app builds with
// `strictTemplates: false`) and only breaks when somebody clicks: an event handler that is `undefined`, a list
// whose track function is missing and takes the whole view down with it.
//
// It runs the Angular compiler once with strict template checking and keeps only that one class of error.
// Everything else strict mode reports (nullable access, union narrowing) is noise today and is ignored.
// src/app/section/section.component.html is skipped: one template shared by five components with different
// members, which no single component type can satisfy.
//
// Run: node scripts/check-templates.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'monodi-templates-'));
const tsconfig = join(dir, 'tsconfig.json');
writeFileSync(tsconfig, JSON.stringify({
  extends: join(root, 'src/tsconfig.app.json'),
  compilerOptions: { noEmit: true, rootDir: root, baseUrl: root + '/', typeRoots: [join(root, 'node_modules/@types')] },
  files: [join(root, 'src/main.ts'), join(root, 'src/polyfills.ts')],
  include: [join(root, 'src/**/*.d.ts')],
  exclude: [join(root, 'src/**/*.spec.ts'), join(root, 'src/test.ts')],
  angularCompilerOptions: { strictTemplates: true },
}));

const run = spawnSync('npx', ['ngc', '-p', tsconfig], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (run.stdout || '') + (run.stderr || '');
const text = out.replace(/\x1b\[[0-9;]*m/g, '');

// "<file>.html:<line>:<col> - error TS2339: Property 'x' does not exist on type 'FooComponent'."
const wanted = /^(.*\.html):(\d+):(\d+) - error TS(2339|2551): Property '([^']+)' does not exist on type '(\w+Component)'/;
const found = [];
for (const line of text.split('\n')) {
  const m = wanted.exec(line);
  if (!m) continue;
  const file = m[1].slice(m[1].indexOf('src/app/'));
  if (file.endsWith('section/section.component.html')) continue;
  found.push(`${file}:${m[2]}:${m[3]}  '${m[5]}' does not exist on ${m[6]}`);
}

if (found.length) {
  console.error('Templates use members their component does not have:\n  ' + [...new Set(found)].join('\n  '));
  process.exit(1);
}
if (run.status !== 0 && !/error TS/.test(text)) {
  console.error('The Angular compiler did not run:\n' + text.slice(0, 2000));
  process.exit(2);
}
console.log('ok: every member the templates use exists on its component');
