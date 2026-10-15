import { commentLemma, commentStartIndex, firstTreeText, plainMarkup, treeRepeatsLemma, treeStartsWithBracket } from './comment-lemma';
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

  describe('a tree that repeats the lemma', () => {
    const leaf = (content: any): any => ({ kind: 'CommentTreeLeaf', id: Math.random() + '', content });
    const grid = (...rows: any[][]): any => ({ kind: 'CommentTreeGrid', id: 'g', items: rows });
    const text = (t: string) => leaf({ kind: 'Text', content: t });
    const tree = grid([text('((Gratuletur)) (wie ((CT X)))'), leaf({ kind: 'Bracket' }), text('((Gratultur)), aber Notation für 4 Silben.')]);

    it('strips the markup', () => {
      expect(plainMarkup('((Gratuletur)) (wie ((CT X))) [[Pa]] {{x}}')).toBe('Gratuletur (wie CT X) Pa x');
    });

    it('finds the first text cell, also in nested grids', () => {
      expect(firstTreeText(tree)).toBe('((Gratuletur)) (wie ((CT X)))');
      expect(firstTreeText(grid([grid([text('inner')])]))).toBe('inner');
      expect(firstTreeText(grid([leaf({ kind: 'Bracket' })]))).toBe('');
      expect(firstTreeText(undefined)).toBe('');
    });

    it('recognises the lemma at the start of the first cell (case, markup and punctuation ignored)', () => {
      expect(treeRepeatsLemma(tree, 'Gratuletur')).toBeTrue();
      expect(treeRepeatsLemma(tree, 'gratuletur,')).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Gratuletur')]), 'Gratuletur')).toBeTrue();
    });

    it('knows a tree that begins with its bracket', () => {
      expect(treeStartsWithBracket(grid([leaf({ kind: 'Bracket' }), text('korrigiert aus ((uatum))')]))).toBeTrue();
      expect(treeStartsWithBracket(tree)).toBeFalse();
      expect(treeStartsWithBracket(undefined)).toBeFalse();
    });

    it('does not take a longer word, another word or an empty lemma for a repeat', () => {
      expect(treeRepeatsLemma(grid([text('Gratuleturque (wie CT X)')]), 'Gratuletur')).toBeFalse();
      expect(treeRepeatsLemma(grid([text('korrigiert aus uatum')]), 'uatis')).toBeFalse();
      expect(treeRepeatsLemma(tree, '')).toBeFalse();
      expect(treeRepeatsLemma(grid([leaf({ kind: 'Bracket' })]), 'Gratuletur')).toBeFalse();
    });
  });
});

