import type { ProjectSettings } from '../api.service';
import { unregisteredFields, withListedFields } from './grid-data';

const settings = (o: Partial<ProjectSettings> = {}): ProjectSettings => o as ProjectSettings;

describe('custom values that no field lists', () => {
  const docs: { custom?: { [key: string]: string } }[] = [
    { custom: { Bezugsgesang: 'AN1', SpielName: '', mine: 'x' } },
    { custom: { Bezugsgesang: 'AN2', Cantus_ID: '5' } },
    { custom: undefined },
  ];

  it('finds the keys with a value that the settings do not list, sorted, with how many rows have one', () => {
    const found = unregisteredFields('documents', docs, settings({ customDocumentFields: [{ key: 'mine', label: 'Mine' }] }));
    expect(found).toEqual([{ key: 'Bezugsgesang', filled: 2 }, { key: 'Cantus_ID', filled: 1 }]);
  });

  it('does not count keys that are empty everywhere, and finds nothing once everything is listed', () => {
    expect(unregisteredFields('documents', docs, settings()).map((f) => f.key)).not.toContain('SpielName');
    const all = settings({ customDocumentFields: ['Bezugsgesang', 'Cantus_ID', 'mine'].map((key) => ({ key, label: key })) });
    expect(unregisteredFields('documents', docs, all)).toEqual([]);
  });

  it('looks at the field list of the table it is asked about', () => {
    const s = settings({ customSourceFields: [{ key: 'Bezugsgesang', label: 'x' }] });
    expect(unregisteredFields('documents', docs, s).map((f) => f.key)).toContain('Bezugsgesang');
    expect(unregisteredFields('sources', [{ custom: { Bezugsgesang: 'a' } }], s)).toEqual([]);
  });

  it('leaves the description and the notation data of a source alone', () => {
    const src = [{ custom: { description: '# Aa 13', beschreibung: 'x', notationNotes: 'n', notationSet: '{}', Archiv: 'Domarchiv' } }];
    expect(unregisteredFields('sources', src, settings()).map((f) => f.key)).toEqual(['Archiv']);
  });

  it('lists fields by adding them to the right list, once each', () => {
    const next = withListedFields(settings({ customDocumentFields: [{ key: 'a', label: 'A' }] }), 'documents', ['a', 'b', 'b'.toString()])!;
    expect(next.customDocumentFields!.map((f) => f.key)).toEqual(['a', 'b']);
    expect(next.customSourceFields).toBeUndefined();
    expect(withListedFields(settings({ customSourceFields: [{ key: 'z', label: 'z' }] }), 'sources', ['z'])).toBeNull();
    expect(withListedFields(settings(), 'sources', ['q'])!.customSourceFields).toEqual([{ key: 'q', label: 'q' }]);
  });
});
