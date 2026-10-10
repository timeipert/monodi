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

// 11. Small capitals: all-caps syllables inside and between words, mixed with lower case.
save('x11-small-caps', root([formteil([zeile([
  ...['SA-', 'LUS', 'AU-', 'TEM', 'ET', 'PRO-', 'TE-', 'CTOR', 'Re-', 'gi-', 'a', 'X', 'IN', 'TEM-', 'PO-', 'RE'].map((t) => syl(t, [randNeume(3, 3, 4)])),
  lineChange(),
  ...['No-', 'LI', 'E-', 'MU-', 'LARI'].map((t) => syl(t, [randNeume(2, 3, 4)])),
])])]));

// 12. Low register (A3 and below: ledger lines, notes close to the SVG edge) and comments
//     framing lyrics: inside one system, across a line break, and on the very first syllable.
{
  const sy = ['Ter-', 'ri-', 'bi-', 'lis', 'est', 'lo-', 'cus', 'is-', 'te', 'Quam', 'di-', 'le-', 'cta', 'Men-', 'te', 'to-', 'ta', 'sit', 'de-', 'uo-', 'ta', 'et', 'per', 'uo-', 'cem', 'fi-', 'et', 'no-', 'ta']
    .map((t, k) => syl(t, [neume(group(...Array.from({ length: 1 + (k % 3) }, (_, i) => note(BASES[(k + i * 2) % 7], 3 - (k % 2))))), ...(k % 4 === 1 ? [randNeume(2, 3, 4)] : [])]));
  const firstNote = (x) => x.notes.spaced[0].nonSpaced[0].grouped[0].uuid;
  const lastNote = (x) => { const g = x.notes.spaced.at(-1).nonSpaced.at(-1).grouped; return g.at(-1).uuid; };
  const doc12 = root([formteil([para('LOW REGISTER AND COMMENTS'), zeile(sy)])]);
  doc12.comments = [
    { startUUID: firstNote(sy[0]), endUUID: lastNote(sy[2]), commentType: 'text', text: 'Zeichen im Editionskorpus singulär.' },
    { startUUID: firstNote(sy[11]), endUUID: lastNote(sy[12]), commentType: 'text', text: 'Lesart unsicher, vgl. Pa 1235.' },
    { startUUID: firstNote(sy[16]), endUUID: lastNote(sy[21]), commentType: 'text', text: 'Kommentar über mehrere Silben und einen Zeilenumbruch hinweg.', emendation: true },
  ];
  save('x12-low-notes-comments', doc12);
}

// 13. Very high notes (octaves 6 and 7, with neume brackets): must never be cut off, and the
//     staves of all syllables of a line must stay aligned.
save('x13-very-high-notes', root([formteil([
  para('VERY HIGH NOTES'),
  zeile(Array.from({ length: 16 }, (_, k) => syl(sylText(k), [neume(group(note(BASES[k % 7], 6 + (k % 2)), note(BASES[(k + 3) % 7], 5 + (k % 3))))]))),
  zeile(Array.from({ length: 8 }, (_, k) => syl(sylText(k + 3), [randNeume(3, 3, 4)]))),
])]));

// 14. Many chants over several pages, each with a rubric: page breaks must never strand a
//     rubric alone at the bottom of a page, nor run into the bottom margin.
save('x14-page-breaks', root(Array.from({ length: 14 }, (_, c) => formteil([
  para('RUBRIKBLOCK-' + (c + 1)),
  zeile(Array.from({ length: 6 + ((c * 7) % 5) * 11 }, (_, k) => syl(sylText(k + c), [randNeume(3, 3, 4)]))),
]))));

// 15. Every apparatus form: text, tree (text, bracket, notes, context notes, nested grid),
//     line comments with sigla (notes + paratext) and a global comment.
{
  const sy = Array.from({ length: 24 }, (_, k) => syl(sylText(k), [randNeume(3, 3, 4)]));
  const firstNote = (x) => x.notes.spaced[0].nonSpaced[0].grouped[0].uuid;
  const lastNote = (x) => x.notes.spaced.at(-1).nonSpaced.at(-1).grouped.at(-1).uuid;
  const leaf = (content) => ({ kind: 'CommentTreeLeaf', id: id(), content });
  const text = (t) => leaf({ kind: 'Text', content: t });
  const notes = (k, n, context = false) => leaf({ kind: 'Notes', content: zeile(Array.from({ length: n }, (_, i) => syl(sylText(k + i), [randNeume(3, 3, 5)]))), context });
  const grid = (...rows) => ({ kind: 'CommentTreeGrid', id: id(), items: rows });
  const doc15 = root([formteil([para('APPARATUS FORMS'), zeile(sy)])]);
  doc15.globalComment = grid([text('Überlieferung: ((Pa 1235)), ((Pa 1121)); Melodie nur in ((Pa 1235)) vollständig.')]);
  doc15.comments = [
    { startUUID: firstNote(sy[1]), endUUID: lastNote(sy[2]), commentType: 'text', text: 'Lesart von ((Pa 1121)) nach Rasur.' },
    { startUUID: firstNote(sy[4]), endUUID: lastNote(sy[6]), commentType: 'tree', text: '', tree: grid(
      [text('((Pa 1235))'), leaf({ kind: 'Bracket' }), grid([notes(4, 3)], [notes(4, 3, true)])],
      [text('((Pa 1121))'), leaf({ kind: 'Bracket' }), text('fehlt, Lücke von drei Silben; vgl. die Parallelstelle in ((Pa 909)), die eine längere Fassung überliefert.')],
    ) },
    { startUUID: firstNote(sy[10]), endUUID: lastNote(sy[13]), commentType: 'lines', text: '', readingWitnesses: ['Pa 1121', 'Pa 909'],
      lines: [zeile(Array.from({ length: 5 }, (_, i) => syl(sylText(10 + i), [randNeume(4, 3, 4)]))), para('Rubrik in roter Tinte nachgetragen.')] },
    { startUUID: firstNote(sy[16]), endUUID: lastNote(sy[23]), commentType: 'lines', text: '', readingWitnesses: ['Pa 1084'],
      lines: [zeile(Array.from({ length: 40 }, (_, i) => syl(sylText(16 + i), [randNeume(3, 2, 6)])))] },
  ];
  save('x15-apparatus-forms', doc15);
}

