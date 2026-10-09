import { genreOf, headlineText, inlineMetadataItems, metadataFieldLabel, metadataFieldValue } from './document-metadata';

const doc: any = {
  id: 'd', quelle_id: 's', dokumenten_id: 'Pa 1235-2v-1', textinitium: 'Ecce dies', gattung1: 'Tropus', gattung2: 'Introitus-Tropus',
  festtag: 'In dedicatione', feier: 'ecclesie', foliostart: '2v', zeilenstart: '1', druckausgabe: '9', bibliographischerverweis: '', kommentar: '',
  custom: { siglum: 'Pa' },
};
const settings: any = { customDocumentFields: [{ key: 'siglum', label: 'Siglum' }] };

describe('document-metadata', () => {
  it('labels and values of built-in and custom fields', () => {
    expect(metadataFieldLabel('dokumenten_id', settings)).toBe('ID');
    expect(metadataFieldLabel('siglum', settings)).toBe('Siglum');
    expect(metadataFieldLabel('unknown', settings)).toBe('unknown');
    expect(metadataFieldValue(doc, 'textinitium')).toBe('Ecce dies');
    expect(metadataFieldValue(doc, 'siglum')).toBe('Pa');
    expect(metadataFieldValue(undefined, 'textinitium')).toBe('');
  });

  it('inline items skip empty fields and combine genre, feast and folio', () => {
    const items = inlineMetadataItems(doc, settings);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.val]));
    expect(byLabel['Genre']).toBe('Tropus / Introitus-Tropus');
    expect(byLabel['Feast']).toBe('In dedicatione (ecclesie)');
    expect(byLabel['Folio/Line']).toBe('F: 2v, L: 1');
    expect(byLabel['Edition']).toBe('9');
    expect(byLabel['Siglum']).toBe('Pa');
    expect('Ref' in byLabel).toBeFalse();
    expect('Comment' in byLabel).toBeFalse();
  });

  it('headline joins the chosen fields', () => {
    expect(headlineText(doc, ['dokumenten_id', 'festtag'], settings)).toBe('Pa 1235-2v-1   •   Feast Day: In dedicatione');
    expect(headlineText(doc, [], settings)).toBe('');
  });

  it('genreOf tolerates missing parts', () => {
    expect(genreOf(doc)).toBe('Tropus / Introitus-Tropus');
    expect(genreOf({ gattung1: 'Antiphon' } as any)).toBe('Antiphon');
    expect(genreOf(undefined)).toBe('');
  });
});
