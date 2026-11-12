import { MeiAnnotationRule, defaultMeiProfile } from '@monodi/core/mei';
import { NoteFlagDef, setNoteFlagDefs } from '@monodi/core/document';
import {
  buildMeiReview, flagFor, flagWrites, lensElement, lensKey, lensLabel, lensPlaces, placesWithout, removeHandAttribute,
  replaceHandAttributeByFlag
} from './mei-review';
import {
  emptyRootContainer, emptyFormteilContainer, emptyZeileContainer, emptySyllable,
  DocumentType, BaseNote, NoteType, RootContainer
} from '../types/model';

/**
 * The review of the MEI tab (Overview, highlighting, bulk actions): what the export writes on every note, neume and syllable, and
 * where each attribute comes from (set by hand, a note flag, an annotation rule, or the mapping from the Monodi data).
 */
describe('MEI review of a document', () => {
  const VIRGA: NoteFlagDef = { key: 'V', label: 'Virga', abbrev: 'V', mei: { tilt: 's' } };
  const RING: NoteFlagDef = { key: 'R', label: 'Ring', abbrev: 'R', mei: { type: 'ring', label: 'r' } };
  const TAGGED: NoteFlagDef = { key: 'T', label: 'Tagged', abbrev: 'T', meiTag: 'oriscus', mei: { tilt: 's' } };
  beforeEach(() => setNoteFlagDefs([VIRGA, RING, TAGGED]));
  afterEach(() => setNoteFlagDefs([]));

  const note = (uuid: string, extra: object = {}): any =>
    ({ uuid, base: BaseNote.G, octave: 4, noteType: NoteType.Normal, liquescent: false, focus: false, ...extra });

  /** Two syllables: "Glo" with one neume of the given notes, "ri" with one note `r1`. */
  function doc(notes: any[], second: any[] = [note('r1')]): RootContainer {
    const root = emptyRootContainer();
    const formteil = emptyFormteilContainer(DocumentType.Level1, []);
    const zeile = emptyZeileContainer(1);
    const a = emptySyllable(1);
    a.text = 'Glo';
    a.notes = { spaced: [{ nonSpaced: [{ grouped: notes }] }] };
    const b = emptySyllable(1);
    b.text = 'ri';
    b.notes = { spaced: [{ nonSpaced: [{ grouped: second }] }] };
    zeile.children = [a, b];
    formteil.children = [zeile];
    root.children = [formteil];
    return root;
  }
  const syllables = (root: RootContainer): any[] => (root.children[0] as any).children[0].children;

  const rule = (over: Partial<MeiAnnotationRule>): MeiAnnotationRule =>
    ({ id: 'r', name: 'rule', enabled: true, target: 'nc', match: {}, set: { label: 'x' }, ...over });
  const profile = (rules: MeiAnnotationRule[] = []) => ({ ...defaultMeiProfile(), annotationRules: rules });

  it('reads what the export writes on each note and names the source: by hand, flag, rule or mapping', () => {
    const root = doc([note('n1', { meiAttrs: { type: 'mine' } }), note('n2', { flags: ['V'] }), note('n3', { base: BaseNote.A })]);
    const review = buildMeiReview(root, profile([rule({ match: { pitch: 'A4' }, set: { label: 'x' } })]), [VIRGA, RING]);
    expect(review.error).toBeUndefined();
    const nc = Object.fromEntries(review.places.filter(p => p.target === 'nc').map(p => [p.anchor, p]));
    expect(nc['n1'].attrs['type']).toEqual({ value: 'mine', source: 'hand' });
    expect(nc['n2'].attrs['tilt']).toEqual({ value: 's', source: 'flag', flagKey: 'V' });
    expect(nc['n3'].attrs['label']).toEqual({ value: 'x', source: 'rule' });
    // pitch and octave are not annotations
    expect('pname' in nc['n1'].attrs).toBeFalse();
    expect('oct' in nc['n1'].attrs).toBeFalse();
    expect(nc['n1'].syllableText).toBe('Glo');
    expect(nc['r1'].syllableText).toBe('ri');
  });

  it('lists the places in document order: notes, then neumes, then syllables', () => {
    const review = buildMeiReview(doc([note('n1'), note('n2')]), profile(), []);
    expect(review.places.map(p => p.target)).toEqual(['nc', 'nc', 'nc', 'neume', 'neume', 'syllable', 'syllable']);
    expect(review.places.filter(p => p.target === 'nc').map(p => p.anchor)).toEqual(['n1', 'n2', 'r1']);
    const neume = review.places.find(p => p.target === 'neume')!;
    expect(neume.notes).toEqual(['n1', 'n2']);
    expect(review.places.find(p => p.target === 'syllable')!.notes).toEqual(['n1', 'n2']);
  });

  it('counts every value of an attribute, per source, most frequent first', () => {
    const root = doc([note('n1', { meiAttrs: { tilt: 'n' } }), note('n2', { flags: ['V'] }), note('n3', { flags: ['V'] })]);
    const review = buildMeiReview(root, profile(), [VIRGA]);
    const tilt = review.attributes.find(a => a.target === 'nc' && a.name === 'tilt')!;
    expect(tilt.count).toBe(3);
    expect(tilt.values.map(v => `${v.value}:${v.places.length}`)).toEqual(['s:2', 'n:1']);
    expect(tilt.values[0].bySource).toEqual({ hand: 0, rule: 0, flag: 2, mapping: 0 });
    expect(tilt.values[0].flagKeys).toEqual(['V']);
    expect(tilt.values[1].bySource.hand).toBe(1);
  });

  it('lists every flag with what it writes and the notes that carry it', () => {
    const root = doc([note('n1', { flags: ['V'] }), note('n2')], [note('r1', { flags: ['V', 'R'] })]);
    const review = buildMeiReview(root, profile(), [VIRGA, RING]);
    expect(review.flags.map(f => `${f.def.key}:${f.writes}:${f.places.map(p => p.anchor).join(',')}`))
      .toEqual(['V:tilt="s":n1,r1', 'R:type="ring" label="r":r1']);
    expect(flagWrites(TAGGED)).toBe('<oriscus> tilt="s"');
    expect(flagWrites({ key: 'X', label: 'x', abbrev: 'x' })).toBe('');
  });

  it('finds the notes that lack an attribute, without the accidentals', () => {
    const root = doc([note('n1', { meiAttrs: { type: 'a' } }), note('n2'), note('f1', { noteType: NoteType.Flat })]);
    const review = buildMeiReview(root, profile(), []);
    expect(review.places.some(p => p.element === 'accid' && p.anchor === 'f1')).toBeTrue();
    expect(placesWithout(review, { target: 'nc', name: 'type' }).map(p => p.anchor)).toEqual(['n2', 'r1']);
    expect(placesWithout(review, { target: 'nc', element: 'accid', name: 'type' }).map(p => p.anchor)).toEqual(['f1']);
  });

  it('a lens shows the places of a value, of a flag, or the places without an attribute', () => {
    const root = doc([note('n1', { meiAttrs: { tilt: 'n' } }), note('n2', { flags: ['V'] })], [note('r1', { flags: ['V'] })]);
    const review = buildMeiReview(root, profile(), [VIRGA]);
    expect(lensPlaces(review, { kind: 'value', target: 'nc', name: 'tilt', value: 's' }).map(p => p.anchor)).toEqual(['n2', 'r1']);
    expect(lensPlaces(review, { kind: 'flag', key: 'V' }).map(p => p.anchor)).toEqual(['n2', 'r1']);
    expect(lensPlaces(review, { kind: 'without', target: 'nc', name: 'tilt' })).toEqual([]);
    expect(lensLabel({ kind: 'value', target: 'nc', name: 'tilt', value: 's' })).toBe('tilt="s" on <nc>');
    expect(lensLabel({ kind: 'without', target: 'neume', name: 'type' })).toBe('<neume> without @type');
    expect(lensLabel({ kind: 'flag', key: 'V' }, [VIRGA])).toBe('flag V (Virga)');
  });

  it('a lens chosen in the Note view is the same as the one chosen in the Overview; only accidentals are told apart', () => {
    const fromNoteView = { kind: 'value' as const, target: 'nc' as const, element: lensElement('nc', 'nc'), name: 'tilt', value: 's' };
    const fromOverview = { kind: 'value' as const, target: 'nc' as const, element: lensElement('nc', 'nc'), name: 'tilt', value: 's' };
    expect(lensKey(fromNoteView)).toBe(lensKey(fromOverview));
    expect(lensElement('nc', 'accid')).toBe('accid');
    expect(lensElement('neume', 'ligature')).toBeUndefined();
  });

  it('a flag whose element name replaces the nc is still a note place', () => {
    const review = buildMeiReview(doc([note('n1', { flags: ['T'] })]), profile(), [TAGGED]);
    const p = review.places.find(x => x.anchor === 'n1' && x.target === 'nc')!;
    expect(p.element).toBe('oriscus');
    expect(lensPlaces(review, { kind: 'value', target: 'nc', name: 'tilt', value: 's' }).map(x => x.anchor)).toEqual(['n1']);
  });

  it('offers a flag for a hand-set value only when the flag writes exactly that attribute and nothing else', () => {
    expect(flagFor('tilt', 's', [VIRGA, RING, TAGGED])).toBe(VIRGA);
    expect(flagFor('tilt', 'n', [VIRGA])).toBeUndefined();
    expect(flagFor('type', 'ring', [RING])).toBeUndefined();   // the flag also writes label
    expect(flagFor('tilt', 's', [TAGGED])).toBeUndefined();    // the flag also renames the element
  });

  it('removes a hand-set attribute from notes, neumes or syllables, only with the given value, and drops empty maps', () => {
    const root = doc([note('n1', { meiAttrs: { tilt: 'n', type: 'a' }, meiNeumeAttrs: { type: 'pes' } }), note('n2', { meiAttrs: { tilt: 's' } })]);
    syllables(root)[0].meiAttrs = { label: 'intro' };
    expect(removeHandAttribute(root, 'nc', ['n1', 'n2'], 'tilt', 'n')).toBe(1);
    const [n1, n2] = syllables(root)[0].notes.spaced[0].nonSpaced[0].grouped;
    expect(n1.meiAttrs).toEqual({ type: 'a' });
    expect(n2.meiAttrs).toEqual({ tilt: 's' });
    expect(removeHandAttribute(root, 'nc', ['n2'], 'tilt')).toBe(1);
    expect('meiAttrs' in n2).toBeFalse();
    expect(removeHandAttribute(root, 'neume', ['n1'], 'type')).toBe(1);
    expect('meiNeumeAttrs' in n1).toBeFalse();
    expect(removeHandAttribute(root, 'syllable', ['n1', 'n2'], 'label')).toBe(1);
    expect('meiAttrs' in syllables(root)[0]).toBeFalse();
    expect(removeHandAttribute(root, 'nc', ['n1'], 'missing')).toBe(0);
  });

  it('replaces a hand-set value by the flag that writes the same, and the export stays the same', () => {
    const root = doc([note('n1', { meiAttrs: { tilt: 's' } }), note('n2', { meiAttrs: { tilt: 's', type: 'a' } }), note('n3', { meiAttrs: { tilt: 'n' } })]);
    const before = buildMeiReview(root, profile(), [VIRGA]);
    expect(replaceHandAttributeByFlag(root, ['n1', 'n2', 'n3'], 'tilt', 's', VIRGA)).toBe(2);
    const [n1, n2, n3] = syllables(root)[0].notes.spaced[0].nonSpaced[0].grouped;
    expect(n1.flags).toEqual(['V']);
    expect('meiAttrs' in n1).toBeFalse();
    expect(n2.meiAttrs).toEqual({ type: 'a' });
    expect(n2.flags).toEqual(['V']);
    expect(n3.flags).toBeUndefined();
    const after = buildMeiReview(root, profile(), [VIRGA]);
    const values = (r: typeof before) => r.places.filter(p => p.target === 'nc').map(p => `${p.anchor}:${p.attrs['tilt']?.value}`);
    expect(values(after)).toEqual(values(before));
    expect(after.places.find(p => p.anchor === 'n1')!.attrs['tilt'].source).toBe('flag');
  });
});
