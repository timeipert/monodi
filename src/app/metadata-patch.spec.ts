import { DOCUMENT_METADATA_FIELDS, applyMetadataPatches } from './metadata-patch';

interface Item { id?: string; a: string; b: string; custom?: { [k: string]: string } }

const items = (): Item[] => [
  { id: '1', a: 'x', b: 'y' },
  { id: '2', a: 'x', b: 'y', custom: { c: 'old' } },
  { id: '3', a: 'x', b: 'y' },
  { a: 'no id', b: '' },
];
const ALLOWED = new Set(['a', 'b']);

describe('applyMetadataPatches', () => {
  it('changes only the patched fields of the patched items and leaves the others as the same objects', () => {
    const before = items();
    const res = applyMetadataPatches(before, [{ id: '1', fields: { a: 'new' } }], ALLOWED);
    expect(res.items[0]).toEqual({ id: '1', a: 'new', b: 'y' });
    expect(res.items[1]).toBe(before[1]);
    expect(res.items[2]).toBe(before[2]);
    expect(res.changedIds).toEqual(['1']);
    expect(before[0].a).toBe('x');          // the input is not mutated
  });

  it('writes custom fields without losing the others', () => {
    const res = applyMetadataPatches(items(), [{ id: '2', fields: { 'custom.c': 'new', 'custom.d': 'added' } }], ALLOWED);
    expect(res.items[1].custom).toEqual({ c: 'new', d: 'added' });
  });

  it('does not count a patch that sets what is already there as a change', () => {
    const before = items();
    const res = applyMetadataPatches(before, [{ id: '1', fields: { a: 'x' } }, { id: '2', fields: { 'custom.c': 'old' } }], ALLOWED);
    expect(res.changedIds).toEqual([]);
    expect(res.items[0]).toBe(before[0]);
    expect(res.items[1]).toBe(before[1]);
  });

  it('refuses fields that are not allowed (id, quelle_id, anything unknown) and reports ids that are gone', () => {
    const res = applyMetadataPatches(items(), [{ id: '1', fields: { id: 'hijack', quelle_id: 'x', nope: 'v', a: 'ok' } }, { id: 'gone', fields: { a: 'v' } }], ALLOWED);
    expect(res.items[0].id).toBe('1');
    expect(res.items[0].a).toBe('ok');
    expect(res.rejectedFields).toBe(3);
    expect(res.missingIds).toEqual(['gone']);
  });

  it('merges several patches for one item', () => {
    const res = applyMetadataPatches(items(), [{ id: '3', fields: { a: '1' } }, { id: '3', fields: { b: '2' } }], ALLOWED);
    expect(res.items[2]).toEqual({ id: '3', a: '1', b: '2' });
  });

  it('never lets a document edit change its id or its source', () => {
    expect(DOCUMENT_METADATA_FIELDS.has('id')).toBeFalse();
    expect(DOCUMENT_METADATA_FIELDS.has('quelle_id')).toBeFalse();
    expect(DOCUMENT_METADATA_FIELDS.has('dokumenten_id')).toBeTrue();
  });

  it('handles 20 000 items with 20 000 patches in one pass', () => {
    const many: Item[] = Array.from({ length: 20000 }, (_, i) => ({ id: 'i' + i, a: 'x', b: 'y' }));
    const patches = many.map((m) => ({ id: m.id!, fields: { a: 'z' } }));
    const t0 = performance.now();
    const res = applyMetadataPatches(many, patches, ALLOWED);
    expect(res.changedIds.length).toBe(20000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
