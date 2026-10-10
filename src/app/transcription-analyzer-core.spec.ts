import * as VM from './types/model';
import { analyzeDocument, extractPattern, firstNoteUuid, ANALYZER_VERSION } from './transcription-analyzer-core';

/**
 * The analyzer counts ONE pattern per neume (everything written without a gap),
 * like the Neumen-Editor and the Python pipeline before it. The cases below use
 * the same note sequences as the Editor's tests (services/corpus/analysis.test.js
 * in cm-neumen-editor), so the two cannot drift apart unnoticed.
 */

const note = (base: string, octave: number, extra: any = {}): VM.Note => ({
  uuid: `${base}${octave}`, base, octave, noteType: VM.NoteType.Normal, liquescent: false, focus: false, ...extra
} as VM.Note);
const group = (...notes: VM.Note[]): VM.Grouped => ({ grouped: notes });
const neume = (...groups: VM.Grouped[]): VM.NonSpaced => ({ nonSpaced: groups });

const syllable = (text: string, ...neumes: VM.NonSpaced[]): any => ({
  kind: VM.LinePartKind.Syllable, uuid: text, text, syllableType: VM.SyllableType.Normal,
  notes: { spaced: neumes }
});
const root = (...children: any[]): any => ({ kind: VM.ContainerKind.RootContainer, uuid: 'r', children });

describe('transcription analyzer', () => {
  it('is version 2: one pattern per neume', () => {
    expect(ANALYZER_VERSION).toBe(2);
  });

  describe('extractPattern', () => {
    it('reads single notes and directions', () => {
      expect(extractPattern(neume(group(note('G', 4))))).toBe('*');
      expect(extractPattern(neume(group(note('G', 4)), group(note('A', 4))))).toBe('*u');
      expect(extractPattern(neume(group(note('G', 4)), group(note('F', 4)), group(note('F', 4))))).toBe('*de');
    });

    it('brackets a ligature, and reads on across groups', () => {
      expect(extractPattern(neume(group(note('G', 4), note('A', 4)), group(note('G', 4)), group(note('F', 4))))).toBe('[*u]dd');
    });

    it('marks note shapes', () => {
      expect(extractPattern(neume(group(note('G', 4)), group(note('A', 4, { noteType: VM.NoteType.Liquescent }))))).toBe('*uL');
      expect(extractPattern(neume(group(note('G', 4, { noteType: VM.NoteType.Oriscus }))))).toBe('*O');
    });

    it('skips an empty group instead of losing the start of the neume', () => {
      expect(extractPattern(neume(group(), group(note('G', 4)), group(note('A', 4))))).toBe('*u');
    });

    it('says nothing for an empty neume', () => {
      expect(extractPattern(neume())).toBe('');
      expect(extractPattern(undefined as any)).toBe('');
    });
  });

  describe('firstNoteUuid', () => {
    it('is the uuid of the first note of the first group', () => {
      expect(firstNoteUuid(neume(group(note('G', 4), note('A', 4)), group(note('F', 4))))).toBe('G4');
    });
    it('is empty when no note has one', () => {
      expect(firstNoteUuid(neume(group({ base: 'G', octave: 4 } as any)))).toBe('');
      expect(firstNoteUuid(neume())).toBe('');
    });
  });

  describe('analyzeDocument', () => {
    it('reports a multi-group neume once, not once per group', () => {
      const out = analyzeDocument(
        root(syllable('Pa-', neume(group(note('G', 4), note('A', 4)), group(note('G', 4)), group(note('F', 4))))),
        'Aa 1', 'D1'
      );
      expect(out.length).toBe(1);
      expect(out[0]).toEqual(jasmine.objectContaining({
        patternId: '[*u]dd', notesCount: 4, uuid: 'G4', documentId: 'D1', sourceId: 'Aa 1', syllable: 'Pa-'
      }));
    });

    it('reports each neume of a syllable separately', () => {
      const out = analyzeDocument(
        root(syllable('ter', neume(group(note('G', 4))), neume(group(note('A', 4)), group(note('G', 4))))),
        'Aa 1', 'D1'
      );
      expect(out.map(p => p.patternId)).toEqual(['*', '*d']);
      expect(out.map(p => p.uuid)).toEqual(['G4', 'A4']);
    });

    it('follows folio and line changes', () => {
      const out = analyzeDocument(
        root(
          { kind: VM.LinePartKind.FolioChange, uuid: 'f', text: '10v', focus: false },
          syllable('a', neume(group(note('G', 4)))),
          { kind: VM.LinePartKind.LineChange, uuid: 'l', focus: false },
          syllable('b', neume(group(note('A', 4))))
        ),
        'Aa 1', 'D1'
      );
      expect(out.map(p => [p.folio, p.line])).toEqual([['10v', '1'], ['10v', '2']]);
    });

    it('leaves out syllables that are not normal text', () => {
      const s = syllable('x', neume(group(note('G', 4))));
      s.syllableType = VM.SyllableType.EditorialEllipsis;
      expect(analyzeDocument(root(s), 'Aa 1', 'D1')).toEqual([]);
    });
  });
});
