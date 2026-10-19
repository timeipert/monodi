import { Source } from './api.service';
import { applyPlan, EXCHANGE_FORMAT, planImport } from './annotation-exchange';
import { convertCmTranscriptionFile, isCmTranscriptionFile, parseAnnotationFile, splitRegionKey } from './cm-transkriptionseq-import';
import { buildNotationDoc, notationNotes } from './notation-doc';

const source = (extra: Partial<Source> = {}): Source => ({
  id: 'src-1', quellensigle: 'Ful 62', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...extra
});

/** The shape of a Neume Viewer manuscript export, cut down. */
const backup = (extra: any = {}): any => ({
  schemaVersion: 2, type: 'cm-manuscript-export', exportedAt: '2026-10-09T15:09:18.561Z', exportedManuscripts: ['Ful 62'],
  data: {
    personalTables: [{
      id: 't', name: 'Ful 62', source: 'Ful 62', notes: 'Notator A: f. 91.', patterns: [],
      rows: [
        { pattern: '*', customId: '10', notes: '' },
        { pattern: '[*dL]', customId: '10+/20- ', notes: 'seldom' },     // a stray space, as in real files
        { pattern: '*', customId: '99', notes: '' },                      // the same pattern again: the first wins
        { pattern: '', customId: '5', notes: '' },
      ],
    }],
    regions: {
      'Ful 62_91v': [{ id: 'r_1', name: 'Line 1', points: '15,9 94,9 94,18 15,18' }],
      'Ful 62_92r [3]': [],
      'WiSch 4_5_12r': [{ id: 'r_2', name: 'Line 3', points: '10,10 50,10 50,20 10,20' }],
    },
    regionItems: {
      r_1: [
        { id: 17875, pattern: '*', points: '20,10 24,10 24,16 20,16', variant: 'a', linkData: { sysId: 'Ful 62-91-2|91v|1|et|D4' } },
        { id: 17876, pattern: '[*dL]', points: '30,10 34,10 34,16 30,16', variant: '' },
      ],
      r_2: [{ id: 1, pattern: '*', points: '12,12 16,12 16,18 12,18' }],
    },
    iiifLinks: { 'Ful 62': 'https://fuldig.example/manifest/', 'Only Linked': 'https://x/m.json' },
    manualLines: {}, directSnippets: [],
    ...extra,
  },
});

