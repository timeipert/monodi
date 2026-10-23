import type { Document, Source } from '../api.service';
import { RootContainer } from '../types/model';
import { GuidoImportResult } from './guido-import';
import { mergeNoteFlags, planGuidoImport, undefinedFlags } from './guido-apply';
import { BUILTIN_GUIDO_TEMPLATE } from './guido-template';

const source = (id: string, quellensigle = id): Source => ({
  id, quellensigle, herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '',
});
const doc = (id: string, quelle_id: string): Document => ({
  id, quelle_id, dokumenten_id: id, gattung1: '', gattung2: '', festtag: '', feier: '', textinitium: '',
  bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
});
const root = (flags?: string[]) => ({
  kind: 'RootContainer', children: [{ notes: { spaced: [{ nonSpaced: [{ grouped: [{ flags }] }] }] }, kind: 'Syllable' }],
} as unknown as RootContainer);

function result(): GuidoImportResult {
  return {
    template: BUILTIN_GUIDO_TEMPLATE, title: { id: 'R 1', incipit: 'x', raw: '' },
    sources: [source('Str-1'), source('Str-2')],
    documents: [doc('Str-1-R 1', 'Str-1'), doc('Str-2-R 1', 'Str-2')],
    notes: { 'Str-1-R 1': root(['V']), 'Str-2-R 1': root(['Z']) },
    reports: [], skipped: [], warnings: [],
  };
}

describe('guido-apply', () => {
  it('adds everything to an empty workspace', () => {
    const p = planGuidoImport(result(), [], [], 'skip');
    expect(p.newSources.map(s => s.id)).toEqual(['Str-1', 'Str-2']);
    expect(p.documents.map(d => d.action)).toEqual(['new', 'new']);
  });

  it('reuses a source with the same siglum whatever its id', () => {
    const p = planGuidoImport(result(), [source('3f2a-uuid', 'Str-1')], [], 'skip');
    expect(p.newSources.map(s => s.id)).toEqual(['Str-2']);
    expect(p.documents[0].document.quelle_id).toBe('3f2a-uuid');
    expect(p.documents[1].document.quelle_id).toBe('Str-2');
  });

  it('skips a document the workspace has by default, replaces or copies on request', () => {
    const have = ['Str-1-R 1'];
    expect(planGuidoImport(result(), [], have, 'skip').documents.map(d => d.action)).toEqual(['skip', 'new']);
    expect(planGuidoImport(result(), [], have, 'replace').documents.map(d => d.action)).toEqual(['replace', 'new']);
    const copy = planGuidoImport(result(), [], have, 'copy');
    expect(copy.documents.map(d => d.action)).toEqual(['copy', 'new']);
    expect(copy.documents[0].document.id).toBe('Str-1-R 1 (2)');
    expect(copy.documents[0].document.dokumenten_id).toBe('Str-1-R 1 (2)');
  });

  it('numbers copies past the ones that exist', () => {
    const p = planGuidoImport(result(), [], ['Str-1-R 1', 'Str-1-R 1 (2)'], 'copy');
    expect(p.documents[0].document.id).toBe('Str-1-R 1 (3)');
  });

  it('adds flag definitions that are missing and never changes yours', () => {
    const mine = [{ key: 'V', label: 'My virga', abbrev: 'v' }];
    const { flags, added } = mergeNoteFlags(mine, BUILTIN_GUIDO_TEMPLATE.ensureFlags);
    expect(added).toEqual(['P', 'T', 'F', 'H', 'U']);
    expect(flags[0]).toEqual(mine[0]);
    expect(mergeNoteFlags(undefined, []).flags).toEqual([]);
  });

  it('finds flags on the notes that nothing defines', () => {
    expect(undefinedFlags(result(), undefined)).toEqual(['Z']);
    expect(undefinedFlags(result(), [{ key: 'Z', label: 'z', abbrev: 'z' }])).toEqual([]);
  });
});
