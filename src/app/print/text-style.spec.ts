import { capsModeFor, resolveStatusTextStyles, smallCapsRuns, styledLyric } from './text-style';

describe('text style', () => {
  it('changes the case for upper and lower', () => {
    expect(styledLyric('San–', 'uppercase')).toBe('SAN–');
    expect(styledLyric('SAN–', 'lowercase')).toBe('san–');
    expect(styledLyric('San', 'smallcaps')).toBe('San');
    expect(styledLyric('San', undefined)).toBe('San');
  });

  it('keeps only known non-default styles from the settings', () => {
    expect(resolveStatusTextStyles({ 'Entry Mark': 'smallcaps', Refrain: 'none', X: 'bold' })).toEqual({ 'Entry Mark': 'smallcaps' });
    expect(resolveStatusTextStyles(undefined)).toEqual({});
  });

  it('sets all-caps text in small capitals by default, lower-case only on request', () => {
    expect(capsModeFor('SALUS', undefined, '')).toBe('first');
    expect(capsModeFor('LUS', undefined, 'SA–')).toBe('all');
    expect(capsModeFor('Salus', undefined, '')).toBeUndefined();
    expect(capsModeFor('Salus', 'smallcaps', '')).toBe('mixed');
    expect(capsModeFor('SALUS', 'uppercase', '')).toBeUndefined();
    expect(capsModeFor('...', 'smallcaps', '')).toBeUndefined();
  });

  it('keeps capitals full size and makes lower-case letters small capitals', () => {
    expect(smallCapsRuns('Sanctus', 'mixed')).toEqual([{ text: 'S', big: true }, { text: 'ANCTUS', big: false }]);
    expect(smallCapsRuns('ctus–', 'mixed')).toEqual([{ text: 'CTUS–', big: false }]);
    expect(smallCapsRuns('SALUS', 'first')).toEqual([{ text: 'S', big: true }, { text: 'ALUS', big: false }]);
    expect(smallCapsRuns('LUS', 'all')).toEqual([{ text: 'LUS', big: false }]);
  });
});
