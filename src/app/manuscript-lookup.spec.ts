import * as VM from './types/model';
import { findNeume, hasAnnotations, lineUuidOfNote, lookupInManuscript } from './manuscript-lookup';
import { backgroundStyle, boundsOf, cropAspect, imageCropUrl, padRect, toCropSpace } from './iiif-crop';

const note = (base: string, octave: number, uuid = `${base}${octave}`): VM.Note =>
  ({ uuid, base, octave, noteType: VM.NoteType.Normal, liquescent: false, focus: false } as VM.Note);
const group = (...notes: VM.Note[]): VM.Grouped => ({ grouped: notes });
const neume = (...groups: VM.Grouped[]): VM.NonSpaced => ({ nonSpaced: groups });
const syllable = (text: string, ...neumes: VM.NonSpaced[]): any => ({
  kind: VM.LinePartKind.Syllable, uuid: `syl-${text}`, text, syllableType: VM.SyllableType.Normal, notes: { spaced: neumes }
});
const lineChange = (uuid: string): any => ({ kind: VM.LinePartKind.LineChange, uuid, focus: false });
const root = (...children: any[]): any => ({
  kind: VM.ContainerKind.RootContainer, uuid: 'r',
  children: [{ kind: VM.ContainerKind.ZeileContainer, uuid: 'z', children }]
});

// line 1:  Pa-  [G4 A4][G4][F4]  ("[*u]dd")   ter  [G4][A4] ("*u")   | lc-1
// line 2:  no-  [C5]             ("*")        | lc-2
const tree = root(
  syllable('Pa-', neume(group(note('G', 4, 'g1'), note('A', 4, 'a1')), group(note('G', 4, 'g2')), group(note('F', 4, 'f1')))),
  syllable('ter', neume(group(note('G', 4, 'g3')), group(note('A', 4, 'a3')))),
  lineChange('lc-1'),
  syllable('no-', neume(group(note('C', 5, 'c1')))),
  lineChange('lc-2'),
  syllable('last', neume(group(note('D', 5, 'd1'))))
);

const region = (id: string, extra: Partial<VM.AnnotationRegion> = {}): VM.AnnotationRegion =>
  ({ id, name: `Line ${id}`, points: '10,10 90,10 90,20 10,20', folio: '0', ...extra });
const item = (id: string, regionId: string, pattern: string, extra: Partial<VM.AnnotationItem> = {}): VM.AnnotationItem =>
  ({ id, regionId, pattern, points: '20,11 24,11 24,16 20,16', ...extra });

describe('manuscript lookup', () => {
  describe('findNeume', () => {
    it('finds the whole neume of a note, with its pattern and every note uuid', () => {
      expect(findNeume(tree, 'g2')).toEqual({ pattern: '[*u]dd', noteUuids: ['g1', 'a1', 'g2', 'f1'], firstNoteUuid: 'g1' });
      expect(findNeume(tree, 'a3')!.pattern).toBe('*u');
    });
    it('is null for a note that is not in the tree', () => {
      expect(findNeume(tree, 'nope')).toBeNull();
    });
  });

  describe('lineUuidOfNote', () => {
    it('is the LineChange that ends the note\'s line', () => {
      expect(lineUuidOfNote(tree, 'g1')).toBe('lc-1');
      expect(lineUuidOfNote(tree, 'a3')).toBe('lc-1');
      expect(lineUuidOfNote(tree, 'c1')).toBe('lc-2');
    });
    it('is empty for the last line, which no LineChange ends, and for an unknown note', () => {
      expect(lineUuidOfNote(tree, 'd1')).toBe('');
      expect(lineUuidOfNote(tree, 'nope')).toBe('');
    });
  });

  describe('lookupInManuscript', () => {
    it('level A: a snippet linked to a note of the neume, even to a later note of its group', () => {
      const source = {
        annotationRegions: [region('a')],
        annotationItems: [item('i1', 'a', '[*u]dd', { uuid: 'g1' }), item('i2', 'a', '[*u]dd', { variant: 'b' }), item('i3', 'a', '*u')],
        equivalents: [{ pattern: '[*u]dd', refId: '12', notes: 'four notes' }]
      };
      const l = lookupInManuscript(source, tree, 'g2')!;
      expect(l.pattern).toBe('[*u]dd');
      expect(l.refId).toBe('12');
      expect(l.primary!.kind).toBe('exact');
      expect(l.primary!.hits.map(h => h.item!.id)).toEqual(['i1']);
      // the other snippet of the same pattern is an example; the linked one is not repeated there
      expect(l.examples.map(h => [h.item!.id, h.label])).toEqual([['i2', '[*u]dd b']]);
      expect(l.totalExamples).toBe(1);
    });

    it('matches a snippet linked to the first note of a ligature group (the old per-group links)', () => {
      const source = { annotationRegions: [region('a')], annotationItems: [item('i1', 'a', '[*u]dd', { uuid: 'a1' })] };
      expect(lookupInManuscript(source, tree, 'f1')!.primary!.hits[0].item!.id).toBe('i1');
    });

    it('level B: no snippet is linked, but the line is', () => {
      const source = { annotationRegions: [region('a', { lineUUID: 'lc-1' }), region('b', { lineUUID: 'lc-2' })], annotationItems: [] };
      const l = lookupInManuscript(source, tree, 'a3')!;
      expect(l.primary!.kind).toBe('line');
      expect(l.primary!.hits.map(h => h.region.id)).toEqual(['a']);
      expect(l.primary!.hits[0].item).toBeUndefined();
    });

    it('level C only: nothing is linked, examples of the pattern are listed', () => {
      const source = {
        annotationRegions: [region('a')],
        annotationItems: [item('i1', 'a', '*u'), item('i2', 'a', '*u b'), item('i3', 'a', '*d')],
        equivalents: [{ pattern: '*u', refId: '3' }]
      };
      const l = lookupInManuscript(source, tree, 'g3')!;
      expect(l.primary).toBeNull();
      expect(l.refId).toBe('3');
      expect(l.examples.map(h => h.item!.id)).toEqual(['i1', 'i2']);
    });

    it('caps the examples and says how many there are', () => {
      const items = Array.from({ length: 12 }, (_, k) => item(`i${k}`, 'a', '*u'));
      const l = lookupInManuscript({ annotationRegions: [region('a')], annotationItems: items }, tree, 'g3', 5)!;
      expect(l.examples.length).toBe(5);
      expect(l.totalExamples).toBe(12);
    });

    it('ignores snippets whose region is gone, and says nothing when the note is not in a neume', () => {
      const l = lookupInManuscript({ annotationRegions: [], annotationItems: [item('i1', 'ghost', '*u')] }, tree, 'g3')!;
      expect(l.examples).toEqual([]);
      expect(lookupInManuscript({}, tree, 'nope')).toBeNull();
    });

    it('is quiet about a pattern with no Ref-ID', () => {
      expect(lookupInManuscript({ annotationRegions: [], annotationItems: [] }, tree, 'c1')!.refId).toBe('');
    });
  });

  it('hasAnnotations says whether there is anything to show', () => {
    expect(hasAnnotations(null)).toBeFalse();
    expect(hasAnnotations({})).toBeFalse();
    expect(hasAnnotations({ annotationRegions: [region('a')] })).toBeTrue();
  });
});

