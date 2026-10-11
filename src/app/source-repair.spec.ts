import { repairStoredSources } from './source-repair';

const source = (extra: object = {}) => ({
  quellensigle: 'A', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '',
  ...extra,
});

describe('repairStoredSources', () => {
  it('leaves healthy data alone', () => {
    const stored = [source({ id: 'a' }), source({ id: 'b' })];
    const { sources, repaired } = repairStoredSources(stored);
    expect(repaired).toBeFalse();
    expect(sources.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('gives a source without an id one, so its row can be opened', () => {
    const { sources, repaired } = repairStoredSources([source(), source({ id: '' })]);
    expect(repaired).toBeTrue();
    expect(sources.every(s => typeof s.id === 'string' && s.id.length > 0)).toBeTrue();
    expect(new Set(sources.map(s => s.id)).size).toBe(2);
  });

  it('gives the second of two sources with the same id a new one', () => {
    const { sources, repaired } = repairStoredSources([source({ id: 'x' }), source({ id: 'x' })]);
    expect(repaired).toBeTrue();
    expect(sources[0].id).toBe('x');
    expect(sources[1].id).not.toBe('x');
  });

  it('drops entries that are not objects', () => {
    const { sources, repaired } = repairStoredSources([null, 'text', 7, source({ id: 'a' })]);
    expect(repaired).toBeTrue();
    expect(sources.map(s => s.id)).toEqual(['a']);
  });

  it('treats missing or corrupt storage as an empty list without calling it a repair', () => {
    expect(repairStoredSources(null)).toEqual({ sources: [], repaired: false });
    expect(repairStoredSources({ not: 'an array' })).toEqual({ sources: [], repaired: false });
  });
});
