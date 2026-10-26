import { emitMei } from './mei-emitter';
import { defaultMeiProfile } from './mei-mapping.model';
import {
  emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, emptySyllable,
  DocumentType, BaseNote, NoteType
} from '../types/model';

/** Structure of the MEI body: the default is kept, the schema-conformant structure is opt-in (profile.schemaConformant). */
describe('MEI body structure', () => {
  function note(uuid: string, noteType: NoteType = NoteType.Normal, liquescent = false): any {
    return { uuid, base: BaseNote.G, octave: 4, noteType, liquescent, focus: false };
  }

  function build(conformant: boolean, notes: any[], units?: any[][]): Document {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile1 = emptyZeileContainer(1);
    const zeile2 = emptyZeileContainer(2);
    const syl1 = emptySyllable(1);
    syl1.text = 'A';
    syl1.notes = { spaced: (units ?? [notes]).map(g => ({ nonSpaced: [{ grouped: g }] })) } as any;
    const syl2 = emptySyllable(2);
    syl2.text = 'B';
    syl2.notes = { spaced: [{ nonSpaced: [{ grouped: [note('n9')] }] }] } as any;
    zeile1.children = [syl1];
    zeile2.children = [syl2];
    formteil.children = [zeile1, zeile2];
    root.children = [formteil];
    const profile = defaultMeiProfile();
    profile.schemaConformant = conformant;
    return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
  }

  const names = (e: Element | null) => Array.from(e?.children ?? []).map(c => c.localName);

  it('by default keeps the structure of earlier exports: the line break sits in the layer, an oriscus replaces its nc', () => {
    const d = build(false, [note('n1', NoteType.Oriscus)]);
    expect(d.querySelector('layer > sb')).not.toBeNull();
    expect(d.querySelector('neume > oriscus')).not.toBeNull();
    expect(d.querySelector('nc > oriscus')).toBeNull();
  });

  it('conformant: each line is a staff of its own, announced by an sb in the section', () => {
    const d = build(true, [note('n1')]);
    const section = d.querySelector('section > section')!;
    expect(names(section)).toEqual(['sb', 'staff', 'sb', 'staff']);
    expect(d.querySelector('layer > sb')).toBeNull();
    expect(d.querySelectorAll('staff > layer > syllable').length).toBe(2);
  });

  it('conformant: oriscus, quilisma, strophicus and liquescent are empty children of an nc that keeps pitch and octave', () => {
    const d = build(true, [note('n1', NoteType.Oriscus), note('n2', NoteType.Quilisma), note('n3', NoteType.Strophicus), note('n4', NoteType.Normal, true)]);
    const ncs = Array.from(d.querySelectorAll('neume > nc'));
    expect(ncs.length).toBe(5);       // four notes of the first line and one of the second
    expect(names(ncs[0])).toEqual(['oriscus']);
    expect(names(ncs[1])).toEqual(['quilisma']);
    expect(names(ncs[2])).toEqual(['strophicus']);
    expect(names(ncs[3])).toEqual(['liquescent']);
    expect(ncs[0].getAttribute('pname')).toBe('g');
    expect(ncs[0].getAttribute('oct')).toBe('4');
    expect(ncs[3].hasAttribute('curve')).toBeFalse();
    expect(d.querySelector('neume > oriscus, neume > liquescent, neume > quilisma, neume > strophicus')).toBeNull();
    expect(Array.from(d.querySelectorAll('oriscus, quilisma, strophicus, liquescent')).every(e => e.children.length === 0)).toBeTrue();
  });

  it('conformant: a note with a type and the liquescent flag carries both ornaments', () => {
    const d = build(true, [note('n1', NoteType.Oriscus, true)]);
    expect(names(d.querySelector('neume > nc'))).toEqual(['oriscus', 'liquescent']);
  });

  it('conformant: no xml:id occurs twice', () => {
    const d = build(true, [note('n1', NoteType.Oriscus), note('n2')]);
    const ids = Array.from(d.querySelectorAll('[*|id]')).map(e => e.getAttribute('xml:id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('conformant: an accidental is an accid of the syllable at its place in the sequence of neumes, not an nc', () => {
    const d = build(true, [], [[note('n1')], [note('f1', NoteType.Flat)], [note('n2')]]);
    const syllable = d.querySelector('syllable')!;
    expect(names(syllable)).toEqual(['syl', 'neume', 'accid', 'neume']);       // the unit with only the flat is no neume
    const accid = syllable.querySelector('accid')!;
    expect(accid.getAttribute('accid')).toBe('f');
    expect(accid.getAttribute('ploc')).toBe('g');
    expect(accid.getAttribute('oloc')).toBe('4');
    expect(syllable.querySelectorAll('nc').length).toBe(2);                    // the flat adds no pitch to the melody
  });

  it('conformant: natural and sharp become accid="n" and accid="s"; an accidental first in a unit stands before its neume', () => {
    const d = build(true, [], [[note('s1', NoteType.Sharp), note('n1')], [note('t1', NoteType.Natural)]]);
    const syllable = d.querySelector('syllable')!;
    expect(names(syllable)).toEqual(['syl', 'accid', 'neume', 'accid']);
    expect(Array.from(syllable.querySelectorAll('accid')).map(a => a.getAttribute('accid'))).toEqual(['s', 'n']);
  });

  it('by default an accidental stays an nc, as in earlier exports', () => {
    const d = build(false, [], [[note('f1', NoteType.Flat)]]);
    expect(d.querySelector('accid')).toBeNull();
    expect(d.querySelectorAll('syllable neume nc').length).toBe(2);            // the flat and the note of the second line's syllable
  });

  it('conformant: a note head with a stem up or down gets nc/@tilt n or s; no liquescent is claimed', () => {
    const d = build(true, [note('a1', NoteType.Ascending), note('d1', NoteType.Descending), note('n1')]);
    const ncs = Array.from(d.querySelectorAll('neume > nc'));
    expect(ncs.slice(0, 3).map(n => n.getAttribute('tilt'))).toEqual(['n', 's', null]);
    expect(d.querySelector('liquescent')).toBeNull();
  });

  it('conformant: a change of manuscript page is a pb with the folio in @label (and @n if it is one token), in the layer at its place; by default it is not written', () => {
    const make = (conformant: boolean): Document => {
      const root = emptyRootContainer();
      const formteil = emptyFormteilContainer(DocumentType.Level1, []);
      const zeile = emptyZeileContainer(1);
      const syl = emptySyllable(1);
      syl.text = 'A';
      syl.notes = { spaced: [{ nonSpaced: [{ grouped: [note('n1')] }] }] } as any;
      zeile.children = [syl, { uuid: 'fc1', kind: 'FolioChange', focus: false, text: '108' } as any, { uuid: 'fc1', kind: 'FolioChange', focus: false, text: 'f. 109' } as any, emptySyllable(2)];
      formteil.children = [zeile];
      root.children = [formteil];
      const profile = defaultMeiProfile();
      profile.schemaConformant = conformant;
      return new DOMParser().parseFromString(emitMei(root, profile), 'application/xml');
    };
    const on = make(true);
    expect(names(on.querySelector('layer')!)).toEqual(['syllable', 'pb', 'pb', 'syllable']);
    const pbs = Array.from(on.querySelectorAll('layer > pb'));
    expect(pbs.map(p => p.getAttribute('label'))).toEqual(['108', 'f. 109']);
    expect(pbs.map(p => p.getAttribute('n'))).toEqual(['108', null]);           // "f. 109" has a space: not a valid @n
    expect(new Set(pbs.map(p => p.getAttribute('xml:id'))).size).toBe(2);       // a repeated uuid in the data still gives unique ids
    expect(make(false).querySelector('pb')).toBeNull();
  });
});