describe('iiif crop', () => {
  it('bounds a polygon, and refuses one with no area', () => {
    expect(boundsOf('10,20 30,20 30,25 10,25')).toEqual({ x: 10, y: 20, w: 20, h: 5 });
    expect(boundsOf('10,20 30,20')).toBeNull();
    expect(boundsOf('')).toBeNull();
    expect(boundsOf(undefined)).toBeNull();
  });

  it('pads around a rectangle and keeps it on the page', () => {
    const p = padRect({ x: 10, y: 10, w: 10, h: 4 }, 0.5, 1);
    expect(p).toEqual({ x: 5, y: 6, w: 20, h: 12 });
    const edge = padRect({ x: 0, y: 98, w: 4, h: 2 }, 1, 1);
    expect(edge.x).toBeGreaterThanOrEqual(0);
    expect(edge.y + edge.h).toBeLessThanOrEqual(100);
  });

  it('gives a tiny sign a minimum size', () => {
    const p = padRect({ x: 50, y: 50, w: 1, h: 1 }, 0.5, 0.5, 10, 6);
    expect(p.w).toBe(10);
    expect(p.h).toBe(6);
  });

  it('builds an IIIF Image API request for a percent region', () => {
    expect(imageCropUrl('https://img.example/iiif/p1/', { x: 10, y: 20.12345, w: 30, h: 5 }))
      .toBe('https://img.example/iiif/p1/pct:10,20.123,30,5/!900,360/0/default.jpg');
  });

  it('re-expresses a polygon in percent of the crop', () => {
    expect(toCropSpace('20,30 30,30 30,40 20,40', { x: 10, y: 20, w: 40, h: 40 })).toBe('25,25 50,25 50,50 25,50');
    expect(toCropSpace('', { x: 0, y: 0, w: 1, h: 1 })).toBe('');
  });

  it('works out the aspect of a crop from the page size', () => {
    expect(cropAspect({ x: 0, y: 0, w: 50, h: 10 }, 2000, 4000)).toBeCloseTo(2.5);
    expect(cropAspect({ x: 0, y: 0, w: 50, h: 10 })).toBeCloseTo(3.75); // a typical 3:4 page
  });

  it('shows a rectangle of a whole-page image with background size and position', () => {
    expect(backgroundStyle({ x: 20, y: 10, w: 50, h: 20 })).toEqual({ size: '200% 500%', position: '40% 12.5%' });
    expect(backgroundStyle({ x: 0, y: 0, w: 100, h: 100 })).toEqual({ size: '100% 100%', position: '0% 0%' });
  });
});