// 16. A dense apparatus like the printed one: many short entries, each "notes ] korrigiert aus notes",
//     a few "formal plausibler" variants with a trailing text cell, and plain text entries.
{
  const sy = Array.from({ length: 40 }, (_, k) => syl(sylText(k), [randNeume(3, 3, 4)]));
  const firstNote = (x) => x.notes.spaced[0].nonSpaced[0].grouped[0].uuid;
  const lastNote = (x) => x.notes.spaced.at(-1).nonSpaced.at(-1).grouped.at(-1).uuid;
  const leaf = (content) => ({ kind: 'CommentTreeLeaf', id: id(), content });
  const text = (t) => leaf({ kind: 'Text', content: t });
  const notes = (k, n) => leaf({ kind: 'Notes', content: zeile(Array.from({ length: n }, (_, i) => syl(sylText(k + i), [randNeume(3, 3, 4)]))), context: false });
  const grid = (...rows) => ({ kind: 'CommentTreeGrid', id: id(), items: rows });
  const doc16 = root([formteil([para('DENSE APPARATUS'), zeile(sy)])]);
  doc16.comments = [];
  for (let c = 0; c < 12; c++) {
    const from = c * 3, n = 1 + (c % 3);
    const last = Math.min(sy.length - 1, from + n - 1);
    const tree = c % 4 === 3
      ? grid([notes(from, n), leaf({ kind: 'Bracket' }), text('formal plausibler:'), notes(from, n), text('(wie 2b).')])
      : grid([notes(from, n), leaf({ kind: 'Bracket' }), text('korrigiert aus'), notes(from, n)]);
    doc16.comments.push({ startUUID: firstNote(sy[from]), endUUID: lastNote(sy[last]), commentType: 'tree', text: '', tree });
  }
  for (let c = 0; c < 6; c++) {
    doc16.comments.push({ startUUID: firstNote(sy[30 + c]), endUUID: lastNote(sy[30 + c]), commentType: 'text', text: c % 2 ? 'Lesart unsicher, vgl. ((Pa 1235)).' : 'korrigiert aus ((' + sylText(c) + '))' });
  }
  save('x16-apparatus-dense', doc16);
}

// 17. Sections with signatures whose lines begin with a line change (the caesura mark before the
//     first syllable): each signature (31, B) must stand at its own line.
{
  const sec = (sig, k) => ({ uuid: id(), kind: 'FormteilContainer', data: [{ name: 'Signatur', data: sig }], children: [
    zeile([lineChange(), ...Array.from({ length: 5 + k }, (_, i) => syl(sylText(i + k), [randNeume(3, 3, 4)]))]),
  ] });
  save('x17-signatures', root([sec('31', 3), sec('B', 0), sec('C', 1)]));
}

// 18. Lines of every length that end in a syllable with a very low note: some of them wrap so
//     that only this syllable (with its ledger lines and lyric) lands on the last system. The
//     next line must keep a clear distance from that system.
save('x18-lonely-last-syllable', root([formteil([
  para('LONELY LAST SYLLABLE'),
  ...Array.from({ length: 14 }, (_, c) => zeile([
    ...Array.from({ length: 16 + c }, (_, k) => syl(sylText(k + c), [randNeume(3, 3, 4)])),
    syl('dum', [neume(group(note('A', 2)))]),
  ])),
])]));

// 19. Folio labels written in different ways in one manuscript: bare ("31v", "33r") and with
//     "f." — in print every one gets "f." and stands at the right edge.
save('x19-folio-labels', root([formteil([
  para('FOLIO LABELS'),
  ...['31v', 'f. 32', '33r', 'fol.34'].map((lbl, c) => zeile([
    ...Array.from({ length: 6 + c }, (_, k) => syl(sylText(k + c), [randNeume(3, 3, 4)])), folio(lbl),
  ])),
])]));

// 20. Syllables without notes (the box marker): a line made only of them keeps its space but draws
//     no staff, clef or box; mixed with real notes the staff stays and the box is not drawn.
{
  const bare = (t) => syl(t, [], { syllableType: 'WithoutNotes' });
  save('x20-without-notes', root([formteil([
    para('VERSUS'),
    zeile(['Re-', 'sur-', 're-', 'xit', 'do-', 'mi-', 'nus', 'al-', 'le-', 'lu-', 'ia'].map(bare)),
    zeile([...['Si-', 'cut'].map(bare), lineChange(), ...['di-', 'xit', 'uo-', 'bis'].map(bare), syl('al-', [randNeume(3, 3, 4)]), syl('le-', [randNeume(3, 3, 4)]), bare('lu-'), bare('ia')]),
    zeile(Array.from({ length: 8 }, (_, k) => syl(sylText(k), [randNeume(3, 3, 4)]))),
  ])]));
}

console.log('wrote extreme fixtures to', out);
