import { MeiAnnotationRule } from './mei-mapping.model';
import { annotatedPlaces, attrRows, groupPlaces, selectionAnnotations } from './mei-selection';
import { getMeiViewPrefs, meiRuleMarks, setMeiRuleMarks, setMeiViewPrefs } from './mei-view-prefs';
import { defaultMeiProfile } from './mei-mapping.model';
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

  it('orders rows from the weakest source to the strongest: generated, rule, hand', () => {
    expect(attrRows({ c: '1' }, { b: '2' }, { a: '3' }).map(r => `${r.name}:${r.source}`)).toEqual(['a:generated', 'b:rule', 'c:hand']);
  });

  it('a stronger source replaces a weaker row and remembers the value it overrides', () => {
    const rows = attrRows({ con: 'l' }, undefined, { con: 'g' });
    expect(rows).toEqual([{ name: 'con', value: 'l', source: 'hand', overridesGenerated: 'g' }]);
  });

  it('lists what the mapping generates: pitch, octave and the connection after a gap between groups', () => {
    const root = oneSyllable([note('n1')]);
    const syl = (root.children[0] as any).children[0].children[0];
    syl.notes = { spaced: [{ nonSpaced: [{ grouped: [note('n1')] }, { grouped: [note('n2', { focus: true, base: BaseNote.A })] }] }] };
    const result = selectionAnnotations(root, [], undefined, defaultMeiProfile())!;
    const nc = result.groups[0].rows.map(r => `${r.name}=${r.value}:${r.source}`);
    expect(nc).toContain('con=g:generated');
    expect(nc).toContain('pname=a:generated');
    expect(nc).toContain('oct=4:generated');
    expect(result.groups[0].rows.every(r => r.source === 'generated')).toBeTrue();
  });

  it('lists every annotated place of the document, by hand and by rule, with a note to jump to', () => {
    const root = oneSyllable([note('n1', { meiAttrs: { tilt: 'n' }, meiNeumeAttrs: { rellen: 'l' } }), note('n2'), note('n3')]);
    (root.children[0] as any).children[0].children[0].meiAttrs = { type: 'intro' };
    const places = annotatedPlaces(root, [rule({ target: 'nc', match: { pitch: 'G4' }, set: { label: 'x' } })]);
    const text = places.map(p => `${p.target}:${p.noteUuid}:${p.names.join('+')}:${p.source}`);
    expect(text).toContain('syllable:n1:type:hand');
    expect(text).toContain('nc:n1:label+tilt:hand');
    expect(text).toContain('nc:n2:label:rule');
    expect(text).toContain('neume:n1:rellen:hand');   // the neume's attributes are held by its first note
    expect(places.every(p => p.syllableText === 'Glo')).toBeTrue();
  });

  it('keeps the display choices in local storage and falls back to the defaults', () => {
    const before = getMeiViewPrefs();
    expect(before.view === 'note' || before.view === 'all').toBeTrue();
    setMeiViewPrefs({ showGenerated: false, markInStaff: false, view: 'all', groupBy: 'annotation' });
    expect(getMeiViewPrefs()).toEqual({ showGenerated: false, markInStaff: false, view: 'all', groupBy: 'annotation' });
    expect(JSON.parse(localStorage.getItem('monodi_mei_view')!).view).toBe('all');
    setMeiViewPrefs({ showGenerated: true, markInStaff: true, view: 'note' });
    expect(getMeiViewPrefs().showGenerated).toBeTrue();
  });

  it('groups the annotated places by annotation, syllable or element', () => {
    const root = oneSyllable([note('n1', { meiAttrs: { tilt: 'n' } }), note('n2', { meiAttrs: { tilt: 'n' } }), note('n3', { meiAttrs: { tilt: 's' } })]);
    (root.children[0] as any).children[0].children[0].meiAttrs = { type: 'intro' };
    const places = annotatedPlaces(root, []);
    const byAnn = groupPlaces(places, 'annotation');
    expect(byAnn.map(g => `${g.detail}:${g.items.length}`)).toEqual(['tilt="n":2', 'type="intro":1', 'tilt="s":1']);   // most frequent first, then document order
    expect(groupPlaces(places, 'syllable').map(g => `${g.label}:${g.items.length}`)).toEqual(['“Glo”:4']);
    expect(groupPlaces(places, 'element').map(g => `${g.label}:${g.items.length}`)).toEqual(['Notes (nc):3', 'Syllables:1']);
    expect(byAnn.every(g => g.source === 'hand')).toBeTrue();
  });

  it('marks of annotation rules are replaced as a whole and only signal a change when they differ', () => {
    setMeiRuleMarks(new Set(['a']), new Set());
    expect(meiRuleMarks.notes.has('a')).toBeTrue();
    const first = meiRuleMarks.notes;
    setMeiRuleMarks(new Set(['a']), new Set());
    expect(meiRuleMarks.notes).toBe(first);
    setMeiRuleMarks(new Set(), new Set());
    expect(meiRuleMarks.notes.size).toBe(0);
  });

  it('shows a flat, sharp or natural as an accid, without a neume group', () => {
    const root = oneSyllable([note('a1', { focus: true, noteType: NoteType.Sharp, meiAttrs: { func: 'caution' } })]);
    const result = selectionAnnotations(root, [], undefined, defaultMeiProfile())!;
    expect(result.groups.map(g => g.element)).toEqual(['accid', 'syllable']);
    expect(result.groups[0].subject).toBe('sharp at G4');
    const rows = result.groups[0].rows.map(r => `${r.name}=${r.value}:${r.source}`);
    expect(rows).toContain('accid=s:generated');
    expect(rows).toContain('func=caution:hand');
    const asNote = selectionAnnotations(root, [], undefined, { ...defaultMeiProfile(), accidentals: 'note' })!;
    expect(asNote.groups.map(g => g.element)).toEqual(['nc', 'neume', 'syllable']);
  });
});
