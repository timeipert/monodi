import { formatFolioLabel, sanitizeFolioPrefixMode, usesFolioPrefix } from './folio-label';

describe('folio labels', () => {
  it('detects a foliated manuscript from any label that says f.', () => {
    expect(usesFolioPrefix(['157', '46v'])).toBeFalse();
    expect(usesFolioPrefix(['157', 'f. 46v'])).toBeTrue();
    expect(usesFolioPrefix(['fol.3'])).toBeTrue();
    expect(usesFolioPrefix([])).toBeFalse();
    expect(usesFolioPrefix(['p. 3', 'Ref'])).toBeFalse();
  });

  it('auto: bare references get "f." once the manuscript is foliated', () => {
    expect(formatFolioLabel('157', 'auto', true)).toBe('f. 157');
    expect(formatFolioLabel('46v', 'auto', true)).toBe('f. 46v');
    expect(formatFolioLabel('85a', 'auto', true)).toBe('f. 85a');
    expect(formatFolioLabel('157', 'auto', false)).toBe('157');
  });

  it('always: every bare reference gets "f.", off: nothing is touched', () => {
    expect(formatFolioLabel('157', 'always', false)).toBe('f. 157');
    expect(formatFolioLabel('fol.3', 'off', true)).toBe('fol.3');
    expect(formatFolioLabel('157', 'off', true)).toBe('157');
  });

  it('writes one spelling and leaves other labels alone', () => {
    expect(formatFolioLabel('f.3', 'auto', true)).toBe('f. 3');
    expect(formatFolioLabel('fol. 3v', 'auto', false)).toBe('f. 3v');
    expect(formatFolioLabel('ff. 3-4', 'auto', true)).toBe('f. 3-4');
    expect(formatFolioLabel('p. 3', 'always', true)).toBe('p. 3');
    expect(formatFolioLabel('Einband', 'always', true)).toBe('Einband');
    expect(formatFolioLabel('  ', 'always', true)).toBe('');
  });

  it('sanitizes the mode', () => {
    expect(sanitizeFolioPrefixMode('always')).toBe('always');
    expect(sanitizeFolioPrefixMode('off')).toBe('off');
    expect(sanitizeFolioPrefixMode(undefined)).toBe('auto');
    expect(sanitizeFolioPrefixMode('nonsense')).toBe('auto');
  });
});