describe('Neume Viewer files', () => {
  describe('recognising', () => {
    it('knows a backup and a manuscript export, and nothing else', () => {
      expect(isCmTranscriptionFile(backup())).toBeTrue();
      expect(isCmTranscriptionFile({ ...backup(), type: 'cm-workspace-backup' })).toBeTrue();
      expect(isCmTranscriptionFile({ format: EXCHANGE_FORMAT, version: 1, sources: [] })).toBeFalse();
      expect(isCmTranscriptionFile(null)).toBeFalse();
      expect(isCmTranscriptionFile({ type: 'cm-manuscript-export' })).toBeFalse();   // no data
    });

    it('splits a region key at its last underscore', () => {
      expect(splitRegionKey('Ful 62_91v')).toEqual({ source: 'Ful 62', folio: '91v' });
      expect(splitRegionKey('WiSch 4_5_12r')).toEqual({ source: 'WiSch 4_5', folio: '12r' });
      expect(splitRegionKey('nounderscore')).toBeNull();
      expect(splitRegionKey('trailing_')).toBeNull();
    });
  });

  describe('convertCmTranscriptionFile', () => {
    const file = convertCmTranscriptionFile(backup());
    const ful = file.sources.find(s => s.quellensigle === 'Ful 62')!;

    it('becomes an annotation exchange file, one source per manuscript', () => {
      expect(file.format).toBe(EXCHANGE_FORMAT);
      expect(file.sources.map(s => s.quellensigle).sort()).toEqual(['Ful 62', 'WiSch 4_5']);   // not the source that only has a link
    });

    it('makes a neume table row of each pattern: the customId is the Reference ID', () => {
      expect(ful.equivalents).toEqual([
        { pattern: '*', refId: '10' },
        { pattern: '[*dL]', refId: '10+/20-', notes: 'seldom' },
      ]);
    });

    it('keeps regions with their page label and ids, and leaves out pages without lines', () => {
      expect(ful.annotationRegions).toEqual([{ id: 'r_1', name: 'Line 1', points: '15,9 94,9 94,18 15,18', folio: '', folioLabel: '91v' }]);
    });

    it('keeps snippets with their variant and the link to the transcription', () => {
      expect(ful.annotationItems).toEqual([
        { id: '17875', regionId: 'r_1', pattern: '*', points: '20,10 24,10 24,16 20,16', variant: 'a', sysId: 'Ful 62-91-2|91v|1|et|D4' },
        { id: '17876', regionId: 'r_1', pattern: '[*dL]', points: '30,10 34,10 34,16 30,16' },
      ]);
    });

    it('takes the manifest and the notes of the table', () => {
      expect(ful.iiifManifestUrl).toBe('https://fuldig.example/manifest/');
      expect(ful.notationNotes).toBe('Notator A: f. 91.');
    });

    it('refuses a file of a newer schema and a file that is not one', () => {
      expect(() => convertCmTranscriptionFile({ ...backup(), schemaVersion: 3 })).toThrowError(/newer version/);
      expect(() => convertCmTranscriptionFile({})).toThrowError(/not a file from the Neume Viewer/);
    });

    it('survives a file with only tables', () => {
      const f = convertCmTranscriptionFile({ schemaVersion: 2, type: 'cm-workspace-backup', data: { personalTables: [{ name: 'A', rows: [{ pattern: '*', customId: '10' }] }] } });
      expect(f.sources.length).toBe(1);
      expect(f.sources[0].annotationRegions).toEqual([]);
    });
  });

  describe('parseAnnotationFile', () => {
    it('reads either kind of file, as text or as data', () => {
      expect(parseAnnotationFile(JSON.stringify(backup())).sources.length).toBe(2);
      expect(parseAnnotationFile({ format: EXCHANGE_FORMAT, version: 1, sources: [{ id: 'a' }] }).sources.length).toBe(1);
    });

    it('says what it can read when it gets something else, and why a file of the right kind is refused', () => {
      expect(() => parseAnnotationFile({ hello: 1 })).toThrowError(/neither an annotation file.*nor a backup/);
      expect(() => parseAnnotationFile({ format: EXCHANGE_FORMAT, version: 99, sources: [] })).toThrowError(/newer version/);
    });
  });

  describe('imported into a source', () => {
    const plan = (local: Source) => planImport(parseAnnotationFile(backup()), [local]).plans[0];

    it('matches the manuscript by its siglum and adds everything', () => {
      const p = plan(source());
      expect(p.counts).toEqual(jasmine.objectContaining({ regionsNew: 1, itemsNew: 2, equivalentsNew: 2, manifestSet: true, notesSet: true }));
      const out = applyPlan(source(), p);
      expect(out.annotationItems![0].sysId).toBe('Ful 62-91-2|91v|1|et|D4');
      expect(notationNotes(out)).toBe('Notator A: f. 91.');
      expect(out.iiifManifestUrl).toBe('https://fuldig.example/manifest/');
    });

    it('skips what it has no source for, and reports it', () => {
      const preview = planImport(parseAnnotationFile(backup()), [source()]);
      expect(preview.unmatched).toEqual(['WiSch 4_5']);
    });

    it('never replaces notes that are already written, and a second import adds nothing', () => {
      const written = source({ custom: { notationNotes: 'my own notes' } });
      const first = plan(written);
      expect(first.counts.notesSet).toBeFalse();
      expect(notationNotes(applyPlan(written, first))).toBe('my own notes');

      const once = applyPlan(source(), plan(source()));
      const again = plan(once);
      expect(again.counts).toEqual(jasmine.objectContaining({ regionsNew: 0, itemsNew: 0, equivalentsNew: 0, notesSet: false, manifestSet: false }));
    });

    it('feeds the notation documentation: the line, the folio and the ID of each sign', () => {
      const out = applyPlan(source(), plan(source()));
      const doc = buildNotationDoc(out, { standard: [], order: 'id' });   // no standard set: what the manuscript has snippets of
      expect(doc.rows.map(r => r.refId)).toEqual(['10', '10+/20-']);
      expect(doc.strips.length).toBe(1);
      expect(doc.strips[0].place.text).toBe('91v / 1');
      expect(doc.strips[0].boxes.map(b => b.label)).toEqual(['10a', '10+20-']);
    });
  });
});
