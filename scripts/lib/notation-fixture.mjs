// A Neume Viewer manuscript export with one source ("Fix 1"), a IIIF manifest and page images that the
// e2e scripts answer themselves (no network). Shared by notation-doc-e2e and notation-set-e2e.
import zlib from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MANIFEST = 'https://iiif.test/manifest.json';
export const fixture = {
  schemaVersion: 2, type: 'cm-manuscript-export', exportedAt: '2026-10-19T00:00:00Z', exportedManuscripts: ['Fix 1'],
  data: {
    personalTables: [{
      id: 't1', name: 'Fix 1', source: 'Fix 1', notes: 'Notator A: f. 8r.', patterns: [],
      rows: [
        { pattern: '*', customId: '10', notes: '' },
        { pattern: '[*du]', customId: '21', notes: '' },
        { pattern: '[*dL]', customId: '10+/20-', notes: '' },
      ],
    }],
    regions: {
      'Fix 1_8r': [{ id: 'r_a', name: 'Line 6', points: '10,30 80,30 80,38 10,38' }],
      'Fix 1_9v': [{ id: 'r_b', name: 'Line 2', points: '12,20 82,20 82,28 12,28' }],
      'Fix 1_8r [3]': [],
    },
    regionItems: {
      r_a: [
        { id: 1001, pattern: '*', points: '20,32 24,32 24,36 20,36', variant: 'a', linkData: { sysId: 'Fix 1-8-1|8r|6|et|D4' } },
        { id: 1002, pattern: '[*du]', points: '40,31 46,31 46,36 40,36', variant: '', linkData: { sysId: 'Fix 1-8-1|8r|6|ra|F4-E4-F4' } },
      ],
      r_b: [
        { id: 1003, pattern: '[*dL]', points: '30,21 35,21 35,26 30,26', variant: 'b', linkData: { sysId: 'Fix 1-9-1|9v|2|um|G4-F4' } },
        { id: 1004, pattern: '*uu', points: '50,21 55,21 55,26 50,26', variant: '', linkData: { sysId: 'Fix 1-9-1|9v|2|xx|C4-D4-E4' } },   // no Reference ID in the table
      ],
    },
    manualLines: {},
    iiifLinks: { 'Fix 1': MANIFEST },
  },
};
/** Writes the fixture into a new temporary folder; returns the folder and the file. */
export function writeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'monodi-notation-'));
  const file = join(dir, 'cm-manuscripts-Fix-1.json');
  writeFileSync(file, JSON.stringify(fixture));
  return { dir, file };
}

// a small grey PNG for the page crops (what the "IIIF server" returns)
export function png(w, h) {
  const crc = (buf) => { const b = Buffer.alloc(4); b.writeUInt32BE(zlib.crc32(buf) >>> 0); return b; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, t, data, crc(Buffer.concat([t, data]))]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x + y) % 40 < 3 ? 40 : 190;   // light page, dark lines
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const canvas = (n, label) => ({ '@id': `https://iiif.test/canvas/${n}`, '@type': 'sc:Canvas', label, width: 1000, height: 1400, images: [{ resource: { '@id': `https://iiif.test/img/p${n}/full/full/0/default.jpg`, service: { '@id': `https://iiif.test/img/p${n}`, profile: 'http://iiif.io/api/image/2/level1.json' } } }] });
// labels padded with zeros ("008r"), as DIAMM writes them, and with a count behind them ("9v [10]"), as Berlin does
export const manifest = { '@context': 'http://iiif.io/api/presentation/2/context.json', sequences: [{ canvases: [canvas(1, '001r'), canvas(8, '008r'), canvas(9, '9v [10]')] }] };


/** Answers the manifest and the page images of the fixture; `imageRequests` collects the image addresses asked for. */
export async function interceptIiif(page, imageRequests = []) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const cors = { 'access-control-allow-origin': '*' };
    if (url === MANIFEST) return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(manifest) });
    if (url.startsWith('https://iiif.test/img/')) { imageRequests.push(url); return req.respond({ status: 200, contentType: 'image/png', headers: cors, body: png(600, 120) }); }
    req.continue();
  });
}
