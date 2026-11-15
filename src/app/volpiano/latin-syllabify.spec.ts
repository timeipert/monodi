import {
  syllabifyLatin,
  forceSyllableCount,
  melodyWordSyllableCounts,
  alignTextToMelody,
} from './latin-syllabify';
import { volpianoToRoot } from './volpiano';
import { getSyllables } from '../types/model';

describe('syllabifyLatin', () => {
  it('opens the next syllable with s + p/t after a consonant', () => {
    expect(syllabifyLatin('conspectu')).toEqual(['con', 'spec', 'tu']);
  });

  it('splits single intervocalic consonants onto the next syllable', () => {
    expect(syllabifyLatin('Cibavit')).toEqual(['Ci', 'ba', 'vit']);
  });
  it('splits vowel hiatus', () => {
    expect(syllabifyLatin('eos')).toEqual(['e', 'os']);
  });
  it('returns a single-syllable word unchanged', () => {
    expect(syllabifyLatin('rex')).toEqual(['rex']);
  });
  it('treats the u of qu as a consonant, so no syllable is left without a vowel', () => {
    expect(syllabifyLatin('Quadraginta')).toEqual(['Qua', 'dra', 'gin', 'ta']);
    expect(syllabifyLatin('aqua')).toEqual(['a', 'qua']);
    expect(syllabifyLatin('aliquis')).toEqual(['a', 'li', 'quis']);
    expect(syllabifyLatin('quem')).toEqual(['quem']);
    expect(syllabifyLatin('qui')).toEqual(['qui']);
  });
  it('treats the u of ngu before a vowel as a consonant', () => {
    expect(syllabifyLatin('lingua')).toEqual(['lin', 'gua']);
    expect(syllabifyLatin('sanguis')).toEqual(['san', 'guis']);
  });
  it('gives every syllable of the words of a chant text a vowel', () => {
    const text = 'Quadraginta dies et quadraginta noctes quoniam sequitur aequalis qualiter';
    for (const w of text.split(' ')) for (const syl of syllabifyLatin(w)) expect(/[aeiouy]/i.test(syl)).withContext(`${w}: ${syl}`).toBeTrue();
  });
});

describe('forceSyllableCount', () => {
  it('merges surplus syllables into the last', () => {
    expect(forceSyllableCount(['a', 'b', 'c'], 2)).toEqual(['a', 'bc']);
  });
  it('never cuts a syllable into pieces to reach the target count: the melody syllables left stay without text', () => {
    expect(forceSyllableCount(['abcd'], 2)).toEqual(['abcd', '']);
    expect(forceSyllableCount(['Qua', 'dra'], 4)).toEqual(['Qua', 'dra', '', '']);
  });
  it('pads empty syllables when there is nothing to split', () => {
    expect(forceSyllableCount(['a'], 3)).toEqual(['a', '', '']);
  });
});

describe('melodyWordSyllableCounts', () => {
  it('counts syllables per word, ignoring clef, breaks and barlines', () => {
    // word1: a -- cdc -- d  (3),  word2: dfd (1)
    expect(melodyWordSyllableCounts('1---a--cdc--d---dfd---4')).toEqual([3, 1]);
  });
});

describe('alignTextToMelody', () => {
  it('marks a melody syllable without text with a placeholder that keeps the alignment, and the import reads it as empty', () => {
    // word 1 has four melody syllables for a three-syllable word, word 2 one
    const melody = '1---a--b--c--d---e---4';
    const { text } = alignTextToMelody(melody, 'Domine rex');
    expect(text).toBe('Do mi ne _ rex');
    const root = volpianoToRoot(melody, text, { textMode: 'syllables' }).root;
    expect(getSyllables(root).map((s) => s.text)).toEqual(['Do-', 'mi-', 'ne-', '', 'rex']);
  });

  it('aligns syllabified text 1:1 with the melody and reconstructs hyphens', () => {
    const melody = '1---a--cdc--d---dfd---4';
    const { text, warnings } = alignTextToMelody(melody, 'Cibavit eos');
    expect(warnings).toEqual([]);
    expect(text).toBe('Ci ba vit eos');

    const root = volpianoToRoot(melody, text, { textMode: 'syllables' }).root;
    expect(getSyllables(root).map((s) => s.text)).toEqual(['Ci-', 'ba-', 'vit', 'eos']);
  });
});
