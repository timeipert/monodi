import { NoteType } from '../types/model';
import { DocxCell, DocxContent, DocxRun } from './guido-docx-reader';
import { importGuido } from './guido-import';
import { BUILTIN_GUIDO_TEMPLATE, GuidoTemplate, parseGuidoTemplate } from './guido-template';

const GUIDO = 'guido6+';
const TNR = 'Times New Roman';
const cell = (...runs: DocxRun[]): DocxCell => ({ runs });
const code = (text: string, grey = false): DocxRun => ({ text, font: GUIDO, color: grey ? 'BFBFBF' : null });
const word = (text: string): DocxRun => ({ text, font: TNR, color: null });
const empty = cell();

/** Column 0 siglum, column 1 clef, then one column per syllable. */
const codeRow = (siglum: string, ...cells: DocxCell[]): DocxCell[] => [cell(word(siglum)), cell(code('<--')), ...cells];
const textRow = (...texts: string[]): DocxCell[] => [empty, empty, ...texts.map(t => (t ? cell(word(t)) : empty))];

function content(rows: DocxCell[][], title = 'R 1001_Dum staret', more: DocxCell[][][] = []): DocxContent {
  return { paragraphs: [title], tables: [{ rows }, ...more.map(r => ({ rows: r }))] };
}

const syllables = (r: ReturnType<typeof importGuido>, docId: string) => {
  const line: any = (r.notes[docId].children[0] as any).children[0];
  return line.children.filter((p: any) => p.kind === 'Syllable');
};
const pitches = (s: any) => s.notes.spaced.flatMap((ne: any) => ne.nonSpaced.flatMap((g: any) => g.grouped.map((n: any) => n.base + n.octave)));

