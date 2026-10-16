import { parseTsv, toTsv } from './grid-clipboard';

describe('grid clipboard (TSV)', () => {
  it('writes tab-separated rows', () => {
    expect(toTsv([['a', 'b'], ['c', '']])).toBe('a\tb\nc\t');
  });

  it('quotes cells with tabs, line breaks and quotes, and round-trips them', () => {
    const m = [['plain', 'tab\there', 'line\nbreak', 'say "hi"', '']];
    expect(parseTsv(toTsv(m))).toEqual(m);
  });

  it('reads what Excel puts on the clipboard (CRLF, trailing line break)', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps empty cells and a single value', () => {
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
    expect(parseTsv('only')).toEqual([['only']]);
    expect(parseTsv('only\n')).toEqual([['only']]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('a\t')).toEqual([['a', '']]);
  });

  it('reads a quoted cell with a doubled quote and a line break inside', () => {
    expect(parseTsv('"a ""b""\nc"\td')).toEqual([['a "b"\nc', 'd']]);
  });

  it('a quote in the middle of a plain cell is just a quote', () => {
    expect(parseTsv('5" nail\tx')).toEqual([['5" nail', 'x']]);
  });
});
