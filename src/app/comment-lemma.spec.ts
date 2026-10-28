import { commentLemma, commentSignature, commentStartIndex, firstTreeText, isPlaceholderComment, plainMarkup, printableComments, treeRepeatsLemma, treeStartsWithBracket, treeStartsWithTextedNotes } from './comment-lemma';
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

    it('ignores the u/v and i/j spelling of the manuscript', () => {
      expect(treeRepeatsLemma(grid([text('[[<R>esurrexi]]')]), '<R>esvrrexi')).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Iustus')]), 'Justus')).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Vivat')]), 'Viuant')).toBeFalse();
    });

    it('takes a gap as an abbreviation of a longer reading, but only between the same ends', () => {
      const lemma = 'Eructauit cor meum uerbum bonum dico ego opera mea regi';
      expect(treeRepeatsLemma(grid([text('[[Eructauit ... regi]]')]), lemma)).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Eructauit <...> regi')]), lemma)).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Eructauit … regi')]), lemma)).toBeTrue();
      expect(treeRepeatsLemma(grid([text('Eructauit ... dei')]), lemma)).toBeFalse();
      expect(treeRepeatsLemma(grid([text('Exultate ... regi')]), lemma)).toBeFalse();
      expect(treeRepeatsLemma(grid([text('... regi')]), lemma)).toBeFalse();
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

  describe('placeholders and notation entries', () => {
    const leaf = (content: any): any => ({ kind: 'CommentTreeLeaf', id: Math.random() + '', content });
    const grid = (...rows: any[][]): any => ({ kind: 'CommentTreeGrid', id: 'g', items: rows });
    const text = (t: string) => leaf({ kind: 'Text', content: t });
    const zeile = (...texts: string[]): any => ({ kind: 'ZeileContainer', uuid: 'z', children: texts.map((t, i) => ({ kind: 'Syllable', uuid: 'q' + i, text: t, syllableType: 'Normal', notes: { spaced: [] } })) });
    const notes = (...texts: string[]) => leaf({ kind: 'Notes', content: zeile(...texts) });
    const treeComment = (tree: any): any => ({ startUUID: 'a', endUUID: 'b', text: '', tree });

    it('an entry whose whole content is #App / #Lem / #App 2 is a placeholder', () => {
      for (const t of ['#App', '#app', '#Lem', '#App 2', '# App', '((#App))']) {
        expect(isPlaceholderComment(treeComment(text(t)))).withContext(t).toBeTrue();
        expect(isPlaceholderComment({ text: t })).withContext('text ' + t).toBeTrue();
      }
      expect(isPlaceholderComment(treeComment(grid([text('#App'), leaf({ kind: 'Bracket' }), text('#App')])))).toBeTrue();
    });

    it('real content is never a placeholder', () => {
      expect(isPlaceholderComment(treeComment(text('# Apparat Text: Text über Rasur.')))).toBeFalse();
      expect(isPlaceholderComment(treeComment(text('#Applikation')))).toBeFalse();
      expect(isPlaceholderComment(treeComment(grid([text('#App'), leaf({ kind: 'Bracket' }), notes('in')])))).toBeFalse();
      expect(isPlaceholderComment(treeComment(text('korrigiert zu')))).toBeFalse();
      expect(isPlaceholderComment({ text: '', commentType: 'lines', lines: [] })).toBeFalse();
      expect(isPlaceholderComment(treeComment(leaf({ kind: 'Bracket' })))).toBeFalse();   // nothing to say either way: not our business
    });

    it('printableComments leaves the placeholders out and keeps the rest in order', () => {
      const keep = treeComment(text('korrigiert zu'));
      const root: any = { comments: [treeComment(text('#App')), keep, treeComment(text('#Lem'))] };
      expect(printableComments(root)).toEqual([keep]);
      expect(printableComments(null)).toEqual([]);
      expect(printableComments({} as any)).toEqual([]);
    });

    it('a tree that begins with notes that carry the lyric needs no lemma', () => {
      expect(treeStartsWithTextedNotes(grid([notes('do-', 'mi-', 'ne'), leaf({ kind: 'Bracket' }), text('korrigiert zu'), notes('do-')]))).toBeTrue();
      expect(treeStartsWithTextedNotes(grid([notes('', 'X'), leaf({ kind: 'Bracket' }), text('x')]))).toBeFalse();   // no lyric to read the place from
      expect(treeStartsWithTextedNotes(grid([text('Pa 1235'), notes('in')]))).toBeFalse();
      expect(treeStartsWithTextedNotes(undefined)).toBeFalse();
    });
  });
});


describe('commentSignature', () => {
  const zeile = (...ids: string[]) => ({ uuid: 'z' + ids[0], kind: 'ZeileContainer', children: ids.map((id) => syl('x', id)) });
  const formteil = (sig: string | null, ...children: any[]) => ({ uuid: 'f' + sig, kind: 'FormteilContainer', data: sig === null ? [] : [{ name: 'Signatur', data: sig }], children });
  const root: any = { uuid: 'r', kind: 'RootContainer', documentType: 'Level1', children: [
    formteil(null, { kind: 'ParatextContainer', text: 'IN DEDICATIONE' }),
    formteil('18', zeile('n1', 'n2')),
    formteil(' A ', zeile('n3')),
    formteil('', zeile('n4')),
  ] };

  it('is the signature of the section the comment starts in', () => {
    expect(commentSignature(root, { startUUID: 'n1' })).toBe('18');
    expect(commentSignature(root, { startUUID: 'n2' })).toBe('18');
    expect(commentSignature(root, { startUUID: 'n3' })).toBe('A');
  });

  it('is empty for a section without signature and for an unknown start', () => {
    expect(commentSignature(root, { startUUID: 'n4' })).toBe('');
    expect(commentSignature(root, { startUUID: 'nope' })).toBe('');
    expect(commentSignature({ ...root, children: [] }, { startUUID: 'n1' })).toBe('');
  });

  it('puts the signatures of nested sections together: a letter directly behind a number', () => {
    const versicle: any = { ...root, children: [formteil('3', formteil('a', zeile('n7')), formteil('b', zeile('n8')))] };
    expect(commentSignature(versicle, { startUUID: 'n7' })).toBe('3a');
    expect(commentSignature(versicle, { startUUID: 'n8' })).toBe('3b');
    const other: any = { ...root, children: [formteil('B', formteil('3', zeile('n9')))] };
    expect(commentSignature(other, { startUUID: 'n9' })).toBe('B 3');
  });

  it('a section without a signature takes that of the one around it', () => {
    const wrapped: any = { ...root, children: [formteil('2', formteil(null, zeile('n5')))] };
    expect(commentSignature(wrapped, { startUUID: 'n5' })).toBe('2');
  });
});
