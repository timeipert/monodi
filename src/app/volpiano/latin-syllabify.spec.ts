import {
  syllabifyLatin,
  forceSyllableCount,
  melodyWordSyllableCounts,
  alignTextToMelody,
} from './latin-syllabify';
import { volpianoToRoot } from './volpiano';
import { getSyllables } from '../types/model';

describe('syllabifyLatin', () => {
  it('splits single intervocalic consonants onto the next syllable', () => {
    expect(syllabifyLatin('Cibavit')).toEqual(['Ci', 'ba', 'vit']);
  });
  it('splits vowel hiatus', () => {
    expect(syllabifyLatin('eos')).toEqual(['e', 'os']);
  });
  it('returns a single-syllable word unchanged', () => {
    expect(syllabifyLatin('rex')).toEqual(['rex']);
  });
});

describe('forceSyllableCount', () => {
  it('merges surplus syllables into the last', () => {
    expect(forceSyllableCount(['a', 'b', 'c'], 2)).toEqual(['a', 'bc']);
  });
  it('splits to reach the target count', () => {
    expect(forceSyllableCount(['abcd'], 2)).toEqual(['ab', 'cd']);
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
  it('aligns syllabified text 1:1 with the melody and reconstructs hyphens', () => {
    const melody = '1---a--cdc--d---dfd---4';
    const { text, warnings } = alignTextToMelody(melody, 'Cibavit eos');
    expect(warnings).toEqual([]);
    expect(text).toBe('Ci ba vit eos');

    const root = volpianoToRoot(melody, text, { textMode: 'syllables' }).root;
    expect(getSyllables(root).map((s) => s.text)).toEqual(['Ci-', 'ba-', 'vit', 'eos']);
  });
});