describe('guido-import', () => {
  const rows = [
    codeRow('Str-1', cell(code('1\\------')), cell(code('1\\eE10----')), cell(code('5---:-'))),
    textRow('Dum', 'ret', 'ham'),
    codeRow('Str-2', cell(code('1', true)), cell(code('1\\eE10----')), cell(code('5---', true))),
    codeRow('BNS-I', cell(code('3', true)), cell(code('------', true)), cell(code('5---'))),
    textRow('', '', 'ham-'),
    codeRow('Str-42', cell(code('1', true)), cell(code('3', true)), cell(code('5', true))),
  ];

  it('makes one source and one document per source with something attested', () => {
    const r = importGuido(content(rows), BUILTIN_GUIDO_TEMPLATE, 'R 1001.docx');
    expect(r.sources.map(s => s.id)).toEqual(['Str-1', 'Str-2', 'BNS-I']);
    expect(r.skipped).toEqual(['Str-42']);
    expect(r.documents.map(d => d.id)).toEqual(['Str-1-R 1001', 'Str-2-R 1001', 'BNS-I-R 1001']);
    expect(r.documents[0]).toEqual(jasmine.objectContaining({
      quelle_id: 'Str-1', dokumenten_id: 'Str-1-R 1001', textinitium: 'Dum staret',
      custom: { chant_id: 'R 1001', import_file: 'R 1001.docx' },
    }));
  });

  it('reads the notes of the shared text and skips the grey copies', () => {
    const r = importGuido(content(rows), BUILTIN_GUIDO_TEMPLATE);
    const s1 = syllables(r, 'Str-1-R 1001');
    expect(s1.map((s: any) => s.text)).toEqual(['Dum', 'ret', 'ham']);
    expect(pitches(s1[1])).toEqual(['D4', 'F4', 'D4', 'C4']);
    const s2 = syllables(r, 'Str-2-R 1001');
    expect(s2.map((s: any) => s.text)).toEqual(['ret']);                // the grey cells are not Str-2's
  });

  it('takes the own text of a source where it has one', () => {
    const r = importGuido(content(rows), BUILTIN_GUIDO_TEMPLATE);
    expect(syllables(r, 'BNS-I-R 1001').map((s: any) => s.text)).toEqual(['ham-']);
  });

  it('stores a virga as flag V on a normal note, a quilisma as a note type, a plica as flag P', () => {
    const r = importGuido(content([codeRow('S', cell(code('4t¬5%'))), textRow('x')]), BUILTIN_GUIDO_TEMPLATE);
    const notes = syllables(r, 'S-R 1001')[0].notes.spaced[0].nonSpaced[0].grouped;
    expect(notes.map((n: any) => [n.base + n.octave, n.noteType, n.flags])).toEqual([
      ['G4', NoteType.Normal, undefined],
      ['A4', NoteType.Normal, ['V']],
      ['F4', NoteType.Quilisma, undefined],
      ['A4', NoteType.Normal, ['P']],
    ]);
    expect(notes.every((n: any) => n.liquescent === false)).toBeTrue();
  });

  it('puts the G clef first and can leave it out', () => {
    const r = importGuido(content(rows), BUILTIN_GUIDO_TEMPLATE);
    const line: any = (r.notes['Str-1-R 1001'].children[0] as any).children[0];
    expect(line.children[0]).toEqual(jasmine.objectContaining({ kind: 'Clef', base: 'G', octave: 4, shape: 'G' }));
    const t: GuidoTemplate = parseGuidoTemplate({ id: 'n', name: 'n', mapping: { clef: 'none' } }).template!;
    const r2 = importGuido(content(rows), t);
    expect((r2.notes['Str-1-R 1001'].children[0] as any).children[0].children[0].kind).toBe('Syllable');
  });

  it('keeps phrasing marks in the report unless the template puts them into the text', () => {
    const r = importGuido(content(rows), BUILTIN_GUIDO_TEMPLATE);
    expect(r.reports[0].lines.some(l => l.includes('[:]'))).toBeTrue();
    expect(syllables(r, 'Str-1-R 1001')[2].text).toBe('ham');
    const t = parseGuidoTemplate({ id: 'p', name: 'p', symbols: { phrasingMarks: 'text' } }).template!;
    expect(syllables(importGuido(content(rows), t), 'Str-1-R 1001')[2].text).toBe('ham:');
  });

  it('reads a different layout from the template', () => {
    // siglum in column 1, code from column 2, no clef column
    const t = parseGuidoTemplate({ id: 'l', name: 'l', layout: { siglumColumn: 1, firstCodeColumn: 2 }, codeFont: '' }).template!;
    const r = importGuido(content([
      [empty, cell(word('S')), cell(code('4')), cell(code('5'))],
      [empty, empty, cell(word('a')), cell(word('b'))],
    ]), t);
    expect(syllables(r, 'S-R 1001').map((s: any) => s.text)).toEqual(['a', 'b']);
  });

  it('only reads runs in the code font', () => {
    const r = importGuido(content([
      [cell(word('S')), cell(code('<--')), cell(code('4'), { text: '7', font: TNR, color: null })],
      textRow('a'),
    ]), BUILTIN_GUIDO_TEMPLATE);
    expect(pitches(syllables(r, 'S-R 1001')[0])).toEqual(['G4']);
  });

  it('falls back to the incipit when the title has no number, and warns about an empty file', () => {
    const r = importGuido(content(rows, 'Dum staret'), BUILTIN_GUIDO_TEMPLATE);
    expect(r.documents[0].id).toBe('Str-1-Dum staret');
    expect(r.documents[0].custom!['chant_id']).toBeUndefined();
    expect(importGuido({ paragraphs: [], tables: [] }, BUILTIN_GUIDO_TEMPLATE).warnings).toEqual(['The file has no tables.']);
  });

  it('reports characters it cannot read and gives stable ids', () => {
    const rows2 = [codeRow('S', cell(code('4À'))), textRow('x')];
    const a = importGuido(content(rows2), BUILTIN_GUIDO_TEMPLATE);
    expect(a.reports[0].warnings[0]).toContain('"À"');
    const b = importGuido(content(rows2), BUILTIN_GUIDO_TEMPLATE);
    expect(JSON.stringify(a.notes)).toEqual(JSON.stringify(b.notes));
  });
});
