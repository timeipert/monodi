import {
  BaseNote, Comment, ContainerKind, DocumentType, LinePartKind, NoteType, RootContainer, Syllable, SyllableType, allNotes, getSyllables,
} from './types/model';
import {
  DEFAULT_PLACEHOLDER_CONFIG, applyPlaceholderImport, clearLonePlaceholderSyllables, clearLonePlaceholdersEnabled, importPlaceholderCommentsEnabled, placeholderImportEnabled, isPlaceholderNote, parsePlaceholderPitch, parsePlaceholderPitches,
  placeholderCommentsToSyllables, placeholderConfigFromSettings, syllableCommentsToPlaceholders,
} from './placeholder-comments';

const note = (uuid: string, base: BaseNote, octave: number, liquescent = false) =>
  ({ uuid, base, octave, liquescent, noteType: NoteType.Normal, focus: false });

const syl = (uuid: string, text: string, notes: ReturnType<typeof note>[], type = SyllableType.Normal): Syllable => ({
  kind: LinePartKind.Syllable, uuid, text, syllableType: type,
  notes: { spaced: [{ nonSpaced: [{ grouped: notes }] }] },
});

const comment = (startUUID: string, endUUID: string): Comment => ({ startUUID, endUUID, text: 'c' });

const root = (children: any[], comments: Comment[]): RootContainer => ({
  kind: ContainerKind.RootContainer, uuid: 'r', documentType: DocumentType.Level0, comments,
  children: [{ kind: ContainerKind.ZeileContainer, uuid: 'z', children }],
});

describe('placeholder pitches', () => {
  it('parses F3, f[3] and lists', () => {
    expect(parsePlaceholderPitch('F3')).toEqual({ base: BaseNote.F, octave: 3 });
    expect(parsePlaceholderPitch('d[6]')).toEqual({ base: BaseNote.D, octave: 6 });
    expect(parsePlaceholderPitch('H3')).toBeNull();
    expect(parsePlaceholderPitches('F3, D6; x G4').map((p) => p.base + p.octave)).toEqual(['F3', 'D6', 'G4']);
  });

  it('defaults to F3 and D6, any note type', () => {
    expect(isPlaceholderNote(note('a', BaseNote.F, 3, true), DEFAULT_PLACEHOLDER_CONFIG)).toBeTrue();
    expect(isPlaceholderNote(note('a', BaseNote.D, 6), DEFAULT_PLACEHOLDER_CONFIG)).toBeTrue();
    expect(isPlaceholderNote(note('a', BaseNote.F, 4), DEFAULT_PLACEHOLDER_CONFIG)).toBeFalse();
  });

  it('reads the settings, falling back to the defaults; import is opt-out', () => {
    const cfg = placeholderConfigFromSettings({ placeholderNotes: 'G2', placeholderExportNote: 'G2' });
    expect(cfg.pitches).toEqual([{ base: BaseNote.G, octave: 2 }]);
    expect(cfg.exportPitch).toEqual({ base: BaseNote.G, octave: 2 });
    expect(placeholderConfigFromSettings({ placeholderNotes: 'nonsense' }).pitches.length).toBe(2);
    expect(importPlaceholderCommentsEnabled(undefined)).toBeTrue();
    expect(importPlaceholderCommentsEnabled({ importPlaceholderComments: false })).toBeFalse();
  });
});

