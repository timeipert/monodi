import { SOURCE_DESCRIPTION_KEY, setSourceDescription, sourceDescription } from './source-description';

describe('source description', () => {
  it('uses the English key', () => {
    const s: any = {};
    setSourceDescription(s, '# Hi');
    expect(s.custom[SOURCE_DESCRIPTION_KEY]).toBe('# Hi');
    expect(SOURCE_DESCRIPTION_KEY).toBe('description');
    expect(sourceDescription(s)).toBe('# Hi');
  });

  it('reads the legacy key and replaces it on save', () => {
    const s: any = { custom: { beschreibung: 'alt' } };
    expect(sourceDescription(s)).toBe('alt');
    setSourceDescription(s, 'neu');
    expect(s.custom).toEqual({ description: 'neu' });
  });

  it('removes the entry when emptied', () => {
    const s: any = { custom: { description: 'x', other: 'y' } };
    setSourceDescription(s, '  ');
    expect(s.custom).toEqual({ other: 'y' });
    expect(sourceDescription(null)).toBe('');
  });
});
