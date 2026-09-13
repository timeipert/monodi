import { buildWorkspaceCsv, parseWorkspaceCsv, parseCsvRows } from './workspace-csv';
import { Source, Document } from './api.service';
import { RootContainer, getSyllables } from './types/model';
import { volpianoToRoot, rootToVolpiano } from './volpiano/volpiano';

function source(id: string, sigle: string, extra: Partial<Source> = {}): Source {
  return {
    id,
    quellensigle: sigle,
    herkunftsregion: '',
    herkunftsort: '',
    herkunftsinstitution: '',
    ordenstradition: '',
    quellentyp: '',
    bibliotheksort: '',
    bibliothek: '',
    bibliothekssignatur: '',
    kommentar: '',
    datierung: '',
    ...extra,
  };
}

function document(id: string, quelleId: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    quelle_id: quelleId,
    dokumenten_id: '',
    gattung1: '',
    gattung2: '',
    festtag: '',
    feier: '',
    textinitium: '',
    bibliographischerverweis: '',
    druckausgabe: '',
    zeilenstart: '',
    foliostart: '',
    kommentar: '',
    editionsstatus: '',
    ...extra,
  };
}

describe('parseCsvRows', () => {
  it('handles quoted fields with commas, quotes and newlines', () => {
    const csv = 'a,b,c\r\n"x,y","he said ""hi""","line1\nline2"\r\n';
    expect(parseCsvRows(csv)).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "hi"', 'line1\nline2'],
    ]);
  });
});

describe('workspace CSV round trip', () => {
  it('preserves metadata, custom fields and the Volpiano melody', () => {
    const notes = volpianoToRoot('1---dh-k--h---', 'Quo-ni').root;
    const src = source('s1', 'A-KN1012', { herkunftsort: 'Wien, City', custom: { shelf: 'X-7' } });
    const doc = document('d1', 's1', {
      dokumenten_id: 'A-KN1012_001r_01',
      textinitium: 'Quoniam',
      gattung1: 'Antiphon',
      custom: { editor: 'TE' },
    });

    const csv = buildWorkspaceCsv([src], [doc], { d1: notes });
    const parsed = parseWorkspaceCsv(csv);

    expect(parsed.sources.length).toBe(1);
    expect(parsed.documents.length).toBe(1);

    const s = parsed.sources[0];
    expect(s.id).toBe('s1');
    expect(s.quellensigle).toBe('A-KN1012');
    expect(s.herkunftsort).toBe('Wien, City');
    expect(s.custom!['shelf']).toBe('X-7');

    const d = parsed.documents[0];
    expect(d.id).toBe('d1');
    expect(d.quelle_id).toBe('s1');
    expect(d.dokumenten_id).toBe('A-KN1012_001r_01');
    expect(d.textinitium).toBe('Quoniam');
    expect(d.custom!['editor']).toBe('TE');

    // Melody survives via the volpiano column.
    expect(rootToVolpiano(parsed.notesByDoc['d1']).volpiano).toBe('1---dh-k--h---');
  });

  it('emits a row for a source that has no documents', () => {
    const src = source('s2', 'D-Mbs', {});
    const csv = buildWorkspaceCsv([src], [], {});
    const parsed = parseWorkspaceCsv(csv);
    expect(parsed.sources.length).toBe(1);
    expect(parsed.sources[0].quellensigle).toBe('D-Mbs');
    expect(parsed.documents.length).toBe(0);
  });

  it('starts with a UTF-8 BOM', () => {
    const csv = buildWorkspaceCsv([source('s3', 'X')], [], {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('writes the text column as space-separated syllables and round-trips them', () => {
    const notes = volpianoToRoot('1---dh-k--h---', 'Quo-ni').root;
    const csv = buildWorkspaceCsv([source('s1', 'X')], [document('d1', 's1')], { d1: notes });

    const grid = parseCsvRows(csv.slice(1)); // strip BOM for direct inspection
    const textCol = grid[0].indexOf('text');
    expect(textCol).toBeGreaterThan(-1);
    expect(grid[1][textCol]).toBe('Quo ni');

    const parsed = parseWorkspaceCsv(csv);
    expect(getSyllables(parsed.notesByDoc['d1']).map((s) => s.text)).toEqual(['Quo-', 'ni']);
  });
});

describe('CSV export options', () => {
  const notes = () => volpianoToRoot('1---b---', 'a').root;

  it('drops content columns when includeContent is false', () => {
    const csv = buildWorkspaceCsv([source('s1', 'X')], [document('d1', 's1')], { d1: notes() }, {
      includeSourceMeta: true,
      includeDocumentMeta: true,
      includeContent: false,
    });
    const header = parseCsvRows(csv.slice(1))[0];
    expect(header).not.toContain('melody');
    expect(header).not.toContain('text');
  });

  it('drops source columns when includeSourceMeta is false', () => {
    const csv = buildWorkspaceCsv(
      [source('s1', 'X')],
      [document('d1', 's1', { dokumenten_id: 'D1' })],
      { d1: notes() },
      { includeSourceMeta: false, includeDocumentMeta: true, includeContent: true }
    );
    const header = parseCsvRows(csv.slice(1))[0];
    expect(header.some((h) => h.startsWith('source_'))).toBe(false);
    expect(header).toContain('document_dokumenten_id');
  });

  it('drops columns that are empty in every row', () => {
    // festtag is never set → its column must not appear.
    const csv = buildWorkspaceCsv([source('s1', 'X')], [document('d1', 's1', { dokumenten_id: 'D1' })], { d1: notes() });
    const header = parseCsvRows(csv.slice(1))[0];
    expect(header).toContain('document_dokumenten_id');
    expect(header).not.toContain('document_festtag');
  });
});