describe('placeholderCommentsToSyllables (import)', () => {
  it('moves a comment on placeholder notes onto the syllables and clears them', () => {
    const r = root([
      syl('s1', 'Al-', [note('n1', BaseNote.C, 4)]),
      syl('s2', 'le-', [note('n2', BaseNote.F, 3)]),
      syl('s3', 'lu-', [note('n3', BaseNote.D, 6, true)]),
      syl('s4', 'ia', [note('n4', BaseNote.D, 4)]),
    ], [comment('n2', 'n3')]);
    expect(placeholderCommentsToSyllables(r)).toBe(1);
    expect(r.comments[0].startUUID).toBe('s2');
    expect(r.comments[0].endUUID).toBe('s3');
    const [a, b, c, d] = getSyllables(r);
    expect(allNotes(b.notes).length).toBe(0);
    expect(allNotes(c.notes).length).toBe(0);
    expect(b.syllableType).toBe(SyllableType.Normal);   // still a normal syllable, with staff lines
    expect(b.text).toBe('le-');
    expect(allNotes(a.notes).length).toBe(1);
    expect(allNotes(d.notes).length).toBe(1);
  });

  it('moves just the end onto a placeholder syllable after real notes (empty place that the comment ends on)', () => {
    const r = root([
      syl('s1', 'a', [note('n1', BaseNote.C, 4)]),
      syl('s2', 'b', [note('n2', BaseNote.D, 4)]),
      syl('s3', 'c', [note('n3', BaseNote.F, 3)]),
    ], [comment('n1', 'n3')]);
    expect(placeholderCommentsToSyllables(r)).toBe(1);
    expect(r.comments[0].startUUID).toBe('n1');
    expect(r.comments[0].endUUID).toBe('s3');
    const [a, b, c] = getSyllables(r);
    expect(allNotes(a.notes).length).toBe(1);
    expect(allNotes(b.notes).length).toBe(1);
    expect(allNotes(c.notes).length).toBe(0);
    expect(c.syllableType).toBe(SyllableType.Normal);
    expect(c.text).toBe('c');
  });

  it('moves the start as well', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.D, 6)]), syl('s2', 'b', [note('n2', BaseNote.C, 4)])], [comment('n1', 'n2')]);
    expect(placeholderCommentsToSyllables(r)).toBe(1);
    expect(r.comments[0].startUUID).toBe('s1');
    expect(r.comments[0].endUUID).toBe('n2');
  });

  it('does not touch a syllable that mixes a placeholder with a real note', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.F, 3), note('n2', BaseNote.C, 4)])], [comment('n1', 'n1')]);
    expect(placeholderCommentsToSyllables(r)).toBe(0);
    expect(r.comments[0].startUUID).toBe('n1');
  });

  it('leaves placeholders without a comment alone', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.F, 3)])], []);
    expect(placeholderCommentsToSyllables(r)).toBe(0);
    expect(allNotes(getSyllables(r)[0].notes).length).toBe(1);
  });

  it('re-anchors every comment that points at the cleared syllable', () => {
    const r = root([
      syl('s1', 'a', [note('n1', BaseNote.F, 3)]),
      syl('s2', 'b', [note('n2', BaseNote.C, 4)]),
    ], [comment('n1', 'n1'), comment('n1', 'n2')]);
    expect(placeholderCommentsToSyllables(r)).toBe(2);
    expect(r.comments.map((c) => c.startUUID)).toEqual(['s1', 's1']);
    expect(allNotes(getSyllables(r)[0].notes).length).toBe(0);
  });

  it('honours the configured pitches', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.G, 2)])], [comment('n1', 'n1')]);
    expect(placeholderCommentsToSyllables(r)).toBe(0);
    expect(placeholderCommentsToSyllables(r, placeholderConfigFromSettings({ placeholderNotes: 'G2' }))).toBe(1);
    expect(r.comments[0].startUUID).toBe('s1');
  });
});

