import { defaultMeiProfile, emitMei, MEI_PRESETS } from '@monodi/core/mei';
import { importMei, detectMeiFormat } from './mei-import';
import { TRIAL_NEUMES_XML, TRIAL_PREMENSURAL_XML } from './mei-trial-files';
import {
  BaseNote, ContainerKind, DocumentType, LinePartKind, NoteType, SyllableType,
  emptyFormteilContainer, emptyRootContainer, emptyZeileContainer
} from '../types/model';
import type { FormteilContainer, Syllable, ZeileContainer } from '../types/model';

/**
 * The import reads the two trial files of a colleague (the same five syllables in two voices, once as neume and once as premensural
 * notation) and the output of the two export presets back into a Monodi document.
 */
describe('MEI import', () => {
  /** The notes of a voice of a syllable as text: pitch letter, octave and the hand-set `name`: `F5 virga, E5 punctum`. */
  const voiceText = (s: Syllable, voice: number) =>
    (voice === 0 ? s.notes : s.additionalMelodies![voice - 1]).spaced
      .map(n => n.nonSpaced.map(g => g.grouped.map(x => x.base + x.octave + (x.meiAttrs?.['name'] ? ' ' + x.meiAttrs['name'] : '')).join(', ')).join(' | '))
      .join(' / ');
  const linesOf = (r: { root: any }): ZeileContainer[] => (r.root.children[0] as FormteilContainer).children as ZeileContainer[];
  const syllablesOf = (r: { root: any }): Syllable[] => linesOf(r)[0].children as Syllable[];

  const EXPECTED_VOICE_1 = ['F5 virga, E5 punctum, D5 punctum', 'C5 virga', 'C5 punctum', 'A4 punctum, A4 virga', 'A4 virga'];
  const EXPECTED_VOICE_2 = ['F4, G4', 'A4 virga', 'A4 punctum', 'A4 punctum', 'A4 punctum'];

  it('reads the neume trial file: five syllables with the text of the last voice, two voices, labels', () => {
    const r = importMei(TRIAL_NEUMES_XML);
    expect(r.format).toBe('neume');
    expect(r.title).toBe('trial');
    expect(r.voiceLabels).toEqual(['iii [triplum]', '[duplum]']);
    expect(linesOf(r).length).toBe(1);
    const syllables = syllablesOf(r);
    expect(syllables.map(s => s.text)).toEqual(['Mi-', 'ro', 'ge', 'ne', 're']);
    expect(syllables.map(s => voiceText(s, 0))).toEqual(EXPECTED_VOICE_1);
    expect(syllables.map(s => voiceText(s, 1))).toEqual(EXPECTED_VOICE_2);
    expect(r.warnings).toEqual([]);
  });

  it('reads the premensural trial file: the same content, ligatures as neumes, hand-set lig kept', () => {
    const r = importMei(TRIAL_PREMENSURAL_XML);
    expect(r.format).toBe('premensural');
    const syllables = syllablesOf(r);
    expect(syllables.map(s => s.text)).toEqual(['Mi-', 'ro', 'ge', 'ne', 're']);
    // the notes of the ligatures carry no name in this file, so only the single notes show one
    expect(syllables.map(s => voiceText(s, 0).replace(/ (virga|punctum)/g, '')))
      .toEqual(EXPECTED_VOICE_1.map(t => t.replace(/ (virga|punctum)/g, '')));
    expect(syllables.map(s => voiceText(s, 1).replace(/ (virga|punctum)/g, '')))
      .toEqual(EXPECTED_VOICE_2.map(t => t.replace(/ (virga|punctum)/g, '')));
    expect(syllables[0].notes.spaced[0].nonSpaced[0].grouped[1].meiAttrs).toEqual({ lig: 'conjunctura' });
    // the empty <note/> of the second voice is reported, not read as a note
    expect(r.warnings.some(w => w.includes('without pitch'))).toBeTrue();
  });

  it('a ligature is one neume, a single note is a neume of its own', () => {
    const syllables = syllablesOf(importMei(TRIAL_PREMENSURAL_XML));
    expect(syllables[0].notes.spaced.length).toBe(1);
    expect(syllables[0].notes.spaced[0].nonSpaced[0].grouped.length).toBe(3);
    expect(syllables[1].notes.spaced[0].nonSpaced[0].grouped.length).toBe(1);
  });

  it('recognizes the notation from the staves and lets the caller override it', () => {
    expect(detectMeiFormat(new DOMParser().parseFromString(TRIAL_NEUMES_XML, 'application/xml'))).toBe('neume');
    expect(detectMeiFormat(new DOMParser().parseFromString(TRIAL_PREMENSURAL_XML, 'application/xml'))).toBe('premensural');
    const forced = importMei(TRIAL_NEUMES_XML, 'premensural');
    expect(forced.format).toBe('premensural');
    expect(forced.warnings.some(w => w.includes('looks like neume'))).toBeTrue();
  });

  it('rejects text that is not MEI', () => {
    expect(() => importMei('<a><b>')).toThrowError(/well-formed/);
    expect(() => importMei('<root/>')).toThrowError(/not an MEI file/);
    expect(() => importMei('<mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score/></mdiv></body></music></mei>')).toThrowError(/no <staff>/);
  });

  for (const [id, trial] of [['neumes-staves', TRIAL_NEUMES_XML], ['premensural-staves', TRIAL_PREMENSURAL_XML]] as const) {
    it(`round trip with the ${id} preset: import, export, import gives the same syllables, notes and attributes`, () => {
      const first = importMei(trial);
      const profile = MEI_PRESETS.find(p => p.id === id)!.build();
      profile.voiceLabels = first.voiceLabels;
      const second = importMei(emitMei(first.root, profile));
      const plain = (r: ReturnType<typeof importMei>) => syllablesOf(r).map(s => ({
        text: s.text,
        voices: [0, 1].map(v => (v === 0 ? s.notes : s.additionalMelodies![0]).spaced.map(n => n.nonSpaced.map(g => g.grouped.map(x => [x.base, x.octave, x.meiAttrs ?? null])))),
      }));
      expect(plain(second)).toEqual(plain(first));
      expect(second.voiceLabels).toEqual(first.voiceLabels);
      expect(second.format).toBe(first.format);
    });
  }

  it('writes a note head with a stem as a plica in premensural notation and as tilt in neume notation, and reads both back', () => {
    const first = importMei(TRIAL_NEUMES_XML);
    const s = syllablesOf(first);
    s[1].notes.spaced[0].nonSpaced[0].grouped[0].noteType = 'Ascending' as any;
    s[2].notes.spaced[0].nonSpaced[0].grouped[0].noteType = 'Descending' as any;
    for (const [id, written] of [['premensural-staves', /<plica dir="up"\/>[\s\S]*<plica dir="down"\/>/], ['neumes-staves', /tilt="n"[\s\S]*tilt="s"/]] as const) {
      const profile = MEI_PRESETS.find(p => p.id === id)!.build();
      const xml = emitMei(first.root, profile);
      expect(xml).toMatch(written);
      if (id === 'premensural-staves') expect(xml).not.toContain('tilt=');
      const back = syllablesOf(importMei(xml));
      expect(back[1].notes.spaced[0].nonSpaced[0].grouped[0].noteType).toBe('Ascending' as any);
      expect(back[2].notes.spaced[0].nonSpaced[0].grouped[0].noteType).toBe('Descending' as any);
      expect(back[1].notes.spaced[0].nonSpaced[0].grouped[0].meiAttrs?.['tilt']).toBeUndefined();
    }
  });

  it('keeps con="l" and con="e" as attributes of the note; con="g" becomes a break between groups', () => {
    const xml = `<mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><scoreDef><staffGrp>
      <staffDef n="1" notationtype="neume" lines="5"/></staffGrp></scoreDef><section>
      <staff n="1"><layer n="1"><syllable><syl>a</syl><neume><nc pname="c" oct="4"/><nc pname="d" oct="4" con="l"/><nc pname="e" oct="4" con="e"/><nc pname="f" oct="4" con="g"/></neume></syllable></layer></staff>
      </section></score></mdiv></body></music></mei>`;
    const groups = syllablesOf(importMei(xml))[0].notes.spaced[0].nonSpaced;
    expect(groups.length).toBe(2);
    expect(groups[0].grouped.map(n => n.meiAttrs?.['con'] ?? null)).toEqual([null, 'l', 'e']);
    expect(groups[1].grouped[0].meiAttrs?.['con']).toBeUndefined();
  });

  it('reads several lines: a new line starts where the staff number is not larger than the one before', () => {
    const xml = `<mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><scoreDef><staffGrp>
      <staffDef n="1" notationtype="neume" lines="5"/></staffGrp></scoreDef><section>
      <staff n="1"><layer n="1"><syllable><syl>a</syl><neume><nc pname="c" oct="4"/></neume></syllable></layer></staff>
      <section><staff n="1"><layer n="1"><syllable><syl>b</syl><neume><nc pname="d" oct="4"/></neume></syllable></layer></staff></section>
      </section></score></mdiv></body></music></mei>`;
    const r = importMei(xml);
    expect(linesOf(r).length).toBe(2);
    expect(linesOf(r).map(z => (z.children[0] as Syllable).text)).toEqual(['a', 'b']);
    expect(linesOf(r)[0].kind).toBe(ContainerKind.ZeileContainer);
  });

  describe('round trip of the default export', () => {
    const note = (uuid: string, base: BaseNote, octave: number, noteType: NoteType = NoteType.Normal, liquescent = false): any =>
      ({ uuid, base, octave, noteType, liquescent, focus: false });
    const neume = (...notes: any[]) => ({ nonSpaced: [{ grouped: notes }] });
    const syllable = (uuid: string, text: string, spaced: any[], extra: any = {}): any =>
      ({ kind: LinePartKind.Syllable, uuid, text, syllableType: SyllableType.Normal, notes: { spaced }, ...extra });

    function richDocument() {
      const root = emptyRootContainer();
      const formteil = emptyFormteilContainer(DocumentType.Level1, []);
      formteil.data = [{ name: 'Signatur' as any, data: 'Ad 1' }];
      const line1 = emptyZeileContainer(2);
      line1.children = [
        { kind: LinePartKind.Clef, uuid: 'c1', focus: false, base: BaseNote.C, octave: 5, shape: 'c' } as any,
        syllable('s1', 'Ky-', [neume(note('n1', BaseNote.G, 4), note('n2', BaseNote.A, 4, NoteType.Ascending), note('n3', BaseNote.B, 4, NoteType.Oriscus))],
                 { additionalMelodies: [{ spaced: [neume(note('v1', BaseNote.C, 4), note('v2', BaseNote.D, 4))] }] }),
        { kind: LinePartKind.LineChange, uuid: 'lc1', focus: false } as any,
        syllable('s2', 'ri-', [neume(note('n4', BaseNote.B, 4, NoteType.Flat), note('n5', BaseNote.C, 5)), neume(note('n6', BaseNote.A, 4, NoteType.Normal, true))]),
        { kind: LinePartKind.FolioChange, uuid: 'fc1', focus: false, text: 'f. 3r' } as any,
        syllable('s3', 'e', [neume(note('n7', BaseNote.G, 4, NoteType.Quilisma))], { meiAttrs: { type: 'first' } })
      ];
      const line2 = emptyZeileContainer(1);
      const virga = { ...note('n8', BaseNote.D, 4), meiAttrs: { tilt: 'ne', name: 'virga' } };
      line2.children = [
        syllable('s4', '...', [], { syllableType: SyllableType.SourceEllipsis }),
        syllable('s5', 'son', [neume(virga, note('n9', BaseNote.D, 4), note('n10', BaseNote.E, 4))])
      ];
      const line3 = emptyZeileContainer(1);
      (line3 as any).notation = 'adiastematic';
      line3.children = [syllable('s6', 'lei', [neume(note('a1', BaseNote.G, 4), note('a2', BaseNote.A, 4), note('a3', BaseNote.G, 4))])];
      formteil.children = [line1, line2, line3];
      root.children = [formteil];
      return root;
    }
    /** The export without ids (they are made of uuids, which the import makes up anew). */
    const stable = (xml: string) => xml.replace(/ xml:id="[^"]*"/g, '').replace(/ (synch|corresp|sameas)="[^"]*"/g, '');

    it('an export read back and exported again gives the same MEI (clef, line and folio change, accidental, strokes, ellipsis, adiastematic line, second voice)', () => {
      const first = emitMei(richDocument(), defaultMeiProfile());
      const result = importMei(first);
      expect(result.warnings).toEqual([]);
      expect(result.stats.lines).toBe(3);
      expect(stable(emitMei(result.root, defaultMeiProfile()))).toBe(stable(first));
    });

    it('carries the details over: text, signature, voices, hand-set attributes, syllable type, adiastematic line', () => {
      const r = importMei(emitMei(richDocument(), defaultMeiProfile()));
      const formteil = r.root.children[0] as FormteilContainer;
      expect((formteil.data as any)[0].data).toBe('Ad 1');
      const [l1, l2, l3] = formteil.children as ZeileContainer[];
      const kinds = l1.children.map(c => c.kind);
      expect(kinds).toEqual([LinePartKind.Clef, LinePartKind.Syllable, LinePartKind.LineChange, LinePartKind.Syllable, LinePartKind.FolioChange, LinePartKind.Syllable]);
      const s1 = l1.children[1] as Syllable;
      expect(s1.notes.spaced[0].nonSpaced[0].grouped.map(n => n.noteType)).toEqual([NoteType.Normal, NoteType.Ascending, NoteType.Oriscus]);
      expect(s1.additionalMelodies![0].spaced[0].nonSpaced[0].grouped.map(n => n.base + n.octave)).toEqual(['C4', 'D4']);
      const s2 = l1.children[3] as Syllable;
      expect(s2.notes.spaced[0].nonSpaced[0].grouped.map(n => n.noteType)).toEqual([NoteType.Flat, NoteType.Normal]);
      expect(s2.notes.spaced[1].nonSpaced[0].grouped[0].liquescent).toBeTrue();
      expect((l1.children[4] as any).text).toBe('f. 3r');
      expect((l1.children[5] as Syllable).meiAttrs).toEqual({ type: 'first' });
      expect((l2.children[0] as Syllable).syllableType).toBe(SyllableType.SourceEllipsis);
      expect(((l2.children[1] as Syllable).notes.spaced[0].nonSpaced[0].grouped[0]).meiAttrs).toEqual({ tilt: 'ne', name: 'virga' });
      expect(l3.notation).toBe('adiastematic');
      expect((l3.children[0] as Syllable).notes.spaced[0].nonSpaced[0].grouped.length).toBe(3);
    });
  });
});
