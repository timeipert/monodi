import { MEI_PRESETS, applyBodyStructurePreset, emitMei } from '@monodi/core/mei';
import type { MeiMappingProfileV2 } from '@monodi/core/mei';
import { importFormatOptions, importMei, importRequestOf } from './mei-import';
import { trialDocument } from './mei-structure-testdoc';
import {
  BaseNote, DocumentType, LinePartKind, NoteType, SyllableType, emptyFormteilContainer, emptyRootContainer, emptyZeileContainer
} from '../types/model';
import type { FormteilContainer, RootContainer, Syllable, ZeileContainer } from '../types/model';

/**
 * Structures of the MEI body other than the two built-in ones (`MeiBodyStructure`, structure.ts in `@monodi/core/mei`, state
 * 2026-11-05): what the export writes for them, and that the import reads them back when it is given the profile. The output of the
 * two built-in structures is pinned byte for byte in mei-structure-golden.spec.ts.
 */
describe('MEI structure of a profile', () => {
  const preset = (id: string): MeiMappingProfileV2 => MEI_PRESETS.find(p => p.id === id)!.build();
  const NOW = { now: new Date('2026-11-05T12:00:00Z') };
  const emit = (root: RootContainer, profile: MeiMappingProfileV2) => emitMei(root, profile, undefined, undefined, NOW);

  /**
   * One line, one voice: "Ky-" with a flat before a neume of two groups (the third note with a stem up) and a neume of one note,
   * "ri-" with a neume whose second note has a stem down, and "e" with one note.
   */
  function sample(): RootContainer {
    let id = 0;
    const n = (base: BaseNote, octave: number, noteType = NoteType.Normal): any => ({ uuid: 'n' + (++id), base, octave, noteType, liquescent: false, focus: false });
    const syl = (uuid: string, text: string, spaced: any[][][]): any => ({
      kind: LinePartKind.Syllable, uuid, text, syllableType: SyllableType.Normal,
      notes: { spaced: spaced.map(groups => ({ nonSpaced: groups.map(grouped => ({ grouped })) })) }
    });
    const root = emptyRootContainer();
    root.uuid = 'root';
    const part = emptyFormteilContainer(DocumentType.Level1, []);
    part.uuid = 'part';
    part.data = [];
    const line = emptyZeileContainer(1);
    line.uuid = 'line';
    line.children = [
      syl('s1', 'Ky-', [[[n(BaseNote.B, 4, NoteType.Flat), n(BaseNote.G, 4)], [n(BaseNote.A, 4, NoteType.Ascending), n(BaseNote.B, 4)]], [[n(BaseNote.A, 4)]]]),
      syl('s2', 'ri-', [[[n(BaseNote.G, 4), n(BaseNote.A, 4, NoteType.Descending)]]]),
      syl('s3', 'e', [[[n(BaseNote.F, 4)]]])
    ];
    part.children = [line];
    root.children = [part];
    return root;
  }

  /** The syllables of a document as plain data: text, and per voice the neumes, groups and notes (pitch and note type). */
  const plain = (root: RootContainer) => ((root.children[0] as FormteilContainer).children as ZeileContainer[])
    .flatMap(z => z.children.filter(c => c.kind === LinePartKind.Syllable) as Syllable[])
    .map(s => ({
      text: s.text,
      voices: [s.notes, ...(s.additionalMelodies ?? [])].map(v => v.spaced.map(u => u.nonSpaced.map(g => g.grouped.map(x => `${x.base}${x.octave} ${x.noteType}`))))
    }));

  /** Export with the profile and import with the same profile: the syllables, neumes, groups and notes come back. */
  const expectRoundTrip = (root: RootContainer, profile: MeiMappingProfileV2) => {
    const back = importMei(emit(root, profile), profile);
    expect(plain(back.root)).toEqual(plain(root));
    return back;
  };

  const count = (xml: string, element: string) => (xml.match(new RegExp(`<${element}[ >/]`, 'g')) ?? []).length;

  it('the built-in structures read the sample back (the reference for the structures below)', () => {
    for (const id of ['neumes-staves', 'premensural-staves']) expectRoundTrip(sample(), preset(id));
  });

  it('a group element inside the neume: every group of notes written together is an <ncGrp>', () => {
    const p = preset('neumes-staves');
    p.structure!.group = { element: 'ncGrp', mode: 'always', attributes: [{ name: 'n', source: 'field', value: 'index', omitIfEmpty: true }] };
    const xml = emit(sample(), p);
    expect(count(xml, 'ncGrp')).toBe(5);
    expect(xml).toMatch(/<neume[^>]*><ncGrp n="1"><nc [^>]*pname="g"[\s\S]*?<\/ncGrp><ncGrp n="2">/);
    const back = expectRoundTrip(sample(), p);
    expect(back.format).toBe('profile');
  });

  it('a group element only for several notes: a group of one note stays a note of the neume', () => {
    const p = preset('neumes-staves');
    p.structure!.group = { element: 'ncGrp', mode: 'several', attributes: [] };
    const xml = emit(sample(), p);
    // the flat stands before the neume (an accidental is not a note of a group), so the first group of "Ky-" has one note left
    expect(count(xml, 'ncGrp')).toBe(2);
    expectRoundTrip(sample(), p);
  });

  it('element names that MEI does not know are written as given and read back with the profile', () => {
    const p = preset('neumes-staves');
    p.entities.syllable.tag = 'syllaba';
    p.entities.syllableText.tag = 'textus';
    p.entities.neume.tag = 'neuma';
    p.entities.note.tag = 'punctum';
    p.structure!.voice = { staff: 'rigo', layer: 'vox' };
    p.structure!.accid.element = 'signum';
    const xml = emit(sample(), p);
    for (const name of ['syllaba', 'textus', 'neuma', 'punctum', 'rigo', 'vox']) expect(count(xml, name)).toBeGreaterThan(0);
    expect(xml).toMatch(/<signum [^>]*accid="f" ploc="b" oloc="4"\/>/);
    for (const name of ['syllable', 'syl', 'neume', 'nc', 'staff', 'layer', 'accid']) expect(count(xml, name)).toBe(0);
    expectRoundTrip(sample(), p);
    // two voices: the links between the voices use the same names
    expectRoundTrip(trialDocument(), p);
  });

  it('an accidental without ploc is written as described, but the import cannot place it and leaves it out', () => {
    const p = preset('neumes-staves');
    p.structure!.accid.attributes = p.structure!.accid.attributes.filter(a => a.name === 'accid');
    const xml = emit(sample(), p);
    expect(xml).toMatch(/<accid [^>]*accid="f"\/>/);
    expect(xml).not.toContain('ploc=');
    const flats = plain(importMei(xml, p).root).flatMap(s => s.voices[0].flat(2)).filter(t => t.endsWith(NoteType.Flat));
    expect(flats).toEqual([]);
  });

  it('the text after the music of the syllable', () => {
    const p = preset('neumes-staves');
    p.structure!.text.position = 'last';
    const xml = emit(sample(), p);
    expect(xml).toMatch(/<\/neume><syl[^>]*>e<\/syl><\/syllable>/);
    expectRoundTrip(sample(), p);
  });

  it('premensural with the text at the end of the first note of each syllable', () => {
    const p = preset('premensural-staves');
    p.structure!.text = { holder: 'note', position: 'last', wrappers: ['verse'] };
    const xml = emit(sample(), p);
    expect(xml).toMatch(/<ligature[^>]*><note [^>]*pname="g"[^>]*><verse><syl[^>]*>Ky-<\/syl><\/verse><\/note>/);
    expectRoundTrip(sample(), p);
  });

  it('a stem as an attribute of its own, or not written', () => {
    const p = preset('neumes-staves');
    p.structure!.stem = { form: 'attribute', element: '', attribute: 'stem.dir', up: 'up', down: 'down' };
    let xml = emit(sample(), p);
    expect(xml).toContain('stem.dir="up"');
    expect(xml).toContain('stem.dir="down"');
    expect(xml).not.toContain('tilt=');
    expectRoundTrip(sample(), p);

    p.structure!.stem.form = 'none';
    xml = emit(sample(), p);
    expect(xml).not.toContain('stem.dir=');
    expect(xml).not.toContain('tilt=');
    // documented in MEI-EXPORT-STRUCTURE.md: without a stem the import reads the note heads as normal notes
    const types = plain(importMei(xml, p).root).flatMap(s => s.voices[0].flat(2));
    expect(types.some(t => t.endsWith(NoteType.Ascending) || t.endsWith(NoteType.Descending))).toBeFalse();
  });

  it('the staves without @notationtype and a schema URL of its own', () => {
    const p = preset('neumes-staves');
    p.structure!.notationType = '';
    p.structure!.schemaUrl = 'https://example.org/schema/my-mei.rng';
    const xml = emit(sample(), p);
    expect(xml).not.toContain('notationtype=');
    expect(xml).toContain('href="https://example.org/schema/my-mei.rng"');
    expect(xml).not.toContain('mei-Neumes.rng');
  });

  it('the import dialog offers a profile with a structure of its own as a format', () => {
    const own = preset('neumes-staves');
    own.id = 'own';
    own.name = 'Own groups';
    own.structure!.group = { element: 'ncGrp', mode: 'always', attributes: [] };
    const builtIn = applyBodyStructurePreset(preset('neumes-staves'), 'neume');
    builtIn.id = 'built-in';
    const options = importFormatOptions([builtIn, own]);
    expect(options.map(o => o.value)).toEqual(['auto', 'neume', 'premensural', 'profile:own']);
    expect(importRequestOf('profile:own', [builtIn, own])).toBe(own);
    expect(importRequestOf('profile:gone', [builtIn, own])).toBe('auto');
    expect(importRequestOf('premensural', [own])).toBe('premensural');
    const r = importMei(emit(sample(), own), own);
    expect(r.formatLabel).toContain('Own groups');
  });
});
