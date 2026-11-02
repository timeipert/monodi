import { emitMei } from './mei-emitter';
import { defaultMeiProfile, MeiAnnotationRule } from './mei-mapping.model';
import { previewRule, ruleProblem, setHandAttr } from './mei-annotations';
import {
  emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, emptySyllable,
  DocumentType, BaseNote, NoteType, copyUuids, Spaced, Syllable, RootContainer
} from '../types/model';

describe('MEI annotations', () => {
  const note = (uuid: string, base: BaseNote = BaseNote.G, extra: object = {}): any =>
    ({ uuid, base, octave: 4, noteType: NoteType.Normal, liquescent: false, focus: false, ...extra });

  /** One syllable per entry: text and neumes (each neume a list of groups, each group a list of notes). */
  function build(syllables: { text: string; spaced: any[] }[]): { root: RootContainer; syls: Syllable[] } {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const syls = syllables.map((s, i) => {
      const syl = emptySyllable(i + 1);
      syl.text = s.text;
      syl.notes = { spaced: s.spaced };
      return syl;
    });
    zeile.children = syls;
    formteil.children = [zeile];
    root.children = [formteil];
    return { root, syls };
  }

  function emit(root: RootContainer, rules: MeiAnnotationRule[] = [], sigle?: string): Document {
    // Conformant structure: an oriscus is a child of its <nc> instead of replacing it, so the test can address every note as <nc>.
    const profile = { ...defaultMeiProfile(), annotationRules: rules, schemaConformant: true };
    return new DOMParser().parseFromString(emitMei(root, profile, undefined, sigle), 'application/xml');
  }

  const rule = (over: Partial<MeiAnnotationRule>): MeiAnnotationRule => ({
    id: 'r', name: 'rule', enabled: true, target: 'nc', match: {}, set: { label: 'x' }, ...over
  });

  const twoNotes = () => build([{ text: 'Glo', spaced: [{ nonSpaced: [{ grouped: [note('n1'), note('n2', BaseNote.A)] }] }] }]);

  it('writes attributes set by hand on nc, neume and syllable', () => {
    const { root, syls } = twoNotes();
    const [n1, n2] = syls[0].notes.spaced[0].nonSpaced[0].grouped as any[];
    setHandAttr(n2, 'nc', 'tilt', 's');
    setHandAttr(n1, 'neume', 'rellen', 'above');
    setHandAttr(syls[0], 'syllable', 'type', 'intro');
    const doc = emit(root);
    expect(doc.querySelector('nc[xml\\:id="m-n2"], nc:nth-of-type(2)')!.getAttribute('tilt')).toBe('s');
    expect(doc.querySelector('neume')!.getAttribute('rellen')).toBe('above');
    expect(doc.querySelector('syllable')!.getAttribute('type')).toBe('intro');
  });

  it('setHandAttr clears an attribute with an empty value and drops the empty map', () => {
    const n: any = note('a');
    setHandAttr(n, 'nc', 'tilt', 'n');
    expect(n.meiAttrs).toEqual({ tilt: 'n' });
    setHandAttr(n, 'nc', 'tilt', '');
    expect(n.meiAttrs).toBeUndefined();
  });

  it('a rule on a neume pattern sets attributes on the chosen note only', () => {
    const { root } = twoNotes();
    const doc = emit(root, [rule({
      match: { neume: { text: '[*u]', mode: 'whole', ignoreShapes: true }, position: { which: 'last' } },
      set: { tilt: 'n' }
    })]);
    const ncs = Array.from(doc.querySelectorAll('nc'));
    expect(ncs.map(n => n.getAttribute('tilt'))).toEqual([null, 'n']);
  });

  it('a rule can target the neume or the syllable and match on the syllable text', () => {
    const { root } = build([
      { text: 'Glo-', spaced: [{ nonSpaced: [{ grouped: [note('a')] }] }] },
      { text: 'ri-a', spaced: [{ nonSpaced: [{ grouped: [note('b')] }] }] }
    ]);
    const doc = emit(root, [
      rule({ id: '1', target: 'syllable', match: { syllableText: '^glo' }, set: { type: 'first' } }),
      rule({ id: '2', target: 'neume', match: { syllableText: 'ri' }, set: { rellen: 'below' } })
    ]);
    expect(Array.from(doc.querySelectorAll('syllable')).map(s => s.getAttribute('type'))).toEqual(['first', null]);
    expect(Array.from(doc.querySelectorAll('neume')).map(s => s.getAttribute('rellen'))).toEqual([null, 'below']);
  });

  it('matches on pitch, note type and flag, and fills {pname}, {oct}, {syllable} and {index}', () => {
    const { root } = build([{ text: 'Do', spaced: [{ nonSpaced: [{ grouped: [
      note('a', BaseNote.G), note('b', BaseNote.F, { noteType: NoteType.Oriscus }), note('c', BaseNote.G, { flags: ['V'] })
    ] }] }] }]);
    const doc = emit(root, [
      rule({ id: '1', match: { pitch: '^G4$', flag: 'V' }, set: { label: '{pname}{oct}-{syllable}-{index}' } }),
      rule({ id: '2', match: { noteTypes: ['Oriscus'] }, set: { type: 'o' } })
    ]);
    const ncs = Array.from(doc.querySelectorAll('nc'));
    expect(ncs.map(n => n.getAttribute('label'))).toEqual([null, null, 'g4-Do-3']);
    expect(ncs.map(n => n.getAttribute('type'))).toEqual([null, 'o', null]);
  });

  it('a later rule overrides an earlier one, and an attribute set by hand wins over both', () => {
    const { root, syls } = twoNotes();
    const [n1] = syls[0].notes.spaced[0].nonSpaced[0].grouped as any[];
    setHandAttr(n1, 'nc', 'label', 'by hand');
    const doc = emit(root, [rule({ id: '1', set: { label: 'first', type: 'a' } }), rule({ id: '2', set: { label: 'second' } })]);
    const ncs = Array.from(doc.querySelectorAll('nc'));
    expect(ncs.map(n => n.getAttribute('label'))).toEqual(['by hand', 'second']);
    expect(ncs.map(n => n.getAttribute('type'))).toEqual(['a', 'a']);
  });

  it('applies a rule only to its manuscript, and not when disabled', () => {
    const { root } = twoNotes();
    const r = rule({ sigle: 'A-Wn 1', set: { label: 'only' } });
    expect(emit(root, [r], 'A-Wn 1').querySelector('nc')!.getAttribute('label')).toBe('only');
    expect(emit(root, [r], 'D-B 2').querySelector('nc')!.getAttribute('label')).toBeNull();
    expect(emit(root, [{ ...r, enabled: false }], 'A-Wn 1').querySelector('nc')!.getAttribute('label')).toBeNull();
  });

  it('never writes xml:id or an invalid name', () => {
    const { root, syls } = twoNotes();
    const [n1] = syls[0].notes.spaced[0].nonSpaced[0].grouped as any[];
    n1.meiAttrs = { 'xml:id': 'evil', '1x': 'y', tilt: 'n' };
    const el = emit(root).querySelector('nc')!;
    expect(el.getAttribute('xml:id')).toBe('m-n1');
    expect(el.getAttribute('1x')).toBeNull();
    expect(el.getAttribute('tilt')).toBe('n');
  });

  it('reports why a rule cannot run, and skips it', () => {
    expect(ruleProblem(rule({ match: { syllableText: '(' } }))).toContain('regular expression');
    expect(ruleProblem(rule({ match: { neume: { text: '*x', mode: 'whole', ignoreShapes: true } } }))).toContain('pattern');
    expect(ruleProblem(rule({ set: {} }))).toContain('no attribute');
    expect(ruleProblem(rule({ set: { 'xml:id': 'a' } }))).toContain('xml:id');
    const { root } = twoNotes();
    expect(emit(root, [rule({ match: { syllableText: '(' } })]).querySelector('nc')!.getAttribute('label')).toBeNull();
  });

  it('previewRule counts the elements a rule would write to', () => {
    const { root } = build([
      { text: 'a', spaced: [{ nonSpaced: [{ grouped: [note('a'), note('b', BaseNote.A)] }] }, { nonSpaced: [{ grouped: [note('c')] }] }] }
    ]);
    expect(previewRule(root, rule({ target: 'nc' })).count).toBe(3);
    expect(previewRule(root, rule({ target: 'neume' })).count).toBe(2);
    expect(previewRule(root, rule({ target: 'syllable' })).count).toBe(1);
  });

  it('copyUuids keeps the annotations with the position when the text editor rebuilds the notes', () => {
    const old: Spaced = { spaced: [{ nonSpaced: [{ grouped: [note('a', BaseNote.G, { meiAttrs: { tilt: 'n' }, meiNeumeAttrs: { rellen: 'above' } })] }] }] };
    const rebuilt: Spaced = { spaced: [{ nonSpaced: [{ grouped: [note('new', BaseNote.A)] }] }] };
    copyUuids(old, rebuilt);
    const n: any = rebuilt.spaced[0].nonSpaced[0].grouped[0];
    expect(n.uuid).toBe('a');
    expect(n.meiAttrs).toEqual({ tilt: 'n' });
    expect(n.meiNeumeAttrs).toEqual({ rellen: 'above' });
  });
});
