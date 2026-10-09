import { commentLemma, commentStartIndex } from './comment-lemma';
import { BaseNote, NoteType, Syllable, SyllableType } from './types/model';

const syl = (text: string, noteId: string): Syllable => ({
  uuid: 's-' + noteId, kind: 'Syllable', text, syllableType: SyllableType.Normal,
  notes: { spaced: [{ nonSpaced: [{ grouped: [{ uuid: noteId, noteType: NoteType.Normal, base: BaseNote.C, liquescent: false, octave: 4, focus: false }] }] }] },
} as any);

describe('commentLemma', () => {
  const parts = [syl('Ter-', 'n1'), syl('ri-', 'n2'), syl('bi-', 'n3'), syl('lis', 'n4'), syl('est', 'n5'), syl('<...>', 'n6')];

  it('joins the syllables of a word without hyphens', () => {
    expect(commentLemma(parts, { startUUID: 'n1', endUUID: 'n4' })).toBe('Terribilis');
  });

  it('keeps a space between words and cuts mid-word at both ends', () => {
    expect(commentLemma(parts, { startUUID: 'n3', endUUID: 'n5' })).toBe('bilis est');
  });

  it('works for a single syllable and for an end before the start', () => {
    expect(commentLemma(parts, { startUUID: 'n4', endUUID: 'n4' })).toBe('lis');
    expect(commentLemma(parts, { startUUID: 'n4', endUUID: 'n1' })).toBe('lis');
  });

  it('skips placeholder syllables and returns "" for unknown ids', () => {
    expect(commentLemma(parts, { startUUID: 'n5', endUUID: 'n6' })).toBe('est');
    expect(commentLemma(parts, { startUUID: 'nope', endUUID: 'n1' })).toBe('');
  });

  it('gives the start position for sorting comments in text order', () => {
    expect(commentStartIndex(parts, { startUUID: 'n3' })).toBe(2);
    expect(commentStartIndex(parts, { startUUID: 'n1' })).toBe(0);
    expect(commentStartIndex(parts, { startUUID: 'unknown' })).toBe(Infinity);
  });
});
