import { emitMei, MEI_PRESETS } from '@monodi/core/mei';
import { importMei, detectMeiFormat } from './mei-import';
import { TRIAL_NEUMES_XML, TRIAL_PREMENSURAL_XML } from './mei-trial-files';
import { ContainerKind } from '../types/model';
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
});
