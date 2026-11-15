import { documentFromMeta, sourceFromMeta } from './workspace-import';

describe('workspace-import: records from meta.json', () => {
  it('reads a source: known keys, manifest as IIIF address, the rest in custom, beschreibung as description', () => {
    const source = sourceFromMeta({
      id: 'Aa 13', quellensigle: 'Aa 13', bibliothek: 'Domarchiv', datierung: '12. Jh', manifest: 'https://iiif.test/m',
      jahrhundert: '12.', publish: 'all', status: '', beschreibung: '# Text', dataset_external_files: { a: 'b' }, nothing: null,
    }, 'Aa 13');
    expect(source.id).toBe('Aa 13');
    expect(source.quellensigle).toBe('Aa 13');
    expect(source.bibliothek).toBe('Domarchiv');
    expect(source.iiifManifestUrl).toBe('https://iiif.test/m');
    expect(source.custom?.['jahrhundert']).toBe('12.');
    expect(source.custom?.['publish']).toBe('all');
    expect(source.custom?.['dataset_external_files']).toBe('{"a":"b"}');
    expect(source.custom?.['beschreibung']).toBeUndefined();
    expect(source.custom?.['description']).toBe('# Text');
    expect(source.custom?.['nothing']).toBeUndefined();
    expect(source.custom?.['manifest']).toBeUndefined();
  });

  it('uses the source id as siglum when the metadata has none, and leaves custom out when empty', () => {
    const source = sourceFromMeta({}, 'X 1');
    expect(source.quellensigle).toBe('X 1');
    expect(source.custom).toBeUndefined();
  });

  it('reads a document of the monodi export: additionalData becomes custom, unknown keys are kept', () => {
    const doc = documentFromMeta({
      id: 'uuid', quelle_id: 'Aa 13', dokumenten_id: 'Aa 13-107v-7', gattung1: 'Tropus', festtag: 'Nat', textinitium: 'Hodie',
      foliostart: '107v', additionalData: { Editor: 'Ed', Endzeile: '4' }, subcorpus: 'edition', publish: 'all',
    }, 'uuid', 'Aa 13');
    expect(doc.id).toBe('uuid');
    expect(doc.quelle_id).toBe('Aa 13');
    expect(doc.dokumenten_id).toBe('Aa 13-107v-7');
    expect(doc.gattung1).toBe('Tropus');
    expect(doc.custom?.['Editor']).toBe('Ed');
    expect(doc.custom?.['subcorpus']).toBe('edition');
    expect(doc.custom?.['publish']).toBe('all');
  });

  it('reads the English-ish keys of the OMMR4all export', () => {
    const doc = documentFromMeta({ genre: 'Antiphon', festum: 'Adventus', dies: 'Dom 1', rowstart: '3' }, 'd1', 's1');
    expect(doc.gattung1).toBe('Antiphon');
    expect(doc.festtag).toBe('Adventus');
    expect(doc.feier).toBe('Dom 1');
    expect(doc.zeilenstart).toBe('3');
    expect(doc.dokumenten_id).toBe('d1');
    expect(doc.custom).toEqual({});
  });
});
