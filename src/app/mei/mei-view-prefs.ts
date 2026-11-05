/**
 * How much of the MEI annotations the editor shows. The choices are per person and browser (local storage), not part
 * of the project: they change what is displayed, never what is exported.
 *   - `showGenerated`: the sidebar tab lists the attributes the export mapping generates (locked rows).
 *   - `markInStaff`: notes with annotations show them in the staff: a drawing for an attribute that has a shape (tilt, curve, ...),
 *     a dot for the others.
 *   - `view`: the sidebar tab shows the selected note, or a list of every annotated place of the document.
 */
export interface MeiViewPrefs {
  showGenerated: boolean;
  markInStaff: boolean;
  view: 'note' | 'all';
  /** How the list *All annotated* is grouped. */
  groupBy: 'annotation' | 'syllable' | 'element';
}

import { Subject } from 'rxjs';

/** Emits after a choice changed; the staff editors (OnPush) redraw their markers on it. */
export const meiViewChanges$ = new Subject<void>();

const KEY = 'monodi_mei_view';
const DEFAULTS: MeiViewPrefs = { showGenerated: true, markInStaff: true, view: 'note', groupBy: 'annotation' };

let current: MeiViewPrefs | undefined;

export function getMeiViewPrefs(): MeiViewPrefs {
  if (!current) {
    current = { ...DEFAULTS };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (typeof raw.showGenerated === 'boolean') current.showGenerated = raw.showGenerated;
      if (typeof raw.markInStaff === 'boolean') current.markInStaff = raw.markInStaff;
      if (raw.view === 'note' || raw.view === 'all') current.view = raw.view;
      if (['annotation', 'syllable', 'element'].includes(raw.groupBy)) current.groupBy = raw.groupBy;
    } catch { /* storage unavailable or damaged: defaults */ }
  }
  return current;
}

export function setMeiViewPrefs(change: Partial<MeiViewPrefs>): void {
  current = { ...getMeiViewPrefs(), ...change };
  meiViewChanges$.next();
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* the choice then lasts until the page is closed */ }
}

/**
 * Places where an annotation rule writes attributes, for the marks in the staff. The document component fills it
 * (it knows the whole document and the rules); the syllable editors read it. Hand-set annotations are read from the notes.
 */
export const meiRuleMarks: { notes: Set<string>; syllables: Set<string>; noteAttrs: Map<string, Record<string, string>> } =
  { notes: new Set(), syllables: new Set(), noteAttrs: new Map() };

/**
 * Replaces the rule marks; redraws the staff only when they differ. `noteAttrs` holds the attributes the rules write for the `<nc>`
 * of a note (by note uuid), so the staff can draw the shape of those that have one (see `mei-attribute-glyphs.ts`).
 */
export function setMeiRuleMarks(notes: Set<string>, syllables: Set<string>, noteAttrs: Map<string, Record<string, string>> = new Map()): void {
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));
  const sameAttrs = JSON.stringify([...noteAttrs]) === JSON.stringify([...meiRuleMarks.noteAttrs]);
  if (same(notes, meiRuleMarks.notes) && same(syllables, meiRuleMarks.syllables) && sameAttrs) return;
  meiRuleMarks.notes = notes;
  meiRuleMarks.syllables = syllables;
  meiRuleMarks.noteAttrs = noteAttrs;
  meiViewChanges$.next();
}
