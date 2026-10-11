/**
 * "Show in manuscript": what the annotations say about one neume of the
 * transcription. No Angular, no DOM: plain functions on the document tree and the
 * source's annotations, so they can be tested on their own.
 *
 * Three levels, the best available wins as the PRIMARY result; examples of the
 * same sign (level C) are always listed beside it:
 *
 *   exact    a snippet whose `uuid` is a note of this neume
 *   line     the line region whose `lineUUID` is the LineChange that ends this line
 *   (none)   neither is linked yet
 *
 * A neume has no uuid of its own: annotations point at its first note. Snippets
 * made by the old per-ligature-group link list point at the first note of a
 * group, so a snippet matches if its uuid is ANY note of the neume.
 *
 * A line is ended by its LineChange (the Neumen-Editor's reading, and the one
 * Monodi's own line map uses): the first LineChange after a note is that
 * note's line.
 */

import * as VM from './types/model';
import { extractPattern, firstNoteUuid } from './transcription-analyzer-core';

export interface NeumeAt {
  /** Pattern code of the whole neume, e.g. `[*u]dd`. */
  pattern: string;
  noteUuids: string[];
  firstNoteUuid: string;
}

/** One place in the manuscript: a snippet, or just a line region. */
export interface Hit {
  region: VM.AnnotationRegion;
  /** Present for a snippet; absent when the hit is a whole line. */
  item?: VM.AnnotationItem;
  /** The snippet's pattern with its variant letter, e.g. `*ud b`. */
  label: string;
}

export interface Lookup {
  pattern: string;
  /** Reference ID of the pattern in the source's equivalents table, '' if it has none. */
  refId: string;
  notes?: string;
  primary: { kind: 'exact' | 'line'; hits: Hit[] } | null;
  /** Other snippets of the same pattern (level C), at most `maxExamples`. */
  examples: Hit[];
  /** How many there are in all. */
  totalExamples: number;
}

const baseCode = (pattern: string | undefined): string => String(pattern ?? '').split(' ')[0];

/** All syllables of the tree in reading order, with the LineChange nodes between them. */
function walk(node: any, visit: (n: any) => boolean | void): boolean {
  if (!node || typeof node !== 'object') return false;
  if (visit(node) === true) return true;
  if (node.kind === VM.LinePartKind.Syllable) return false; // notes are read by the visitor
  for (const key of ['children', 'parts']) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) if (walk(child, visit)) return true;
    }
  }
  return false;
}

function neumesOf(syllable: any): VM.NonSpaced[] {
  const out: VM.NonSpaced[] = [];
  const add = (spaced: any) => { if (spaced && Array.isArray(spaced.spaced)) out.push(...spaced.spaced); };
  add(syllable.notes);
  if (Array.isArray(syllable.additionalMelodies)) syllable.additionalMelodies.forEach(add);
  return out;
}

const noteUuidsOf = (n: VM.NonSpaced): string[] =>
  (n.nonSpaced ?? []).flatMap(g => (g.grouped ?? []).map(note => note.uuid).filter(Boolean));

/** The neume that holds this note, with its pattern. */
export function findNeume(root: any, noteUuid: string): NeumeAt | null {
  let found: NeumeAt | null = null;
  walk(root, (node) => {
    if (node.kind !== VM.LinePartKind.Syllable) return;
    for (const neume of neumesOf(node)) {
      const uuids = noteUuidsOf(neume);
      if (uuids.includes(noteUuid)) {
        const pattern = extractPattern(neume);
        if (pattern) found = { pattern, noteUuids: uuids, firstNoteUuid: firstNoteUuid(neume) };
        return true;
      }
    }
    return;
  });
  return found;
}

/** The uuid of the LineChange that ends the line this note stands on, '' if the line has no such marker. */
export function lineUuidOfNote(root: any, noteUuid: string): string {
  let seen = false;
  let line = '';
  walk(root, (node) => {
    if (!seen && node.kind === VM.LinePartKind.Syllable) {
      if (neumesOf(node).some(n => noteUuidsOf(n).includes(noteUuid))) seen = true;
      return;
    }
    if (seen && node.kind === VM.LinePartKind.LineChange) {
      line = node.uuid || '';
      return true;
    }
    return;
  });
  return line;
}

const hitLabel = (item: VM.AnnotationItem): string =>
  item.variant ? `${baseCode(item.pattern)} ${item.variant}` : baseCode(item.pattern);

/** Whether the source has anything "Show in manuscript" could use. */
export function hasAnnotations(source: { annotationRegions?: VM.AnnotationRegion[]; annotationItems?: VM.AnnotationItem[] } | null | undefined): boolean {
  return !!source && ((source.annotationItems?.length ?? 0) > 0 || (source.annotationRegions?.length ?? 0) > 0);
}

/**
 * What the annotations say about the neume this note belongs to.
 *
 * @returns null when the note is not part of a neume of this tree
 */
export function lookupInManuscript(
  source: { annotationRegions?: VM.AnnotationRegion[]; annotationItems?: VM.AnnotationItem[]; equivalents?: VM.EquivalentMetadata[] },
  root: any,
  noteUuid: string,
  maxExamples = 8
): Lookup | null {
  const neume = findNeume(root, noteUuid);
  if (!neume) return null;

  const regions = source.annotationRegions ?? [];
  const items = source.annotationItems ?? [];
  const regionById = new Map(regions.map((r): [string, VM.AnnotationRegion] => [r.id, r]));
  const hitOf = (item: VM.AnnotationItem): Hit | null => {
    const region = regionById.get(item.regionId);
    return region ? { region, item, label: hitLabel(item) } : null;
  };

  const eq = (source.equivalents ?? []).find(e => baseCode(e.pattern) === neume.pattern);
  const mine = new Set(neume.noteUuids);

  let primary: Lookup['primary'] = null;
  const exact = items.filter(i => i.uuid && mine.has(i.uuid)).map(hitOf).filter((h): h is Hit => !!h);
  if (exact.length) {
    primary = { kind: 'exact', hits: exact };
  } else {
    const lineUuid = lineUuidOfNote(root, noteUuid);
    const region = lineUuid ? regions.find(r => r.lineUUID === lineUuid) : undefined;
    if (region) primary = { kind: 'line', hits: [{ region, label: region.name }] };
  }

  const taken = new Set((primary?.hits ?? []).map(h => h.item?.id).filter(Boolean));
  const same = items
    .filter(i => baseCode(i.pattern) === neume.pattern && !taken.has(i.id))
    .map(hitOf)
    .filter((h): h is Hit => !!h);

  return {
    pattern: neume.pattern,
    refId: eq?.refId ?? '',
    notes: eq?.notes,
    primary,
    examples: same.slice(0, maxExamples),
    totalExamples: same.length
  };
}
