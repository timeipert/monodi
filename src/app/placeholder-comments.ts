import { v4 as UUID } from 'uuid';
import {
  BaseNote, Comment, LinePartKind, Note, NoteType, RootContainer, Spaced, Syllable, SyllableType,
  allNotes, getAllLineParts,
} from './types/model';

/**
 * Comments on syllables without notes.
 *
 * There are three kinds of syllable: normal with notes, normal without notes (staff lines, nothing
 * on them) and "without staff lines". Only the middle one is concerned here. Early Monodi could
 * only attach a comment to a note, never to a syllable that has none. The convention
 * was a placeholder note nobody sings alone, F3 or D6 (also liquescent), under the comment:
 * "there is nothing here, only the comment". Today a comment can sit on the syllable itself.
 *
 * - `placeholderCommentsToSyllables` (import): comment starts and ends on syllables with nothing but
 *   placeholder notes move to the syllables; the placeholders are removed.
 * - `syllableCommentsToPlaceholders` (export for old versions): the reverse; a syllable without
 *   notes that carries a comment gets one placeholder note, the comment moves onto it.
 */

export interface PlaceholderPitch { base: BaseNote; octave: number; }

export interface PlaceholderConfig {
  /** Notes that stand for "no note" (any note type, liquescent or not). */
  pitches: PlaceholderPitch[];
  /** The note written for a syllable without notes when exporting for old versions. */
  exportPitch: PlaceholderPitch;
}

export const DEFAULT_PLACEHOLDER_PITCHES: PlaceholderPitch[] = [
  { base: BaseNote.F, octave: 3 },
  { base: BaseNote.D, octave: 6 },
];
export const DEFAULT_PLACEHOLDER_EXPORT_PITCH: PlaceholderPitch = { base: BaseNote.F, octave: 3 };

export const DEFAULT_PLACEHOLDER_CONFIG: PlaceholderConfig = {
  pitches: DEFAULT_PLACEHOLDER_PITCHES,
  exportPitch: DEFAULT_PLACEHOLDER_EXPORT_PITCH,
};

/** "F3", "f[3]", "D6" → pitch; null if it is none. */
export function parsePlaceholderPitch(s: string): PlaceholderPitch | null {
  const m = /^\s*([A-Ga-g])\s*\[?\s*([0-9])\s*\]?\s*$/.exec(s || '');
  return m ? { base: m[1].toUpperCase() as BaseNote, octave: Number(m[2]) } : null;
}

/** "F3, D6" (separated by comma, semicolon or space) → pitches; invalid entries are dropped. */
export function parsePlaceholderPitches(s: string): PlaceholderPitch[] {
  return (s || '').split(/[\s,;]+/).map(parsePlaceholderPitch).filter((p): p is PlaceholderPitch => !!p);
}

interface PlaceholderSettings {
  placeholderNotes?: string;
  placeholderExportNote?: string;
  importPlaceholderComments?: boolean;
}

export function placeholderConfigFromSettings(s?: PlaceholderSettings | null): PlaceholderConfig {
  const pitches = s?.placeholderNotes !== undefined ? parsePlaceholderPitches(s.placeholderNotes) : [];
  const exportPitch = parsePlaceholderPitch(s?.placeholderExportNote ?? '');
  return {
    pitches: pitches.length ? pitches : DEFAULT_PLACEHOLDER_PITCHES,
    exportPitch: exportPitch ?? DEFAULT_PLACEHOLDER_EXPORT_PITCH,
  };
}

/** Opt-out: on unless the project settings switch it off. */
export function importPlaceholderCommentsEnabled(s?: PlaceholderSettings | null): boolean {
  return s?.importPlaceholderComments !== false;
}

export function isPlaceholderNote(n: Pick<Note, 'base' | 'octave'>, cfg: PlaceholderConfig): boolean {
  return cfg.pitches.some((p) => p.base === n.base && p.octave === n.octave);
}

