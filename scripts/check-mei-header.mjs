// Validates the golden Standard-level MEI header (src/app/mei/mei-header.golden.ts) against the bundled MEI 5.0 schema.
// Needs `xmllint` (libxml2). Usage: npm run check:mei-header
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const golden = readFileSync('src/app/mei/mei-header.golden.ts', 'utf8');
const match = /HEADER_LEVEL2_GOLDEN = `([\s\S]*?)`;/.exec(golden);
if (!match) {
  console.error('HEADER_LEVEL2_GOLDEN not found in mei-header.golden.ts');
  process.exit(2);
}
const document = '<?xml version="1.0" encoding="UTF-8"?>\n<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">\n' + match[1] +
  '\n<music><body><mdiv type="main"><score><scoreDef/><section/></score></mdiv></body></music></mei>\n';
const dir = mkdtempSync(join(tmpdir(), 'mei-header-'));
const file = join(dir, 'header-level2.xml');
writeFileSync(file, document);
try {
  const out = execFileSync('xmllint', ['--noout', '--relaxng', 'src/app/mei/mei-all.rng', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('MEI header (level 2) validates against the bundled MEI 5.0 schema.', out.trim());
} catch (e) {
  console.error('MEI header (level 2) does NOT validate:\n' + (e.stderr || e.message));
  process.exit(1);
}
