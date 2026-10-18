import { Document } from '../api.service';
import { applyMetadataPatches, DOCUMENT_METADATA_FIELDS } from '../metadata-patch';
import { parseCmExport, planCmImport } from './cm-export';
import { holdReasons } from './printable';

const HEADER = ['Dokumenten_ID', 'Gattung1', 'Editionsstatus', 'Doc-Id\' (intern)', 'dontpublish', 'Publish', 'please don\'t publish metadata', 'publish', 'Dokumenten ID'];
const row = (o: { id?: string; uuid?: string; status?: string; dp?: string; meta?: string }) =>
  [o.id ?? '', 'Antiphon', o.status ?? '', o.uuid ?? '', o.dp ?? '', 'all', o.meta ?? '', 'none', 'other'];

const doc = (id: string, name: string, extra: Partial<Document> = {}): Document => ({
  id, quelle_id: 's1', dokumenten_id: name, gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '',
  bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '', ...extra,
});

describe('parseCmExport', () => {
  it('finds the columns by header, the first of a name wins, and ignores the repeats', () => {
    const { records } = parseCmExport([HEADER, row({ id: 'Aa 13-1', uuid: 'u1', status: 'ediert', dp: 'x', meta: 'x' })]);
    expect(records).toEqual([{ row: 2, uuid: 'u1', dokumentenId: 'Aa 13-1', dontpublish: 'x', dontpublishMetadata: 'x', status: 'ediert', sigle: '' }]);
  });

  it('skips rows without any id and takes only the status words it knows', () => {
    const { records } = parseCmExport([HEADER, row({}), row({ id: 'B', status: 'Ediert' }), row({ id: 'C', status: 'whatever' })]);
    expect(records.map((r) => [r.dokumentenId, r.status])).toEqual([['B', 'ediert'], ['C', '']]);
  });

  it('reports what sits in a flag column that is no plain mark, and still counts it as set', () => {
    const { records, odd } = parseCmExport([HEADER, row({ id: 'D-1', dp: 'x' }), row({ id: 'D-2', dp: 'Zweite Melodie Quelle: Alme rex pie' }), row({ id: 'D-3', meta: 'e19f0ade-c7ce-461a' })]);
    expect(odd.map((o) => [o.row, o.id, o.column])).toEqual([[3, 'D-2', 'dontpublish'], [4, 'D-3', "please don't publish metadata"]]);
    expect(records[1].dontpublish).toBe('Zweite Melodie Quelle: Alme rex pie');
  });

  it('refuses a sheet that is not the export', () => {
    expect(() => parseCmExport([['Quelle', 'Gattung'], ['Aa 13', 'Li']])).toThrowError(/Corpus Monodicum export/);
    expect(() => parseCmExport([])).toThrowError(/Corpus Monodicum export/);
  });

  it('works with only the UUID column', () => {
    const { records } = parseCmExport([['Doc-Id\' (intern)', 'dontpublish'], ['u9', 'x']]);
    expect(records[0].uuid).toBe('u9');
    expect(records[0].dokumentenId).toBe('');
  });
});

describe('planCmImport', () => {
  const docs = [
    doc('u1', 'Aa 13-1', { druckausgabe: 'CM III' }),
    doc('u2', 'Aa 13-2'),
    doc('u3', 'Twin'), doc('u4', 'Twin'),
    doc('u5', 'Old', { custom: { dontpublish: 'x' }, editionsstatus: 'none' }),
    doc('u6', 'Not in the export'),
  ];

  it('matches by UUID first, then by a unique Dokumenten_ID, and says what it could not match', () => {
    const { records } = parseCmExport([HEADER,
      row({ uuid: 'u1', id: 'wrong name', dp: 'x' }),
      row({ id: 'Aa 13-2' }),
      row({ id: 'Twin' }),
      row({ id: 'Elsewhere', dp: 'x' }),
    ]);
    const plan = planCmImport(records, docs);
    expect(plan.matched).toBe(2);
    expect(plan.ambiguous).toBe(1);
    expect(plan.unmatched).toBe(1);
    expect(plan.flaggedNotInWorkspace).toBe(1);
    expect(plan.unmatchedSample).toEqual(['Elsewhere']);
    expect(plan.notInExport).toBe(4);
  });

  it('counts flagged documents, those that would have been printed, and what the import clears', () => {
    const { records } = parseCmExport([HEADER,
      row({ uuid: 'u1', dp: 'x', status: 'none' }),
      row({ uuid: 'u2', status: 'ediert' }),
      row({ uuid: 'u5', status: 'none' }),   // flag gone in the export
    ]);
    const plan = planCmImport(records, docs);
    expect(plan.flagged).toBe(1);
    expect(plan.flaggedWithVolume).toBe(1);
    expect(plan.newlyFlagged).toBe(1);
    expect(plan.cleared).toBe(1);
    expect(plan.statusChanged).toBe(2);   // u1 → none, u2 → ediert; u5 already was none
  });

  it('makes patches only for what differs, so a second import changes nothing', () => {
    const { records } = parseCmExport([HEADER, row({ uuid: 'u1', dp: 'x', status: 'none' }), row({ uuid: 'u2', status: 'ediert' })]);
    const first = planCmImport(records, docs);
    const applied = applyMetadataPatches(docs, first.patches, DOCUMENT_METADATA_FIELDS);
    expect(applied.changedIds.sort()).toEqual(['u1', 'u2']);
    expect(applied.rejectedFields).toBe(0);
    const again = planCmImport(records, applied.items);
    expect(again.patches).toEqual([]);
    expect(again.newlyFlagged).toBe(0);
    expect(again.flagged).toBe(1);
  });

  it('leaves a document held back for the print once the patches are applied', () => {
    const { records } = parseCmExport([HEADER, row({ uuid: 'u1', dp: 'x', status: 'ediert' })]);
    const applied = applyMetadataPatches(docs, planCmImport(records, docs).patches, DOCUMENT_METADATA_FIELDS);
    expect(holdReasons(applied.items.find((d) => d.id === 'u1'))).toEqual(['dontpublish']);
    expect(holdReasons(applied.items.find((d) => d.id === 'u2'))).toEqual([]);
  });

  it('lets the last row win when two rows name the same document', () => {
    const { records } = parseCmExport([HEADER, row({ uuid: 'u2', dp: 'x' }), row({ uuid: 'u2' })]);
    const plan = planCmImport(records, docs);
    expect(plan.duplicates).toBe(1);
    expect(plan.flagged).toBe(0);
    expect(plan.patches).toEqual([]);
  });
});
