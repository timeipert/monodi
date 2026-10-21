import * as VM from './types/model';
import { alignItems, applyLinks, buildIndex, cmFolio, indexDocument, linksToStore, parseSysId, resolveLinks, sysIdOf } from './notation-links';

const note = (base: string, octave: number, uuid: string): VM.Note =>
  ({ uuid, base, octave, noteType: VM.NoteType.Normal, liquescent: false, focus: false } as VM.Note);
const group = (...notes: VM.Note[]): VM.Grouped => ({ grouped: notes });
const neume = (...groups: VM.Grouped[]): VM.NonSpaced => ({ nonSpaced: groups });
const syllable = (text: string, ...neumes: VM.NonSpaced[]): any => ({
  kind: VM.LinePartKind.Syllable, uuid: `syl-${text}`, text, syllableType: VM.SyllableType.Normal, notes: { spaced: neumes }
});
const lineChange = (uuid: string): any => ({ kind: VM.LinePartKind.LineChange, uuid, focus: false });
const folioChange = (text: string): any => ({ kind: VM.LinePartKind.FolioChange, uuid: `fc-${text}`, focus: false, text });
const paratext = (text: string): any => ({ kind: VM.ContainerKind.ParatextContainer, uuid: `p-${text}`, text });
const root = (...children: any[]): any => ({
  kind: VM.ContainerKind.RootContainer, uuid: 'r',
  children: [{ kind: VM.ContainerKind.ZeileContainer, uuid: 'z', children }]
});

// Document "Fx 1-8-4": starts on f. 8, line 4.
//   8r / 4:  et  [D4 F4] (*u)   et  [F4 D4] (*d)          | lc-4
//   8r / 5:  um  [D4] (*)  [D4] (*)  (one syllable, two equal neumes)
//   rubric with one "|": line 6
//   8r / 6:  o   [F4 F4 E4 D4] ([*edd])                    | lc-6
//   f. 8v / 1:  la  [G4] [A4] (*u, two groups)
const doc = root(
  syllable('et', neume(group(note('D', 4, 'd1'), note('F', 4, 'f1')))),
  syllable('et', neume(group(note('F', 4, 'f2'), note('D', 4, 'd2')))),
  lineChange('lc-4'),
  syllable('um', neume(group(note('D', 4, 'd3'))), neume(group(note('D', 4, 'd4')))),
  paratext('VERSUS | x'),
  syllable('o', neume(group(note('F', 4, 'f3'), note('F', 4, 'f4'), note('E', 4, 'e1'), note('D', 4, 'd5')))),
  lineChange('lc-6'),
  folioChange('8v'),
  syllable('la', neume(group(note('G', 4, 'g1')), group(note('A', 4, 'a1')))),
);
const meta = { id: 'doc1', label: 'Fx 1-8-4', foliostart: '8', zeilenstart: '4' };

const region = (id: string, name: string, folioLabel: string, extra: Partial<VM.AnnotationRegion> = {}): VM.AnnotationRegion =>
  ({ id, name, points: '10,30 90,30 90,40 10,40', folio: '', folioLabel, ...extra });
const item = (id: string, regionId: string, pattern: string, x: number, extra: Partial<VM.AnnotationItem> = {}): VM.AnnotationItem =>
  ({ id, regionId, pattern, points: `${x},31 ${x + 4},31 ${x + 4},36 ${x},36`, ...extra });

