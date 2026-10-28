import { Source } from './api.service';
import { hasMetaAnnotations, mergeMetaAnnotations } from './zip-source-annotations';

const source = (extra: Partial<Source> = {}): Source => ({
  id: 'src-1', quellensigle: 'Aa 13', herkunftsregion: '', herkunftsort: '', herkunftsinstitution: '', ordenstradition: '',
  quellentyp: '', bibliotheksort: '', bibliothek: '', bibliothekssignatur: '', kommentar: '', datierung: '', ...extra
});

const region = { id: 'r_1', name: 'Line 4', points: '1,1 2,1 2,2 1,2', folio: '8r' };
const item = { id: 'i_1', regionId: 'r_1', pattern: '[*ud]', points: '1,1 2,1 2,2 1,2', variant: '' };
const metaWithAnnotations = () => ({
  id: 'src-1', quellensigle: 'Aa 13',
  equivalents: [{ pattern: '[*ud]', customId: '41' }],
  annotationRegions: [region],
  annotationItems: [item],
});

describe('annotations in the meta.json of a source (ZIP import)', () => {
  it('sees whether a meta.json carries annotations', () => {
    expect(hasMetaAnnotations(metaWithAnnotations())).toBeTrue();
    expect(hasMetaAnnotations({ id: 'x', equivalents: [], annotationRegions: [] })).toBeFalse();
    expect(hasMetaAnnotations(null)).toBeFalse();
  });

  it('puts table rows, line regions and snippets into a source that has none', () => {
    const target = source();
    const said = mergeMetaAnnotations(target, metaWithAnnotations());
    expect(target.annotationRegions!.map(r => r.id)).toEqual(['r_1']);
    expect(target.annotationItems!.map(i => i.id)).toEqual(['i_1']);
    expect(target.equivalents!.length).toBe(1);
    expect(said).toContain('1 line regions');
  });

  it('keeps what the workspace already has and adds what is new', () => {
    const target = source({ annotationRegions: [{ id: 'r_0', name: 'Line 1', points: '0,0 1,0 1,1 0,1', folio: '7v' } as any] });
    mergeMetaAnnotations(target, metaWithAnnotations());
    expect(target.annotationRegions!.map(r => r.id).sort()).toEqual(['r_0', 'r_1']);
  });

  it('does nothing when a second import brings the same data', () => {
    const target = source();
    mergeMetaAnnotations(target, metaWithAnnotations());
    expect(mergeMetaAnnotations(target, metaWithAnnotations())).toBe('');
    expect(target.annotationItems!.length).toBe(1);
  });

  it('leaves a source alone when the meta.json has no annotations', () => {
    const target = source();
    expect(mergeMetaAnnotations(target, { id: 'src-1', quellensigle: 'Aa 13' })).toBe('');
    expect(target.annotationRegions).toBeUndefined();
  });
});
