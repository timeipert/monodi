import { MeiAnnotationRule } from './mei-mapping.model';
import { attrRows, selectionAnnotations } from './mei-selection';
import {
  emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, emptySyllable,
  DocumentType, BaseNote, NoteType, RootContainer
} from '../types/model';

describe('MEI tab of the sidebar: annotations of the focused note', () => {
  const note = (uuid: string, extra: object = {}): any =>
    ({ uuid, base: BaseNote.G, octave: 4, noteType: NoteType.Normal, liquescent: false, focus: false, ...extra });

  function oneSyllable(notes: any[]): RootContainer {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syl = emptySyllable(1);
    syl.text = 'Glo';
    syl.notes = { spaced: [{ nonSpaced: [{ grouped: notes }] }] };
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];
    return root;
  }

  const rule = (over: Partial<MeiAnnotationRule>): MeiAnnotationRule =>
    ({ id: 'r', name: 'rule', enabled: true, target: 'nc', match: {}, set: { label: 'x' }, ...over });

  it('shows nothing when no note has the focus', () => {
    expect(selectionAnnotations(oneSyllable([note('n1')]), [])).toBeUndefined();
  });

  it('lists hand-set attributes of the note, its neume and its syllable', () => {
    const root = oneSyllable([note('n1', { focus: true, meiAttrs: { tilt: 'n' }, meiNeumeAttrs: { type: 'pes' } }), note('n2')]);
    (root.children[0] as any).children[0].children[0].meiAttrs = { label: 'intro' };
    const result = selectionAnnotations(root, [])!;
    const by = Object.fromEntries(result.groups.map(g => [g.target, g.rows.map(r => `${r.name}=${r.value}:${r.source}`)]));
    expect(by['nc']).toEqual(['tilt=n:hand']);
    expect(by['neume']).toEqual(['type=pes:hand']);
    expect(by['syllable']).toEqual(['label=intro:hand']);
  });

  it('marks attributes written by a rule and lets the hand-set value win', () => {
    const root = oneSyllable([note('n1', { focus: true, meiAttrs: { label: 'mine' } })]);
    const result = selectionAnnotations(root, [rule({ set: { label: 'x', tilt: 'n' } })])!;
    const rows = result.groups[0].rows;
    expect(rows.find(r => r.name === 'label')).toEqual({ name: 'label', value: 'mine', source: 'hand', overridesRule: 'x' });
    expect(rows.find(r => r.name === 'tilt')).toEqual({ name: 'tilt', value: 'n', source: 'rule' });
  });

  it('sorts hand-set rows before rule rows', () => {
    expect(attrRows({ b: '1' }, { a: '2' }).map(r => r.name)).toEqual(['b', 'a']);
  });
});