const emptySpaced = (): Spaced => ({ spaced: [{ nonSpaced: [{ grouped: [] }] }] });

/** All notes of a syllable, every voice. */
function syllableNotes(s: Syllable): Note[] {
  return [s.notes, ...(s.additionalMelodies || [])].flatMap((sp) => (sp ? allNotes(sp) : []));
}

/**
 * Import: a comment end (or start) on a syllable that holds nothing but placeholder notes moves
 * onto the syllable, and the syllable is cleared of its notes but keeps its type (a normal syllable stays normal,
 * staff lines and all): an empty place that the comment can end on. This covers a comment over placeholders
 * only as well as one that runs over real notes and ends (or starts) on a placeholder. A syllable
 * that mixes a placeholder with real notes is left alone, and so is a placeholder without a
 * comment. Run after `normalizeDocumentComments`. Mutates; returns the number of comments changed.
 */
export function placeholderCommentsToSyllables(root: RootContainer, cfg: PlaceholderConfig = DEFAULT_PLACEHOLDER_CONFIG): number {
  if (!root || !Array.isArray(root.comments) || !root.comments.length) return 0;
  const parts = getAllLineParts(root);
  const owner = new Map<string, Syllable>();      // note uuid -> its syllable, if that holds placeholders only
  for (const lp of parts) {
    if (lp.kind !== LinePartKind.Syllable) continue;
    const notes = syllableNotes(lp);
    if (notes.length && notes.every((n) => isPlaceholderNote(n, cfg))) notes.forEach((n) => owner.set(n.uuid, lp));
  }
  const clear = new Set<Syllable>();
  const changed = new Set<Comment>();
  for (const c of root.comments) {
    for (const key of ['startUUID', 'endUUID'] as const) {
      const s = owner.get(c[key]);
      if (!s) continue;
      c[key] = s.uuid;
      clear.add(s);
      changed.add(c);
    }
  }
  for (const s of clear) {
    // the syllable keeps its type: a normal syllable stays normal (staff lines, no notes)
    s.notes = emptySpaced();
    if (s.additionalMelodies) s.additionalMelodies = s.additionalMelodies.map(emptySpaced);
  }
  return changed.size;
}

/**
 * Export for versions that cannot comment on a syllable without notes: every normal syllable
 * without notes that carries a comment gets one placeholder note, and the comments move onto it.
 * Syllables "without staff lines" and ellipses are left as they are. Returns a copy; the document is not changed.
 */
export function syllableCommentsToPlaceholders(root: RootContainer, cfg: PlaceholderConfig = DEFAULT_PLACEHOLDER_CONFIG): RootContainer {
  if (!root || !Array.isArray(root.comments) || !root.comments.length) return root;
  const out: RootContainer = JSON.parse(JSON.stringify(root));
  const bySyllable = new Map<string, Syllable>();
  for (const lp of getAllLineParts(out)) {
    // only a normal syllable (with staff lines) needs a note to carry a comment; "without notes" and ellipses do not
    if (lp.kind === LinePartKind.Syllable && lp.syllableType === SyllableType.Normal && !syllableNotes(lp).length) bySyllable.set(lp.uuid, lp);
  }
  const placed = new Map<string, string>();     // syllable uuid -> uuid of its placeholder note
  const placeholderOf = (s: Syllable): string => {
    let id = placed.get(s.uuid);
    if (id) return id;
    id = UUID();
    const note: Note = { uuid: id, noteType: NoteType.Normal, base: cfg.exportPitch.base, octave: cfg.exportPitch.octave, liquescent: false, focus: false };
    s.notes = { spaced: [{ nonSpaced: [{ grouped: [note] }] }] };
    placed.set(s.uuid, id);
    return id;
  };
  for (const c of out.comments) {
    const a = bySyllable.get(c.startUUID);
    if (a) c.startUUID = placeholderOf(a);
    const b = bySyllable.get(c.endUUID);
    if (b) c.endUUID = placeholderOf(b);
  }
  return out;
}