describe('syllableCommentsToPlaceholders (export)', () => {
  it('leaves a syllable "without staff lines" alone', () => {
    const r = root([syl('s1', 'a', [], SyllableType.WithoutNotes)], [comment('s1', 's1')]);
    const out = syllableCommentsToPlaceholders(r);
    expect(allNotes(getSyllables(out)[0].notes).length).toBe(0);
    expect(out.comments[0].startUUID).toBe('s1');
    expect(getSyllables(out)[0].syllableType).toBe(SyllableType.WithoutNotes);
  });

  it('gives a commented syllable without notes one placeholder note and re-anchors', () => {
    const r = root([
      syl('s1', 'Al-', [note('n1', BaseNote.C, 4)]),
      syl('s2', 'le-', []),
    ], [comment('s2', 's2')]);
    const out = syllableCommentsToPlaceholders(r);
    const s2 = getSyllables(out)[1];
    const ns = allNotes(s2.notes);
    expect(ns.length).toBe(1);
    expect(ns[0].base).toBe(BaseNote.F);
    expect(ns[0].octave).toBe(3);
    expect(s2.syllableType).toBe(SyllableType.Normal);
    expect(out.comments[0].startUUID).toBe(ns[0].uuid);
    expect(out.comments[0].endUUID).toBe(ns[0].uuid);
    // the document itself is unchanged
    expect(allNotes(getSyllables(r)[1].notes).length).toBe(0);
    expect(r.comments[0].startUUID).toBe('s2');
  });

  it('uses the configured note and one note per syllable', () => {
    const r = root([syl('s1', 'a', [])], [comment('s1', 's1'), comment('s1', 's1')]);
    const out = syllableCommentsToPlaceholders(r, placeholderConfigFromSettings({ placeholderExportNote: 'D6' }));
    const ns = allNotes(getSyllables(out)[0].notes);
    expect(ns.length).toBe(1);
    expect(ns[0].octave).toBe(6);
    expect(out.comments[0].startUUID).toBe(out.comments[1].startUUID);
  });

  it('leaves syllables with notes and uncommented syllables alone', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.C, 4)]), syl('s2', 'b', [])], [comment('n1', 'n1')]);
    const out = syllableCommentsToPlaceholders(r);
    expect(allNotes(getSyllables(out)[1].notes).length).toBe(0);
    expect(out.comments[0].startUUID).toBe('n1');
  });

  it('round-trips: export then import gives the syllable comment back', () => {
    const r = root([syl('s1', 'le-', [])], [comment('s1', 's1')]);
    const out = syllableCommentsToPlaceholders(r);
    expect(placeholderCommentsToSyllables(out)).toBe(1);
    expect(out.comments[0].startUUID).toBe('s1');
    expect(getSyllables(out)[0].syllableType).toBe(SyllableType.Normal);
    expect(allNotes(getSyllables(out)[0].notes).length).toBe(0);
  });
});

describe('clearLonePlaceholderSyllables (import)', () => {
  it('empties a syllable that holds only a placeholder, without any comment, and keeps its text and type', () => {
    const r = root([
      syl('s1', 'tes', [note('n1', BaseNote.D, 6)]),
      syl('s2', 'su-', [note('n2', BaseNote.F, 3, true)]),
      syl('s3', 'a', [note('n3', BaseNote.C, 4)]),
    ], []);
    expect(clearLonePlaceholderSyllables(r)).toBe(2);
    const [a, b, c] = getSyllables(r);
    expect(allNotes(a.notes).length).toBe(0);
    expect(allNotes(b.notes).length).toBe(0);
    expect(a.text).toBe('tes');
    expect(a.syllableType).toBe(SyllableType.Normal);
    expect(allNotes(c.notes).length).toBe(1);
  });

  it('leaves F3 and D6 inside a real melody alone: they are the ends of the range and do occur', () => {
    const r = root([syl('s1', 'mo', [note('n1', BaseNote.B, 3), note('n2', BaseNote.F, 3), note('n3', BaseNote.G, 3)])], []);
    expect(clearLonePlaceholderSyllables(r)).toBe(0);
    expect(allNotes(getSyllables(r)[0].notes).length).toBe(3);
  });

  it('leaves a syllable alone whose second voice has real notes', () => {
    const s = syl('s1', 'a', [note('n1', BaseNote.F, 3)]);
    s.additionalMelodies = [{ spaced: [{ nonSpaced: [{ grouped: [note('n2', BaseNote.C, 4)] }] }] }];
    const r = root([s], []);
    expect(clearLonePlaceholderSyllables(r)).toBe(0);
    expect(allNotes(getSyllables(r)[0].notes).length).toBe(1);
  });

  it('empties the second voice too when it holds only placeholders', () => {
    const s = syl('s1', 'a', [note('n1', BaseNote.F, 3)]);
    s.additionalMelodies = [{ spaced: [{ nonSpaced: [{ grouped: [note('n2', BaseNote.D, 6)] }] }] }];
    const r = root([s], []);
    expect(clearLonePlaceholderSyllables(r)).toBe(1);
    const out = getSyllables(r)[0];
    expect(allNotes(out.notes).length).toBe(0);
    expect(allNotes(out.additionalMelodies![0]).length).toBe(0);
  });

  it('moves a comment that sits on a cleared note onto the syllable, so it does not dangle', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.F, 3)]), syl('s2', 'b', [note('n2', BaseNote.C, 4)])], [comment('n1', 'n2')]);
    expect(clearLonePlaceholderSyllables(r)).toBe(1);
    expect(r.comments[0].startUUID).toBe('s1');
    expect(r.comments[0].endUUID).toBe('n2');
  });

  it('honours the configured pitches, does nothing twice, and copes with a document without comments', () => {
    const r = root([syl('s1', 'a', [note('n1', BaseNote.G, 2)])], []);
    expect(clearLonePlaceholderSyllables(r)).toBe(0);
    expect(clearLonePlaceholderSyllables(r, placeholderConfigFromSettings({ placeholderNotes: 'G2' }))).toBe(1);
    expect(clearLonePlaceholderSyllables(r, placeholderConfigFromSettings({ placeholderNotes: 'G2' }))).toBe(0);
    delete (r as any).comments;
    expect(clearLonePlaceholderSyllables(r)).toBe(0);
  });
});

