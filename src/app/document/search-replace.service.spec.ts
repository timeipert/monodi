import { SearchReplaceService, SearchReplaceOptions } from './search-replace.service';
import * as VM from '../types/model';
import { musicLanguage } from '../notes/language';
import { spacedToString } from '../notes/notes.component';

describe('SearchReplaceService', () => {
  let service: SearchReplaceService;
  let sampleRoot: VM.RootContainer;

  beforeEach(() => {
    service = new SearchReplaceService();

    const syl1: VM.Syllable = {
      kind: VM.LinePartKind.Syllable,
      uuid: 'syl-1',
      text: 'Kyrie',
      notes: musicLanguage.Spaced.tryParse('G a b') as VM.Spaced,
      syllableType: VM.SyllableType.Normal
    };

    const syl2: VM.Syllable = {
      kind: VM.LinePartKind.Syllable,
      uuid: 'syl-2',
      text: 'eleison',
      notes: musicLanguage.Spaced.tryParse('c d e') as VM.Spaced,
      syllableType: VM.SyllableType.Normal
    };

    const zeile: VM.ZeileContainer = {
      kind: VM.ContainerKind.ZeileContainer,
      uuid: 'zeile-1',
      children: [syl1, syl2]
    };

    const paratext: VM.ParatextContainer = {
      kind: VM.ContainerKind.ParatextContainer,
      uuid: 'para-1',
      text: 'Introductio ad Kyrie',
      retro: false,
      paratextType: VM.ParatextType.Gesang
    };

    sampleRoot = {
      kind: VM.ContainerKind.RootContainer,
      uuid: 'root-1',
      children: [paratext, zeile],
      comments: [],
      documentType: VM.DocumentType.Level0
    };
  });

  it('finds matches in syllables only', () => {
    const opts: SearchReplaceOptions = {
      query: 'Kyrie',
      replaceWith: 'Christe',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: true, notes: false, paratext: false }
    };

    const matches = service.findMatches(sampleRoot, opts);
    expect(matches.length).toBe(1);
    expect(matches[0].scope).toBe('syllables');
    expect(matches[0].targetUuid).toBe('syl-1');
  });

  it('finds matches in paratext only', () => {
    const opts: SearchReplaceOptions = {
      query: 'Kyrie',
      replaceWith: 'Christe',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: false, notes: false, paratext: true }
    };

    const matches = service.findMatches(sampleRoot, opts);
    expect(matches.length).toBe(1);
    expect(matches[0].scope).toBe('paratext');
    expect(matches[0].targetUuid).toBe('para-1');
  });

  it('finds matches in both syllables and paratext when combined', () => {
    const opts: SearchReplaceOptions = {
      query: 'Kyrie',
      replaceWith: 'Christe',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: true, notes: false, paratext: true }
    };

    const matches = service.findMatches(sampleRoot, opts);
    expect(matches.length).toBe(2);
  });

  it('finds matches in notes', () => {
    const opts: SearchReplaceOptions = {
      query: 'G a',
      replaceWith: 'a b',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: false, notes: true, paratext: false }
    };

    const matches = service.findMatches(sampleRoot, opts);
    expect(matches.length).toBe(1);
    expect(matches[0].scope).toBe('notes');
    expect(matches[0].targetUuid).toBe('syl-1');
  });

  it('replaces single match in syllable text', () => {
    const opts: SearchReplaceOptions = {
      query: 'Kyrie',
      replaceWith: 'Christe',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: true, notes: false, paratext: false }
    };

    const matches = service.findMatches(sampleRoot, opts);
    const res = service.replaceSingleMatch(sampleRoot, matches[0], 'Christe');
    expect(res.success).toBeTrue();

    const syl = (sampleRoot.children[1] as VM.ZeileContainer).children[0] as VM.Syllable;
    expect(syl.text).toBe('Christe');
  });

  it('replaces single match in notes with parse validation', () => {
    const opts: SearchReplaceOptions = {
      query: 'G a b',
      replaceWith: 'c d e',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: false, notes: true, paratext: false }
    };

    const matches = service.findMatches(sampleRoot, opts);
    const res = service.replaceSingleMatch(sampleRoot, matches[0], 'c d e');
    expect(res.success).toBeTrue();

    const syl = (sampleRoot.children[1] as VM.ZeileContainer).children[0] as VM.Syllable;
    expect(spacedToString(syl.notes)).toBe('c d e');
  });

  it('returns error when replacement note syntax is invalid', () => {
    const opts: SearchReplaceOptions = {
      query: 'G a b',
      replaceWith: 'INVALID_NOTES',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: false, notes: true, paratext: false }
    };

    const matches = service.findMatches(sampleRoot, opts);
    const res = service.replaceSingleMatch(sampleRoot, matches[0], 'INVALID_NOTES');
    expect(res.success).toBeFalse();
    expect(res.error).toBeDefined();
  });

  it('replaces all occurrences across combined scopes', () => {
    const opts: SearchReplaceOptions = {
      query: 'Kyrie',
      replaceWith: 'Sanctus',
      matchCase: true,
      matchWholeWord: false,
      scope: { syllables: true, notes: false, paratext: true }
    };

    const result = service.replaceAll(sampleRoot, opts);
    expect(result.replacedCount).toBe(2);

    const para = sampleRoot.children[0] as VM.ParatextContainer;
    expect(para.text).toBe('Introductio ad Sanctus');

    const syl = (sampleRoot.children[1] as VM.ZeileContainer).children[0] as VM.Syllable;
    expect(syl.text).toBe('Sanctus');
  });
});
