import { emitMei, MEI_PRESETS, MeiMappingProfileV2, defaultMeiProfile, withBuiltInProfiles } from '@monodi/core/mei';
import { emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, DocumentType, BaseNote, NoteType, SyllableType, LinePartKind } from '../types/model';
import { TRIAL_NEUMES_XML, TRIAL_PREMENSURAL_XML } from './mei-trial-files';

/**
 * The two presets of a two-voice case (neume and premensural) are checked against two trial files of a colleague: the same five
 * syllables ("Mi-ro-ge-ne-re") in two voices, once as neume notation and once as premensural notation. One Monodi document (built
 * below) must produce both. The comparison looks at the staves only (not at the header) and ignores ids; a reference (`synch`, `sameas`)
 * counts as the content of the element it points to.
 *
 * Differences between the trial files and the export, handled in `levelTrialFile` (state 2026-11-05):
 *  - neume file: the staves stand in a staffGrp inside a staffGrp (the export writes one group with the bracket).
 *  - premensural file: an empty `<note/>` in the second voice (a placeholder for the second note of the ligature above it); the text of
 *    the fourth syllable stands in the first note of the ligature of voice 1 (elsewhere in the ligature); `synch` points to the first note
 *    of that ligature (elsewhere to the ligature); the notes of the first ligature have no `name`, those of the fourth have one.
 */