describe('notation links', () => {
  describe('cmFolio', () => {
    it('writes folios as the Neumen-Editor does', () => {
      expect(cmFolio('8')).toBe('8r');
      expect(cmFolio('008r')).toBe('8r');
      expect(cmFolio('113 verso')).toBe('113v');
      expect(cmFolio('113ra')).toBe('113r');
      expect(cmFolio('(45v)')).toBe('45v');
      expect(cmFolio('')).toBe('');
      expect(cmFolio(undefined)).toBe('');
    });
    it('knows the foliation of Tri 2254', () => {
      expect(cmFolio('340', 'Tri 2254')).toBe('338r');
      expect(cmFolio('300v', 'Tri 2254')).toBe('300v');
      expect(cmFolio('340', 'Aa 13')).toBe('340r');
    });
  });

  describe('indexDocument', () => {
    const neumes = indexDocument(doc, meta);
    it('places each neume by the document\'s start, line changes, rubrics and folio changes', () => {
      expect(neumes.map(n => `${n.folio}/${n.line} ${n.syllable} ${n.pattern} ${n.notes}`)).toEqual([
        '8r/4 et [*u] D4-F4',
        '8r/4 et [*d] F4-D4',
        '8r/5 um * D4',
        '8r/5 um * D4',
        '8r/6 o [*edd] F4-F4-E4-D4',
        '8v/1 la *u G4-A4',
      ]);
    });
    it('gives each neume its first note, all its notes and the LineChange that ends its line', () => {
      expect(neumes[0].uuid).toBe('d1');
      expect(neumes[5].noteUuids).toEqual(['g1', 'a1']);
      expect(neumes.map(n => n.lineUuid)).toEqual(['lc-4', 'lc-4', '', '', 'lc-6', '']);
    });
    it('makes the reference a Neume Viewer snippet carries', () => {
      expect(sysIdOf(neumes[0])).toBe('Fx 1-8-4|8r|4|et|D4-F4');
    });
    it('starts at line 1 of an unknown folio when the document says nothing', () => {
      const n = indexDocument(root(syllable('a', neume(group(note('C', 4, 'c'))))), { id: 'x', label: 'x' });
      expect([n[0].folio, n[0].line]).toEqual(['', 1]);
    });
    it('leaves out syllables that are not sung', () => {
      const s = syllable('…', neume(group(note('C', 4, 'c'))));
      s.syllableType = VM.SyllableType.EditorialEllipsis;
      expect(indexDocument(root(s), meta)).toEqual([]);
    });
  });

  describe('buildIndex', () => {
    const index = buildIndex(indexDocument(doc, meta));
    it('finds a neume by any of its notes, its reference, its pattern and its line', () => {
      expect(index.byNote.get('f1')?.uuid).toBe('d1');
      expect(index.bySysId.get('Fx 1-8-4|8r|5|um|D4')?.length).toBe(2);
      expect(index.byPattern.get('*')?.length).toBe(2);
      expect(index.byLine.get('8r|6')?.uuid).toBe('lc-6');
      expect(index.linesOfFolio.get('8r')).toEqual([4, 5, 6]);
      expect(index.lineByUuid.get('lc-4')?.line).toBe(4);
      expect(index.documents).toBe(1);
    });
  });

  describe('parseSysId', () => {
    it('reads the five parts, a bar in the syllable included', () => {
      expect(parseSysId('Aa 13-8-4|8r|6|et|D4-F4')).toEqual({ doc: 'Aa 13-8-4', folio: '8r', line: 6, syllable: 'et', notes: 'D4-F4' });
      expect(parseSysId('d|8r|6|a|b|D4')?.syllable).toBe('a|b');
      expect(parseSysId('nonsense')).toBeNull();
      expect(parseSysId('d|8r|x|a|D4')).toBeNull();
    });
  });

  describe('resolveLinks', () => {
    const index = buildIndex(indexDocument(doc, meta));

    it('a stored uuid is the neume it is a note of, even a later note', () => {
      const source = { annotationRegions: [region('r4', 'Line 4', '8r')], annotationItems: [item('i1', 'r4', '[*u]', 20, { uuid: 'f1' })] };
      const link = resolveLinks(source, index).snippets.get('i1')!;
      expect(link.kind).toBe('stored');
      expect(link.neume?.uuid).toBe('d1');
      expect(link.patternDiffers).toBe(false);
    });

    it('a stored uuid that no document has is lost', () => {
      const source = { annotationRegions: [region('r4', 'Line 4', '8r')], annotationItems: [item('i1', 'r4', '*u', 20, { uuid: 'gone' })] };
      expect(resolveLinks(source, index).snippets.get('i1')!.kind).toBe('lost');
      // with no transcription loaded nothing can be said
      expect(resolveLinks(source, buildIndex([])).snippets.get('i1')!.kind).toBe('none');
    });

    it('a Neume Viewer reference names its neume; two equal neumes of one syllable are taken in turn', () => {
      const source = {
        annotationRegions: [region('r5', 'Line 5', '8r')],
        annotationItems: [
          item('a', 'r5', '*', 20, { sysId: 'Fx 1-8-4|8r|5|um|D4' }),
          item('b', 'r5', '*', 40, { sysId: 'Fx 1-8-4|8r|5|um|D4' }),
        ],
      };
      const report = resolveLinks(source, index);
      expect(report.snippets.get('a')).toEqual(jasmine.objectContaining({ kind: 'reference', confidence: 'high' }));
      expect(report.snippets.get('a')!.neume!.uuid).toBe('d3');
      expect(report.snippets.get('b')!.neume!.uuid).toBe('d4');
    });

    it('a reference whose line was counted otherwise is still found by document, syllable and notes', () => {
      const source = { annotationRegions: [region('r6', 'Line 6', '8r')], annotationItems: [item('a', 'r6', '[*edd]', 20, { sysId: 'Fx 1-8-4|8|9|o|F4-F4-E4-D4' })] };
      const link = resolveLinks(source, index).snippets.get('a')!;
      expect(link.kind).toBe('reference');
      expect(link.confidence).toBe('medium');
      expect(link.neume!.uuid).toBe('f3');
    });

    it('says when the transcription writes the neume with another code', () => {
      const source = { annotationRegions: [region('r4', 'Line 4', '8r')], annotationItems: [item('a', 'r4', '[*Qu]', 20, { sysId: 'Fx 1-8-4|8r|4|et|D4-F4' })] };
      expect(resolveLinks(source, index).snippets.get('a')!.patternDiffers).toBe(true);
    });

    it('snippets without links are aligned, left to right, with a line of their folio', () => {
      // drawn on "Line 9" (a wrong name): the patterns say it is line 4
      const source = {
        annotationRegions: [region('r', 'Line 9', '008r')],
        annotationItems: [item('right', 'r', '[*d]', 70), item('left', 'r', '[*u]', 20)],
      };
      const report = resolveLinks(source, index);
      expect(report.snippets.get('left')).toEqual(jasmine.objectContaining({ kind: 'position', confidence: 'high' }));
      expect(report.snippets.get('left')!.neume!.uuid).toBe('d1');
      expect(report.snippets.get('right')!.neume!.uuid).toBe('f2');
      expect(report.lines.get('r')).toEqual(jasmine.objectContaining({ kind: 'snippets' }));
      expect(report.lines.get('r')!.line!.uuid).toBe('lc-4');
    });

    it('a clef or a pattern the line does not have is not linked', () => {
      const source = { annotationRegions: [region('r', 'Line 1', '20r')], annotationItems: [item('c', 'r', 'Clef', 20), item('x', 'r', '*uuu', 40)] };
      const report = resolveLinks(source, index);
      expect(report.snippets.get('c')!.kind).toBe('none');
      expect(report.snippets.get('x')!.kind).toBe('none');
      expect(report.lines.get('r')!.kind).toBe('none');
    });

    it('a line region is linked by its lineUUID, else by its snippets, else by its name', () => {
      const source = {
        annotationRegions: [
          region('stored', 'Line 1', '8r', { lineUUID: 'lc-6' }),
          region('lost', 'Line 1', '8r', { lineUUID: 'nope' }),
          region('named', 'Line 5', '8'),
        ],
        annotationItems: [],
      };
      const lines = resolveLinks(source, index).lines;
      expect(lines.get('stored')).toEqual(jasmine.objectContaining({ kind: 'stored' }));
      expect(lines.get('stored')!.line!.line).toBe(6);
      expect(lines.get('lost')!.kind).toBe('lost');
      expect(lines.get('named')).toEqual(jasmine.objectContaining({ kind: 'name' }));
      expect(lines.get('named')!.line!.line).toBe(5);
    });
  });

  describe('applyLinks', () => {
    const index = buildIndex(indexDocument(doc, meta));
    it('stores the worked-out links, never a stored one, and only lines that have a LineChange', () => {
      const source = {
        annotationRegions: [region('r4', 'Line 4', '8r'), region('r5', 'Line 5', '8r')],
        annotationItems: [
          item('a', 'r4', '[*u]', 20, { sysId: 'Fx 1-8-4|8r|4|et|D4-F4' }),
          item('b', 'r4', '[*d]', 60, { uuid: 'mine' }),
          item('c', 'r5', '*', 20, { sysId: 'Fx 1-8-4|8r|5|um|D4' }),
        ],
      };
      const report = resolveLinks(source, index);
      expect(linksToStore(report).items.size).toBe(2);
      expect(applyLinks(source, report)).toEqual({ items: 2, regions: 1 });
      expect(source.annotationItems.map(i => i.uuid)).toEqual(['d1', 'mine', 'd3']);
      expect(source.annotationRegions.map(r => r.lineUUID)).toEqual(['lc-4', undefined]);   // line 5 is ended by no LineChange
      // a second time there is nothing left to store
      expect(applyLinks(source, resolveLinks(source, index))).toEqual({ items: 0, regions: 0 });
    });
  });

  describe('alignItems', () => {
    it('prefers the match whose position agrees when a pattern repeats', () => {
      const a = alignItems([{ id: 'x', pattern: '*', centre: 80 }], [{ pattern: '*' }, { pattern: '*d' }, { pattern: '*' }], { min: 0, max: 100 });
      expect(a.pairs.map(p => p.neume)).toEqual([2]);
    });
  });
});
