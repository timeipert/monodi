/**
 * What the MEI tab of the document sidebar shows: the MEI annotations of the note that has the editor focus,
 * of its neume and of its syllable, each attribute marked as set by hand or by an annotation rule.
 * Angular-free so that it can be tested directly; the sidebar only renders the result.
 */
import * as VM from '../types/model';
import { AnnotationTarget, MeiAnnotationRule, MeiMappingProfileV2, emitMei, AnnotationIndex, AttrMap, accidentalName, buildAnnotationIndex, firstNoteOf, isAccidentalType } from '@monodi/core/mei';
import { flagDefsOf } from '@monodi/core/document';

/** The note with the editor focus and the neume and syllable around it. */
export interface NoteSelection {
  note: VM.Note;
  neume: VM.NonSpaced;
  syllable: VM.Syllable;
}

export interface AttrRow {
  name: string;
  value: string;
  /**
   * `hand`: set in the editor. `rule`: written by an annotation rule. `flag`: written by a note flag of the note (`flagKey`).
   * `generated`: written by the entity mapping from the Monodi data (pitch, connection, …); it cannot be edited here.
   */
  source: 'hand' | 'rule' | 'flag' | 'generated';
  /** The flag that writes the attribute (only on `flag` rows). */
  flagKey?: string;
  /** A rule also sets this attribute, but the value set by hand wins (only on `hand` rows). */
  overridesRule?: string;
  /** The mapping generates this attribute, but the value set by hand wins (only on `hand` and `rule` rows). */
  overridesGenerated?: string;
}

export interface AttrGroup {
  target: AnnotationTarget;
  /** MEI element that receives the attributes. */
  element: string;
  /** Short description of the element, for example `note G4`. */
  subject: string;
  rows: AttrRow[];
}

/** The note that has the focus in the document (the one the editor edits), or undefined when none has. */
export function findFocusedNote(root: VM.RootContainer): NoteSelection | undefined {
  for (const syllable of VM.getSyllables(root)) {
    const voices: VM.Spaced[] = [syllable.notes, ...(syllable.additionalMelodies ?? [])];
    for (const voice of voices) {
      for (const neume of voice?.spaced ?? []) {
        for (const group of neume.nonSpaced) {
          const note = group.grouped.find(n => n.focus);
          if (note) return { note, neume, syllable };
        }
      }
    }
  }
  return undefined;
}

/**
 * Rows of one element in the order of precedence from weakest to strongest: generated, rule, hand.
 * A stronger source that sets the same attribute replaces the weaker row and remembers the value it overrides.
 */
export function attrRows(byHand: AttrMap | undefined, fromRules: AttrMap | undefined, generated?: AttrMap): AttrRow[] {
  const rows: AttrRow[] = [];
  const hand = byHand ?? {}, rules = fromRules ?? {}, gen = generated ?? {};
  for (const name of Object.keys(gen).sort()) {
    if (name in hand || name in rules) continue;
    rows.push({ name, value: gen[name], source: 'generated' });
  }
  for (const name of Object.keys(rules).sort()) {
    if (name in hand) continue;
    rows.push({ name, value: rules[name], source: 'rule', ...(name in gen && gen[name] !== rules[name] ? { overridesGenerated: gen[name] } : {}) });
  }
  for (const name of Object.keys(hand).sort()) {
    const row: AttrRow = { name, value: hand[name], source: 'hand' };
    if (name in rules && rules[name] !== hand[name]) row.overridesRule = rules[name];
    if (name in gen && gen[name] !== hand[name]) row.overridesGenerated = gen[name];
    rows.push(row);
  }
  return rows;
}

/** Attributes the mapping generates for the selected note, its neume and its syllable. */
export interface GeneratedAttrs { nc: AttrMap; neume: AttrMap; syllable: AttrMap }

/**
 * Exports the selected syllable alone with the active profile, without rules and without hand-set attributes, and reads the
 * attributes of its `nc`, `neume` and `syllable` elements. This is what the entity mapping and the flags produce from the
 * Monodi data (pitch name, octave, `con` after a gap, `tilt` of a note head with a stem, …), so the tab shows exactly what the
 * export writes. Returns empty maps when the export fails or an element is not written.
 */
