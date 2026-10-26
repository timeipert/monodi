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

  function build(conformant: boolean, notes: any[]): Document {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile1 = emptyZeileContainer(1);
    const zeile2 = emptyZeileContainer(2);
    const syl1 = emptySyllable(1);
    syl1.text = 'A';
    syl1.notes = { spaced: [{ nonSpaced: [{ grouped: notes }] }] } as any;
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
});
