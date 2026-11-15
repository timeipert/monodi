import { COMPRESS_OVER, packedSize, packJson, unpackJson } from './compress';

describe('packJson / unpackJson', () => {
  it('keeps small values as text', async () => {
    const p = await packJson({ a: 1 });
    expect(p.gz).toBeFalse();
    expect(await unpackJson(p)).toEqual({ a: 1 });
  });

  it('compresses large values and gives them back unchanged', async () => {
    const big = { rows: Array.from({ length: 20000 }, (_, i) => [i, `row ${i % 50}`, 'repeat repeat repeat']) };
    const text = JSON.stringify(big);
    expect(text.length).toBeGreaterThan(COMPRESS_OVER);
    const p = await packJson(big);
    expect(p.gz).toBeTrue();
    expect(packedSize(p)).toBeLessThan(text.length / 2);
    expect(await unpackJson(p)).toEqual(big);
  });
});