describe('MEI presets for two voices', () => {
  /** `attrs`: MEI attributes set by hand on the note (editor, MEI attributes tab), here `name` and `lig`. */
  const note = (uuid: string, base: BaseNote, octave: number, name?: string, lig?: string): any => ({
    uuid, base, octave, noteType: NoteType.Normal, liquescent: false, focus: false,
    ...(name ? { meiAttrs: { name, ...(lig ? { lig } : {}) } } : {})
  });
  const neume = (...notes: any[]) => ({ nonSpaced: [{ grouped: notes }] });
  const syllable = (uuid: string, text: string, voice1: any[], voice2: any[]): any => ({
    kind: LinePartKind.Syllable, uuid, text, syllableType: SyllableType.Normal,
    notes: { spaced: voice1 },
    additionalMelodies: [{ spaced: voice2 }]
  });

  /** `withLig`: the second and third note of the first ligature carry `lig="conjunctura"` (only the premensural file has it). */
  function trialDocument(withLig = false) {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    zeile.children = [
      syllable('s1', 'Mi-', [neume(note('a1', BaseNote.F, 5, 'virga'), note('a2', BaseNote.E, 5, 'punctum', withLig ? 'conjunctura' : undefined), note('a3', BaseNote.D, 5, 'punctum', withLig ? 'conjunctura' : undefined))],
                           [neume(note('b1', BaseNote.F, 4), note('b2', BaseNote.G, 4))]),
      syllable('s2', 'ro', [neume(note('a4', BaseNote.C, 5, 'virga'))], [neume(note('b3', BaseNote.A, 4, 'virga'))]),
      syllable('s3', 'ge', [neume(note('a5', BaseNote.C, 5, 'punctum'))], [neume(note('b4', BaseNote.A, 4, 'punctum'))]),
      syllable('s4', 'ne', [neume(note('a6', BaseNote.A, 4, 'punctum'), note('a7', BaseNote.A, 4, 'virga'))], [neume(note('b5', BaseNote.A, 4, 'punctum'))]),
      syllable('s5', 're', [neume(note('a8', BaseNote.A, 4, 'virga'))], [neume(note('b6', BaseNote.A, 4, 'punctum'))])
    ] as any;
    formteil.children = [zeile];
    root.children = [formteil];
    return root;
  }

  function emitPreset(id: string, tweak: (p: MeiMappingProfileV2) => void = () => {}, withLig = false): Document {
    const profile = MEI_PRESETS.find(p => p.id === id)!.build();
    profile.voiceLabels = ['iii [triplum]', '[duplum]'];
    tweak(profile);
    return new DOMParser().parseFromString(emitMei(trialDocument(withLig), profile), 'application/xml');
  }
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const NS = 'http://www.music-encoding.org/ns/mei';

  /** The content of an element, for a reference to it: text of a `syl`, otherwise the pitches of its notes. */
  function contentOf(el: Element): string {
    if (el.localName === 'syl') return 'syl:' + el.textContent;
    const notes = el.localName === 'note' || el.localName === 'nc' ? [el] : Array.from(el.getElementsByTagNameNS(NS, el.localName === 'ligature' ? 'note' : 'nc'));
    return el.localName + ':' + notes.map(n => (n.getAttribute('pname') ?? '') + (n.getAttribute('oct') ?? '')).join('+');
  }

  /** A comparable text of a subtree: names, attributes (without ids; references resolved), children; comments and white space left out. */
  function canon(el: Element, indent = ''): string {
    const attrs = Array.from(el.attributes)
      .filter(a => a.name !== 'xml:id')
      .map(a => {
        if (['synch', 'sameas', 'corresp'].includes(a.name)) {
          const target = el.ownerDocument.querySelector(`[*|id="${a.value.slice(1)}"]`);
          return `${a.name}=${target ? contentOf(target) : '?' + a.value}`;
        }
        return `${a.name}=${a.value}`;
      })
      .sort();
    const children = Array.from(el.children).map(c => canon(c, indent + '  '));
    const text = el.children.length === 0 ? (el.textContent ?? '').trim() : '';
    return `${indent}<${el.localName} ${attrs.join(' ')}>${text}${children.length ? '\n' + children.join('\n') + '\n' + indent : ''}</>`;
  }

  /** The staves (voices) and the staffDefs of a document, flattened out of their groups, as comparable text. */
  function scoreCanon(d: Document): string {
    const defs = Array.from(d.getElementsByTagNameNS(NS, 'staffDef')).map(e => canon(e));
    const grp = Array.from(d.getElementsByTagNameNS(NS, 'staffGrp')).map(g => g.getAttribute('symbol') ?? '-').filter(s => s !== '-');
    const staves = Array.from(d.getElementsByTagNameNS(NS, 'staff')).map(e => canon(e));
    return [`bracket=${grp.length > 0}`, ...defs, ...staves].join('\n');
  }

  /** Brings the premensural trial file to the form the export writes (see the list of differences above). */
  function levelTrialFile(d: Document, premensural: boolean) {
    if (!premensural) return;
    for (const empty of Array.from(d.getElementsByTagNameNS(NS, 'note')).filter(n => n.attributes.length === 0 && n.children.length === 0)) empty.remove();
    for (const lig of Array.from(d.getElementsByTagNameNS(NS, 'ligature'))) {
      const first = lig.getElementsByTagNameNS(NS, 'note')[0];
      const verse = first && Array.from(first.children).find(c => c.localName === 'verse');
      if (verse) lig.insertBefore(verse, lig.firstChild);
      for (const n of Array.from(lig.getElementsByTagNameNS(NS, 'note'))) n.removeAttribute('name');
      for (const ref of Array.from(d.querySelectorAll('[synch]'))) {
        const target = d.querySelector(`[*|id="${ref.getAttribute('synch')!.slice(1)}"]`);
        if (target && target.parentElement === lig && target === first) {
          if (!lig.getAttribute('xml:id')) lig.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:id', 'lig-fixed');
          ref.setAttribute('synch', '#' + lig.getAttribute('xml:id'));
        }
      }
    }
  }

  it('neume preset writes the first trial file: voices as staves, text in the last voice, sameas, synch', () => {
    const expected = parse(TRIAL_NEUMES_XML);
    const mine = emitPreset('neumes-staves');
    expect(scoreCanon(mine).split('\n')).toEqual(scoreCanon(expected).split('\n'));
  });

  it('premensural preset writes the second trial file: ligature / note / verse, notationtype premensural', () => {
    const expected = parse(TRIAL_PREMENSURAL_XML);
    levelTrialFile(expected, true);
    const mine = emitPreset('premensural-staves', () => {}, true);
    // the notes of a ligature carry no name in the trial file: the comparison leaves them out on both sides
    for (const n of Array.from(mine.querySelectorAll('ligature > note'))) n.removeAttribute('name');
    expect(scoreCanon(mine).split('\n')).toEqual(scoreCanon(expected).split('\n'));
  });

  it('names the schema of the notation in the xml-model lines', () => {
    const profile = MEI_PRESETS.find(p => p.id === 'premensural-staves')!.build();
    expect(emitMei(trialDocument(), profile)).toContain('schema/5.0/mei-Mensural.rng');
    expect(emitMei(trialDocument(), MEI_PRESETS.find(p => p.id === 'neumes-staves')!.build())).toContain('schema/5.0/mei-Neumes.rng');
  });

  it('the settings decide the form: text in the first voice with corresp, labels and bracket off', () => {
    const d = emitPreset('neumes-staves', p => { p.voiceText = 'first'; p.voiceLink = 'corresp'; p.voiceBracket = false; p.voiceLabels = []; p.firstLineBreak = true; p.wordPosition = true; });
    const staves = Array.from(d.getElementsByTagNameNS(NS, 'staff'));
    expect(staves[0].querySelector('syllable > syl')!.textContent).toBe('Mi-');
    expect(staves[0].querySelector('syl')!.getAttribute('wordpos')).toBe('i');
    expect(staves[1].querySelector('syllable')!.getAttribute('corresp')).toBe('#' + staves[0].querySelector('syllable')!.getAttribute('xml:id'));
    expect(staves[1].querySelector('syl')).toBeNull();
    expect(d.querySelector('staffGrp')!.hasAttribute('symbol')).toBeFalse();
    expect(d.querySelector('staffDef > label')).toBeNull();
    expect(d.querySelector('section > section')!.firstElementChild!.localName).toBe('sb');
  });

  it('the neume preset output uses the notationtype of the staves', () => {
    expect(Array.from(emitPreset('neumes-staves').getElementsByTagNameNS(NS, 'staffDef')).map(e => e.getAttribute('notationtype'))).toEqual(['neume', 'neume']);
    expect(Array.from(emitPreset('premensural-staves').getElementsByTagNameNS(NS, 'staffDef')).map(e => e.getAttribute('notationtype'))).toEqual(['premensural', 'premensural']);
  });

  it('the built-in profiles are added to a project without being created first, once, and not again after a deletion', () => {
    const own = defaultMeiProfile();
    const list = withBuiltInProfiles([own]);
    expect(list.map(p => p.id)).toEqual(['default', 'neumes-staves', 'premensural-staves']);
    expect(list[1].presetId).toBe('neumes-staves');
    expect(list[2].notation).toBe('premensural');
    expect(withBuiltInProfiles(list).length).toBe(3);                                           // not added twice
    expect(withBuiltInProfiles([own], ['premensural-staves']).map(p => p.id)).toEqual(['default', 'neumes-staves']);
    const edited = withBuiltInProfiles([own])[1];
    edited.voiceLabels = ['mine'];
    expect(withBuiltInProfiles([own, edited])[1].voiceLabels).toEqual(['mine']);                // a changed one is kept as it is
    const copy = { ...edited, id: 'copy', presetId: undefined };
    expect(withBuiltInProfiles([own, copy]).filter(p => p.presetId === 'neumes-staves').length).toBe(1);
  });
});