export function generatedAttrs(sel: NoteSelection, profile: MeiMappingProfileV2): GeneratedAttrs {
  const out: GeneratedAttrs = { nc: {}, neume: {}, syllable: {} };
  try {
    const syl: VM.Syllable = JSON.parse(JSON.stringify(sel.syllable));
    const strip = (spaced: VM.Spaced | undefined) => spaced?.spaced.forEach(n => n.nonSpaced.forEach(g => g.grouped.forEach(x => { delete x.meiAttrs; delete x.meiNeumeAttrs; })));
    delete syl.meiAttrs;
    strip(syl.notes);
    (syl.additionalMelodies ?? []).forEach(strip);
    const root = VM.emptyRootContainer();
    const formteil = VM.emptyFormteilContainer(VM.DocumentType.Level1, []);
    const zeile = VM.emptyZeileContainer(1);
    zeile.children = [syl];
    formteil.children = [zeile];
    root.children = [formteil];
    const xml = emitMei(root, { ...profile, annotationRules: [], emitHeader: false });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const byUuid = (uuid: string) => Array.from(doc.getElementsByTagName('*')).find(e => (e.getAttribute('xml:id') ?? '').endsWith(uuid) && e.getAttribute('xml:id') !== '');
    const read = (el: Element | undefined, into: AttrMap) => {
      if (!el) return;
      for (const a of Array.from(el.attributes)) if (a.name !== 'xml:id' && !a.name.startsWith('xmlns')) into[a.name] = a.value;
    };
    const nc = byUuid(sel.note.uuid);
    read(nc, out.nc);
    const parent = nc?.parentElement;
    if (parent && parent.localName === (profile.entities.neume.tag || 'neume')) read(parent, out.neume);
    read(byUuid(sel.syllable.uuid), out.syllable);
  } catch { /* the tab then shows only annotations */ }
  return out;
}

/** The groups (note, neume, syllable) of the annotations of a selection; an accidental has no neume and is an `accid`. */
export function selectionGroups(sel: NoteSelection, index: AnnotationIndex, generated?: GeneratedAttrs, accidAsElement = true): AttrGroup[] {
  const first = firstNoteOf(sel.neume);
  const pitch = `${sel.note.base}${sel.note.octave}`;
  const syllable: AttrGroup = {
    target: 'syllable', element: 'syllable', subject: `syllable "${sel.syllable.text ?? ''}"`,
    rows: attrRows(sel.syllable.meiAttrs, index.syllable.get(sel.syllable.uuid), generated?.syllable)
  };
  if (accidAsElement && isAccidentalType(sel.note.noteType)) {
    return [{
      target: 'nc', element: 'accid', subject: `${accidentalName(sel.note.noteType)} at ${pitch}`,
      rows: attrRows(sel.note.meiAttrs, index.nc.get(sel.note.uuid), generated?.nc)
    }, syllable];
  }
  // A generated attribute that a flag of the note writes with the same value comes from that flag.
  const flags = flagDefsOf(sel.note.flags);
  const ncRows = attrRows(sel.note.meiAttrs, index.nc.get(sel.note.uuid), generated?.nc).map(r => {
    if (r.source !== 'generated') return r;
    const flag = flags.find(f => f.mei?.[r.name] === r.value);
    return flag ? { ...r, source: 'flag' as const, flagKey: flag.key } : r;
  });
  return [
    { target: 'nc', element: 'nc', subject: `note ${pitch}`, rows: ncRows },
    {
      target: 'neume', element: 'neume', subject: 'its neume',
      rows: attrRows(first?.meiNeumeAttrs, first ? index.neume.get(first.uuid) : undefined, generated?.neume)
    },
    syllable
  ];
}

/** Everything the tab needs for the focused note, or undefined when no note has the focus. */
export function selectionAnnotations(root: VM.RootContainer, rules: MeiAnnotationRule[] | undefined, sigle?: string, profile?: MeiMappingProfileV2):
  { selection: NoteSelection; groups: AttrGroup[] } | undefined {
  const selection = findFocusedNote(root);
  if (!selection) return undefined;
  return { selection, groups: selectionGroups(selection, buildAnnotationIndex(root, rules, sigle), profile ? generatedAttrs(selection, profile) : undefined, profile?.accidentals !== 'note') };
}
