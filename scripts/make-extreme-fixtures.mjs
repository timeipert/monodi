// Generates synthetic stress documents (absurd + plausible) into src/app/testdata/extreme/.
// Deterministic (seeded). Run: node scripts/make-extreme-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/app/testdata/extreme');
mkdirSync(out, { recursive: true });

let seed = 20261009;
const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const BASES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const note = (base, octave, extra = {}) => ({ uuid: id(), noteType: 'Normal', base, liquescent: false, octave, focus: false, ...extra });
const group = (...notes) => ({ grouped: notes });
const neume = (...groups) => ({ nonSpaced: groups });
const syl = (text, neumes, extra = {}) => ({ uuid: id(), kind: 'Syllable', text, syllableType: 'Normal', notes: { spaced: neumes }, ...extra });
const randNote = (lo = 3, hi = 5) => note(BASES[Math.floor(rand() * 7)], lo + Math.floor(rand() * (hi - lo + 1)));
const randNeume = (maxNotes = 4, lo = 3, hi = 5) => neume(group(...Array.from({ length: 1 + Math.floor(rand() * maxNotes) }, () => randNote(lo, hi))));
const lineChange = () => ({ uuid: id(), kind: 'LineChange', hasNotes: true, focus: false });
const folio = (t) => ({ uuid: id(), kind: 'FolioChange', focus: false, text: t });
const clef = (shape, base, octave) => ({ uuid: id(), kind: 'Clef', focus: false, base, octave, shape });
const zeile = (children, extra = {}) => ({ uuid: id(), kind: 'ZeileContainer', children, ...extra });
const para = (text) => ({ uuid: id(), kind: 'ParatextContainer', text, retro: false, paratextType: 'Aufführung', children: [] });
const formteil = (children) => ({ uuid: id(), kind: 'FormteilContainer', children });
const root = (formteile) => ({ uuid: id(), kind: 'RootContainer', comments: [], documentType: 'Level1', children: formteile });
const save = (name, doc) => writeFileSync(join(out, name + '.json'), JSON.stringify(doc));

const words = ['Ky', 'ri', 'e', 'e', 'le', 'i', 'son', 'Glo', 'ri', 'a', 'in', 'ex', 'cel', 'sis', 'De', 'o'];
const sylText = (k) => words[k % words.length] + (k % 3 === 2 ? '' : '-');

// 1. Plausible chant: Gaudeamus-like, mixed neumes, a line change and folio change.
save('x01-plausible', root([formteil([para('GAUDEAMUS (synthetic)'), zeile([
  ...Array.from({ length: 14 }, (_, k) => syl(sylText(k), [randNeume(3, 3, 4), ...(k % 4 === 0 ? [randNeume(2, 3, 4)] : [])])),
  lineChange(), ...Array.from({ length: 12 }, (_, k) => syl(sylText(k + 3), [randNeume(3, 3, 4)])), folio('f. 31v'),
  ...Array.from({ length: 10 }, (_, k) => syl(sylText(k + 7), [randNeume(4, 3, 4)])),
])])]));

// 2. Very long syllable text (200 chars) between normal ones.
save('x02-long-syllable', root([formteil([zeile([
  syl('Be-', [randNeume()]), syl('x'.repeat(200), [randNeume()]), syl('ne-', [randNeume()]),
  syl('Pneumatologie-und-andere-sehr-lange-Wörter-ohne-Trennstelle', [randNeume(2)]), syl('a', [randNeume()]),
])])]));

// 3. Empty line, line without notes, only a clef, only markers.
save('x03-empty-things', root([formteil([
  zeile([]), zeile([clef('C', 'C', 5)]), zeile([lineChange(), lineChange(), folio('f. 1r'), folio('f. 1v')]),
  zeile([syl('Nur-', []), syl('Text', [])]), zeile([syl('', [randNeume()])]),
])]));

// 4. 300 notes in a single syllable, no text.
save('x04-300-notes-one-syllable', root([formteil([zeile([
  syl('', [neume(group(...Array.from({ length: 300 }, () => randNote())))]),
])])]));

// 5. Octave leaps, ledger lines high and low, liquescents.
save('x05-ledger-lines', root([formteil([zeile([
  ...Array.from({ length: 24 }, (_, k) => syl(sylText(k), [neume(group(note('C', k % 2 ? 2 : 6), note(BASES[k % 7], k % 2 ? 6 : 2, { liquescent: k % 5 === 0 })))])),
])])]));

// 6. 400 short syllables: many wraps; with explicit mid-line clefs and break markers.
save('x06-many-wraps', root([formteil([zeile(
  Array.from({ length: 400 }, (_, k) => k % 37 === 0 ? clef('C', 'C', 5) : k % 53 === 0 ? lineChange() : syl(sylText(k), [randNeume(3)])),
)])]));

// 7. Marker right after the clef position and at line end; consecutive markers mid-line.
save('x07-markers', root([formteil([
  zeile([lineChange(), syl('A-', [randNeume()]), syl('men', [randNeume()]), lineChange()]),
  zeile([syl('A-', [randNeume()]), lineChange(), lineChange(), folio('f. 2r'), syl('men', [randNeume()])]),
])]));

// 8. Adiastematic line (no staff).
save('x08-adiastematic', root([formteil([zeile(
  Array.from({ length: 20 }, (_, k) => syl(sylText(k), [randNeume(4)])), { notation: 'adiastematic' })])]));

// 9. Many short zeilen (clef modes: every-line vs document-start should differ a lot).
save('x09-many-zeilen', root([formteil(Array.from({ length: 12 }, (_, z) =>
  zeile(Array.from({ length: 3 + (z % 5) }, (_, k) => syl(sylText(k + z), [randNeume(3)])))))]));

// 10. Folio changes at every kind of spot: line start/end, crowded system (no room at the
//     margin), several in one system, long labels.
{
  const line = (n, folioAt) => zeile(Array.from({ length: n }, (_, k) => k).flatMap((k) =>
    [syl(sylText(k), [randNeume(3)]), ...(folioAt[k] ? [folio(folioAt[k])] : [])]));
  save('x10-folio-positions', root([formteil([
    line(10, { 4: 'f. 12v' }),
    line(26, { 24: 'f. 13r', 25: 'f. 13v' }),   // fills the system: label has no room
    line(8, { 1: 'f. 1r', 3: 'f. 1v', 5: 'f. 2r' }),
    line(30, { 0: 'f. 99v' }),
    line(12, { 11: 'fol. 1234 verso (sic)' }),
  ])]));
}

console.log('wrote extreme fixtures to', out);
