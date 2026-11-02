/**
 * What the MEI tab of the document sidebar shows: the MEI annotations of the note that has the editor focus,
 * of its neume and of its syllable, each attribute marked as set by hand or by an annotation rule.
 * Angular-free so that it can be tested directly; the sidebar only renders the result.
 */
import * as VM from '../types/model';
import { AnnotationTarget, MeiAnnotationRule } from './mei-mapping.model';
import { AnnotationIndex, AttrMap, buildAnnotationIndex, firstNoteOf } from './mei-annotations';

/** The note with the editor focus and the neume and syllable around it. */
export interface NoteSelection {
  note: VM.Note;
  neume: VM.NonSpaced;
  syllable: VM.Syllable;
}

export interface AttrRow {
  name: string;
  value: string;
  /** `hand`: set in the editor. `rule`: written by an annotation rule. */
  source: 'hand' | 'rule';
  /** A rule also sets this attribute, but the value set by hand wins (only on `hand` rows). */
  overridesRule?: string;
}

export interface AttrGroup {
  target: AnnotationTarget;
  /** MEI element that receives the attributes. */
  element: 'nc' | 'neume' | 'syllable';
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

/** Rows of one element: hand-set attributes first, then those only a rule writes; both in name order. */
export function attrRows(byHand: AttrMap | undefined, fromRules: AttrMap | undefined): AttrRow[] {
  const rows: AttrRow[] = [];
  for (const name of Object.keys(byHand ?? {}).sort()) {
    const row: AttrRow = { name, value: byHand![name], source: 'hand' };
    if (fromRules && name in fromRules && fromRules[name] !== byHand![name]) row.overridesRule = fromRules[name];
    rows.push(row);
  }
  for (const name of Object.keys(fromRules ?? {}).sort()) {
    if (!(byHand && name in byHand)) rows.push({ name, value: fromRules![name], source: 'rule' });
  }
  return rows;
}

/** The three groups (note, neume, syllable) of the annotations of a selection. */
export function selectionGroups(sel: NoteSelection, index: AnnotationIndex): AttrGroup[] {
  const first = firstNoteOf(sel.neume);
  const pitch = `${sel.note.base}${sel.note.octave}`;
  return [
    {
      target: 'nc', element: 'nc', subject: `note ${pitch}`,
      rows: attrRows(sel.note.meiAttrs, index.nc.get(sel.note.uuid))
    },
    {
      target: 'neume', element: 'neume', subject: 'its neume',
      rows: attrRows(first?.meiNeumeAttrs, first ? index.neume.get(first.uuid) : undefined)
    },
    {
      target: 'syllable', element: 'syllable', subject: `syllable "${sel.syllable.text ?? ''}"`,
      rows: attrRows(sel.syllable.meiAttrs, index.syllable.get(sel.syllable.uuid))
    }
  ];
}

/** Everything the tab needs for the focused note, or undefined when no note has the focus. */
export function selectionAnnotations(root: VM.RootContainer, rules: MeiAnnotationRule[] | undefined, sigle?: string):
  { selection: NoteSelection; groups: AttrGroup[] } | undefined {
  const selection = findFocusedNote(root);
  if (!selection) return undefined;
  return { selection, groups: selectionGroups(selection, buildAnnotationIndex(root, rules, sigle)) };
}