describe('applyPlaceholderImport', () => {
  const doc = () => root([
    syl('s1', 'a', [note('n1', BaseNote.F, 3)]),      // lone, commented
    syl('s2', 'b', [note('n2', BaseNote.D, 6)]),      // lone, no comment
    syl('s3', 'c', [note('n3', BaseNote.C, 4)]),
  ], [comment('n1', 'n3')]);
  const left = (r: RootContainer) => getSyllables(r).map((s) => allNotes(s.notes).length);

  it('does both by default', () => {
    const r = doc();
    expect(applyPlaceholderImport(r)).toEqual({ comments: 1, cleared: 1 });
    expect(left(r)).toEqual([0, 0, 1]);
    expect(r.comments[0].startUUID).toBe('s1');
  });

  it('keeps the lone placeholders when the setting is off, and still moves the comment', () => {
    const r = doc();
    expect(applyPlaceholderImport(r, { clearLonePlaceholders: false })).toEqual({ comments: 1, cleared: 0 });
    expect(left(r)).toEqual([0, 1, 1]);
  });

  it('clears lone placeholders without moving comments when only that is on, and no comment dangles', () => {
    const r = doc();
    expect(applyPlaceholderImport(r, { importPlaceholderComments: false })).toEqual({ comments: 0, cleared: 2 });
    expect(left(r)).toEqual([0, 0, 1]);
    expect(r.comments[0].startUUID).toBe('s1');
  });

  it('does nothing with both off', () => {
    const r = doc();
    const before = JSON.stringify(r);
    expect(applyPlaceholderImport(r, { importPlaceholderComments: false, clearLonePlaceholders: false })).toEqual({ comments: 0, cleared: 0 });
    expect(JSON.stringify(r)).toBe(before);
    expect(placeholderImportEnabled({ importPlaceholderComments: false, clearLonePlaceholders: false })).toBeFalse();
    expect(placeholderImportEnabled(undefined)).toBeTrue();
  });

  it('is on unless switched off', () => {
    expect(clearLonePlaceholdersEnabled(undefined)).toBeTrue();
    expect(clearLonePlaceholdersEnabled({})).toBeTrue();
    expect(clearLonePlaceholdersEnabled({ clearLonePlaceholders: false })).toBeFalse();
  });
});
