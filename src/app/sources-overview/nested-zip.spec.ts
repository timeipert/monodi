import { nestedZipPath } from './nested-zip';

describe('a ZIP that only wraps another ZIP', () => {
  it('names the inner archive, macOS noise ignored', () => {
    expect(nestedZipPath(['monodi-zero-edition.zip'])).toBe('monodi-zero-edition.zip');
    expect(nestedZipPath(['__MACOSX/', '__MACOSX/._x.zip', 'export/a.ZIP', 'export/', '.DS_Store'])).toBe('export/a.ZIP');
  });

  it('is not fooled by a real export, an empty ZIP or more than one file', () => {
    expect(nestedZipPath(['Aa 13/meta.json', 'Aa 13/d1/meta.json'])).toBeNull();
    expect(nestedZipPath([])).toBeNull();
    expect(nestedZipPath(['a.zip', 'b.zip'])).toBeNull();
    expect(nestedZipPath(['a.zip', 'meta.json'])).toBeNull();
    expect(nestedZipPath(['notes.txt'])).toBeNull();
  });
});
