import {
  ContainerKind,
  DocumentType,
  LinePartKind,
  BaseNote,
  NoteType,
  emptyRootContainer,
  emptyFormteilContainer,
  emptyZeileContainer,
  emptySyllable,
  resolve,
  getContainerChildren,
  getAllCommentableUUIDs,
  getSyllables,
  getAllLineParts,
  getAllLineContainers,
  findContainerByUUID,
  mergeAllLinesPerSection,
  remove,
  comparePositions,
  nextNote,
  previousNote,
  isOfRootContainer,
  isOfComment
} from './model';

describe('Model Pure Functions Characterization Tests', () => {
  let root: any;
  let formteil: any;
  let zeile: any;
  let syllable: any;

  beforeEach(() => {
    root = emptyRootContainer();
    formteil = emptyFormteilContainer(DocumentType.Level1, [0]);
    zeile = emptyZeileContainer(1);
    syllable = emptySyllable(1);
    syllable.text = 'Ky-';
    
    // Setup nested structure: root -> formteil -> zeile -> syllable
    zeile.children = [syllable];
    formteil.children = [zeile];
    root.children = [formteil];
  });

  describe('resolve', () => {
    it('should resolve root when zipper path is empty', () => {
      expect(resolve(root, [])).toBe(root);
    });

    it('should resolve nested containers correctly', () => {
      expect(resolve(root, [0])).toBe(formteil);
      expect(resolve(root, [0, 0])).toBe(zeile);
    });

    it('should return undefined for invalid path indices', () => {
      expect(resolve(root, [99])).toBeUndefined();
      expect(resolve(root, [0, 99])).toBeUndefined();
    });
  });

  describe('getContainerChildren', () => {
    it('should return children array for RootContainer and FormteilContainer', () => {
      expect(getContainerChildren(root)).toEqual([formteil]);
      expect(getContainerChildren(formteil)).toEqual([zeile]);
    });

    it('should return empty array for ZeileContainer children in container tree definition', () => {
      // ZeileContainer has LinePart children (leaf items), so getContainerChildren returns []
      expect(getContainerChildren(zeile)).toEqual([]);
    });
  });

  describe('getAllCommentableUUIDs', () => {
    it('should collect UUIDs for all comments-ready elements in the tree', () => {
      const uuids = getAllCommentableUUIDs(root);
      expect(uuids).toContain(syllable.uuid);
      // It should also contain all note UUIDs inside the syllable
      expect(uuids.length).toBeGreaterThan(1);
    });

    it('should return empty list for empty/leaf containers', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllCommentableUUIDs(emptyRoot)).toEqual([]);
    });
  });

  describe('getSyllables', () => {
    it('should traverse and retrieve all Syllables in a container', () => {
      expect(getSyllables(root)).toEqual([syllable]);
    });

    it('should return empty list if no syllables are present', () => {
      const emptyRoot = emptyRootContainer();
      expect(getSyllables(emptyRoot)).toEqual([]);
    });
  });

  describe('getAllLineParts', () => {
    it('should retrieve all LinePart elements recursively', () => {
      expect(getAllLineParts(root)).toEqual([syllable]);
    });

    it('should return empty list for an empty RootContainer', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllLineParts(emptyRoot)).toEqual([]);
    });
  });

  describe('getAllLineContainers', () => {
    it('should retrieve all ZeileContainers recursively', () => {
      expect(getAllLineContainers(root)).toEqual([zeile]);
    });

    it('should return empty list for an empty RootContainer', () => {
      const emptyRoot = emptyRootContainer();
      expect(getAllLineContainers(emptyRoot)).toEqual([]);
    });
  });

  describe('findContainerByUUID', () => {
    it('should find container by UUID at root level or nested level', () => {
      expect(findContainerByUUID(root, root.uuid)).toBe(root);
      expect(findContainerByUUID(root, formteil.uuid)).toBe(formteil);
      expect(findContainerByUUID(root, 'non-existent-uuid')).toBeUndefined();
    });
  });

  describe('mergeAllLinesPerSection', () => {
    it('should merge all lines within each section together into a single line', () => {
      const section1 = emptyFormteilContainer(DocumentType.Level1, [0]);
      const z1 = emptyZeileContainer(1);
      const s1 = emptySyllable(1); s1.text = 'Ky-';
      z1.children = [s1];

      const z2 = emptyZeileContainer(1);
      const s2 = emptySyllable(1); s2.text = 'ri-';
      z2.children = [s2];

      const z3 = emptyZeileContainer(1);
      const s3 = emptySyllable(1); s3.text = 'e';
      z3.children = [s3];

      section1.children = [z1, z2, z3];

      const section2 = emptyFormteilContainer(DocumentType.Level1, [1]);
      const z4 = emptyZeileContainer(1);
      const s4 = emptySyllable(1); s4.text = 'E-';
      z4.children = [s4];

      const z5 = emptyZeileContainer(1);
      const s5 = emptySyllable(1); s5.text = 'le-';
      z5.children = [s5];

      section2.children = [z4, z5];

      const testRoot = emptyRootContainer();
      testRoot.children = [section1, section2];

      const mergedCount = mergeAllLinesPerSection(testRoot);

      // Total lines removed by merging: (3-1) in sec1 + (2-1) in sec2 = 3
      expect(mergedCount).toBe(3);

      // Section 1 should now have only 1 line with all 3 syllables
      expect(section1.children.length).toBe(1);
      const mergedLine1 = section1.children[0] as any;
      expect(mergedLine1.children.map((c: any) => c.text)).toEqual(['Ky-', 'ri-', 'e']);

      // Section 2 should now have only 1 line with both syllables
      expect(section2.children.length).toBe(1);
      const mergedLine2 = section2.children[0] as any;
      expect(mergedLine2.children.map((c: any) => c.text)).toEqual(['E-', 'le-']);
    });
  });

  describe('remove', () => {

    it('should delete a direct child container in-place', () => {
      remove(root, formteil);
      expect(root.children).toEqual([]);
    });

    it('should delete a nested child container recursively in-place', () => {
      remove(root, zeile);
      expect(formteil.children).toEqual([]);
    });

    it('should do nothing if target container is not found in the hierarchy', () => {
      const dummy = emptyFormteilContainer(DocumentType.Level1, [99]);
      remove(root, dummy);
      expect(root.children).toEqual([formteil]);
      expect(formteil.children).toEqual([zeile]);
    });
  });

  describe('comparePositions', () => {
    it('should return negative value if first note is lower in pitch/octave than the second', () => {
      expect(comparePositions(4, BaseNote.C, 4, BaseNote.D)).toBe(-1);
      expect(comparePositions(3, BaseNote.C, 4, BaseNote.C)).toBe(-7);
    });

    it('should return 0 for identical note pitches and octaves', () => {
      expect(comparePositions(4, BaseNote.E, 4, BaseNote.E)).toBe(0);
    });

    it('should return positive value if first note is higher in pitch/octave than the second', () => {
      expect(comparePositions(4, BaseNote.D, 4, BaseNote.C)).toBe(1);
      expect(comparePositions(5, BaseNote.C, 4, BaseNote.C)).toBe(7);
    });
  });

  describe('nextNote and previousNote', () => {
    it('should calculate the next logical note step within the same octave', () => {
      const start = { octave: 4, base: BaseNote.C, noteType: NoteType.Normal } as any;
      const next = nextNote(start);
      expect(next.base).toBe(BaseNote.D);
      expect(next.octave).toBe(4);
    });

    it('should roll over to next octave when stepping past BaseNote.B', () => {
      const start = { octave: 4, base: BaseNote.B, noteType: NoteType.Normal } as any;
      const next = nextNote(start);
      expect(next.base).toBe(BaseNote.C);
      expect(next.octave).toBe(5);
    });

    it('should calculate the previous logical note step within the same octave', () => {
      const start = { octave: 4, base: BaseNote.D, noteType: NoteType.Normal } as any;
      const prev = previousNote(start);
      expect(prev.base).toBe(BaseNote.C);
      expect(prev.octave).toBe(4);
    });

    it('should roll back to previous octave when stepping below BaseNote.C', () => {
      const start = { octave: 4, base: BaseNote.C, noteType: NoteType.Normal } as any;
      const prev = previousNote(start);
      expect(prev.base).toBe(BaseNote.B);
      expect(prev.octave).toBe(3);
    });
  });

  describe('isOfRootContainer', () => {
    it('should return true for a valid RootContainer', () => {
      expect(isOfRootContainer(root)).toBeTrue();
    });

    it('should return false for valid containers of other types', () => {
      expect(isOfRootContainer(formteil)).toBeFalse();
    });

    it('should throw an error when null or undefined is passed', () => {
      // SURPRISE: isOfRootContainer(null) throws a TypeError because it attempts to read
      // the 'kind' property of null/undefined without checking truthiness first.
      expect(() => isOfRootContainer(null)).toThrow();
      expect(() => isOfRootContainer(undefined)).toThrow();
    });
  });

  describe('isOfComment', () => {
    it('should validate a comment without a category', () => {
      const comment = {
        startUUID: 'u1',
        endUUID: 'u2',
        text: 'Hello test',
        emendation: true
      };
      expect(isOfComment(comment)).toBeTrue();
    });

    it('should validate a comment with a valid category', () => {
      const comment = {
        startUUID: 'u1',
        endUUID: 'u2',
        text: 'Hello test',
        category: 'variant'
      };
      expect(isOfComment(comment)).toBeTrue();
    });

    it('should reject a comment with an invalid category', () => {
      const comment = {
        startUUID: 'u1',
        endUUID: 'u2',
        text: 'Hello test',
        category: 'invalid-category-name'
      };
      expect(isOfComment(comment)).toBeFalse();
    });

    it('should validate a comment with a valid intervention and certainty', () => {
      const comment = {
        startUUID: 'u1',
        endUUID: 'u2',
        text: 'Hello test',
        intervention: 'unclear',
        certainty: 'high'
      };
      expect(isOfComment(comment)).toBeTrue();
      const roundtripped = JSON.parse(JSON.stringify(comment));
      expect(isOfComment(roundtripped)).toBeTrue();
    });

    it('should reject a comment with an invalid intervention', () => {
      const comment = {
        startUUID: 'u1',
        endUUID: 'u2',
        text: 'Hello test',
        intervention: 'invalid-intervention-type'
      };
      expect(isOfComment(comment)).toBeFalse();
    });
  });
});
