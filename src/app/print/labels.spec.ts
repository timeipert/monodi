import { DEFAULT_LABELS, LABEL_KEYS, printLabels } from './labels';

describe('print labels', () => {
  it('are English until another language is chosen', () => {
    expect(printLabels(undefined)).toEqual(DEFAULT_LABELS.en);
    expect(printLabels({ pdfLanguage: 'xx' })).toEqual(DEFAULT_LABELS.en);
    expect(printLabels({ pdfLanguage: 'de' }).apparatus).toBe('Kritischer Apparat');
  });

  it('can be changed one by one on top of the language; blank means the language\'s word', () => {
    const l = printLabels({ pdfLanguage: 'de', pdfLabels: { notation: ' Notationen ', apparatus: '  ' } });
    expect(l.notation).toBe('Notationen');
    expect(l.apparatus).toBe('Kritischer Apparat');
    expect(l.edition).toBe('Edition');
  });

  it('are the same set in every language, none empty', () => {
    for (const lang of Object.values(DEFAULT_LABELS)) {
      expect(Object.keys(lang).sort()).toEqual([...LABEL_KEYS].sort());
      for (const k of LABEL_KEYS) expect(lang[k].trim()).not.toBe('');
    }
  });
});
