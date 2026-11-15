import type { CantusChant } from '@monodi/core/datasets';
import { cantusNotes, textOnlyRoot } from './repository-documents';

function chant(over: Partial<CantusChant>): CantusChant {
  return {
    cantus_id: '1', folio: '1r', position: '', genre: 'A', office: 'M', feast: '', feast_code: '', mode: '', incipit: '',
    full_text: '', volpiano: '', ref: '1', image: '', db: 'CD', ...over,
  };
}

/** The texts of the syllables of the first line of a document. */
function syllableTexts(root: any): string[] {
  const line = root.children[0].children[0];
  return line.children.filter((c: any) => c.kind === 'Syllable').map((s: any) => s.text);
}

describe('repository-documents', () => {
  it('writes no clef into the data of a Cantus chant, with or without melody (the editor draws the G clef)', () => {
    const hasClef = (root: any) => root.children[0].children.some((line: any) => line.children.some((c: any) => c.kind === 'Clef'));
    expect(hasClef(textOnlyRoot('Hoc corpus'))).toBeFalse();
    expect(hasClef(cantusNotes(chant({ volpiano: '1---f--g', full_text: 'ab cd' }), { alignText: false }).root)).toBeFalse();
    expect(hasClef(cantusNotes(chant({ volpiano: '', incipit: 'Omnibus' }), { alignText: false }).root)).toBeFalse();
  });

  it('splits the text of a chant without melody into syllables and ends every word but its last syllable with a hyphen', () => {
    expect(syllableTexts(textOnlyRoot('Hoc corpus')).join(' ')).toBe('Hoc cor- pus');
  });

  it('keeps letters of every kind and drops digits and punctuation', () => {
    const text = syllableTexts(textOnlyRoot('C\u0153li 12 enarrant*')).join('').replace(/-/g, '');
    expect(text).toBe('C\u0153lienarrant');
  });

  it('makes a document of one empty syllable when there is no text', () => {
    const syllables = syllableTexts(textOnlyRoot(''));
    expect(syllables.length).toBe(1);
  });

  it('uses the incipit when a chant has no full text, and notes when it has a melody', () => {
    const text = chant({ incipit: 'Omnibus se', full_text: '' });
    expect(syllableTexts(cantusNotes(text, { alignText: false }).root).join('')).toContain('Om');
    const withMelody = cantusNotes(chant({ volpiano: '1---f--g', full_text: 'ab cd' }), { alignText: false });
    expect(withMelody.hasMelody).toBeTrue();
    expect(JSON.stringify(withMelody.root)).toContain('"syllableType":"Normal"');
  });
});
