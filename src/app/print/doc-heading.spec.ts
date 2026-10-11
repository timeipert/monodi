import { DEFAULT_HEADING_FIELDS, headingParts, sanitizeHeadingFields } from './doc-heading';

const d = (id: string, g1: string, ref = '') => ({ dokumenten_id: id, gattung1: g1, gattung2: '', bibliographischerverweis: ref, textinitium: 'In' } as any);

describe('document heading', () => {
  it('defaults to ID, reference and genre', () => {
    expect(DEFAULT_HEADING_FIELDS.map((f) => f.key)).toEqual(['dokumenten_id', 'bibliographischerverweis', 'genre']);
  });

  it('prints the genre only where documents differ', () => {
    const a = d('A1', 'Gloria', 'CAO 1'), b = d('A2', 'Kyrie');
    expect(headingParts(a, DEFAULT_HEADING_FIELDS, null, [a, b]).map((p) => p.text)).toEqual(['A1', 'CAO 1', 'Gloria']);
    const c = d('A3', 'Gloria');
    expect(headingParts(a, DEFAULT_HEADING_FIELDS, null, [a, c]).map((p) => p.text)).toEqual(['A1', 'CAO 1']);
    expect(headingParts(a, DEFAULT_HEADING_FIELDS, null, [a]).map((p) => p.text)).toEqual(['A1', 'CAO 1']);
  });

  it('leaves out empty values and applies label, style', () => {
    const a = d('A1', 'Gloria');
    const parts = headingParts(a, [{ key: 'dokumenten_id', showLabel: true, label: 'No.', style: 'bold' }, { key: 'bibliographischerverweis' }, { key: 'textinitium', showLabel: true }], null, [a]);
    expect(parts).toEqual([
      { key: 'dokumenten_id', label: 'No.', text: 'A1', style: 'bold' },
      { key: 'textinitium', label: 'Initium', text: 'In', style: 'normal' },
    ]);
  });

  it('sanitizes stored fields', () => {
    expect(sanitizeHeadingFields(undefined).length).toBe(3);
    expect(sanitizeHeadingFields([])).toEqual([]);
    expect(sanitizeHeadingFields([{ key: 'x', style: 'weird' }, null, { key: 5 }])).toEqual([{ key: 'x', label: undefined, showLabel: false, style: 'normal', onlyIfVaries: false }]);
  });
});
