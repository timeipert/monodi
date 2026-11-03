/**
 * MEI annotations: attributes on `<nc>`, `<neume>` and `<syllable>` that come from rules or from the
 * person editing, on top of what the entity mapping and the pattern rules write.
 *
 * Two sources, merged at export by `emitMei`:
 *   - annotation rules (`MeiAnnotationRule`, in the profile): `buildAnnotationIndex` evaluates them once
 *     per document and returns the attributes per note, neume and syllable;
 *   - attributes set by hand (`Note.meiAttrs`, `Note.meiNeumeAttrs`, `Syllable.meiAttrs`): they win.
 * Angular-free, so the dialog, the headless export and the tests use it directly.
 */
import * as VM from '../document/model';
import type { AnnotationTarget, MeiAnnotationRule } from './mapping.model';
import { compileNeumeQuery, neumesOfSyllable, pickTargetNotes } from '../document/flag-patterns';
import { isValidAttributeName } from './schema-catalog';

export type AttrMap = Record<string, string>;

export interface AnnotationIndex {
  /** note uuid → attributes for its `<nc>` */
  nc: Map<string, AttrMap>;
  /** uuid of the neume's first note → attributes for the `<neume>` */
  neume: Map<string, AttrMap>;
  /** syllable uuid → attributes for the `<syllable>` */
  syllable: Map<string, AttrMap>;
}

export function emptyIndex(): AnnotationIndex {
  return { nc: new Map(), neume: new Map(), syllable: new Map() };
}

/**
 * First note of a neume, or undefined when it has none. Generic so that a caller with its own note type (the app's
 * `Note` has enums where the shared one has string literals) gets that type back.
 */
export function firstNoteOf<N extends VM.Note>(neume: { nonSpaced: { grouped: N[] }[] }): N | undefined {
  for (const g of neume.nonSpaced) if (g.grouped.length > 0) return g.grouped[0];
  return undefined;
}

function notesOfNeume(neume: VM.NonSpaced): VM.Note[] {
  return neume.nonSpaced.flatMap(g => g.grouped);
}

function safeRegex(source: string | undefined): RegExp | null | 'none' {
  if (!source) return 'none';
  try { return new RegExp(source, 'i'); } catch { return null; }
}

/** Why the conditions of a rule cannot be evaluated (null = fine): an invalid regular expression or pattern code. */
export function conditionProblem(rule: MeiAnnotationRule): string | null {
  if (safeRegex(rule.match.syllableText) === null) return 'The syllable text is not a valid regular expression.';
  if (safeRegex(rule.match.pitch) === null) return 'The pitch is not a valid regular expression.';
  if (rule.match.neume?.text && !compileNeumeQuery(rule.match.neume)) return 'The neume pattern is not valid (use * u d e ? [ ]).';
  return null;
}

/** Why a rule cannot run (null = fine): a condition that cannot be evaluated, or attributes that cannot be set. */
export function ruleProblem(rule: MeiAnnotationRule): string | null {
  const cond = conditionProblem(rule);
  if (cond) return cond;
  const bad = Object.keys(rule.set).find(n => !isValidAttributeName(n));
  if (bad) return `"${bad}" is not an attribute name that can be set.`;
  if (Object.keys(rule.set).length === 0) return 'The rule sets no attribute.';
  return null;
}

function fill(template: string, note: VM.Note, syllable: VM.Syllable, index: number): string {
  return template
    .replace(/\{pname\}/g, note.base.toLowerCase())
    .replace(/\{oct\}/g, String(note.octave))
    .replace(/\{syllable\}/g, syllable.text ?? '')
    .replace(/\{index\}/g, String(index));
}

export interface RuleHit {
  syllable: VM.Syllable;
  neume: VM.NonSpaced;
  /** Notes that matched (for target `neume` and `syllable` too: the notes that triggered the rule). */
  notes: VM.Note[];
}

/** Every place where a rule's conditions hold. */
export function matchRule(root: VM.RootContainer, rule: MeiAnnotationRule): RuleHit[] {
  if (conditionProblem(rule)) return [];
  const m = rule.match;
  const textRe = safeRegex(m.syllableText);
  const pitchRe = safeRegex(m.pitch);
  const neumeMatch = m.neume?.text ? compileNeumeQuery(m.neume) : null;
  const which = m.position?.which ?? 'all';
  const nth = m.position?.nth ?? 1;
  const types = m.noteTypes && m.noteTypes.length > 0 ? new Set(m.noteTypes) : null;
  const hits: RuleHit[] = [];

  for (const syl of VM.getSyllables(root)) {
    if (textRe instanceof RegExp && !textRe.test(syl.text ?? '')) continue;
    for (const neume of neumesOfSyllable(syl)) {
      let candidates: VM.Note[][];
      if (neumeMatch) {
        candidates = neumeMatch(neume).map(h => pickTargetNotes(h.notes, which, nth));
      } else {
        candidates = [pickTargetNotes(notesOfNeume(neume), which, nth)];
      }
      for (const notes of candidates) {
        const kept = notes.filter(n =>
          (!types || types.has(n.noteType)) &&
          (!(pitchRe instanceof RegExp) || pitchRe.test(`${n.base}${n.octave}`)) &&
          (m.liquescent === undefined || !!n.liquescent === m.liquescent) &&
          (!m.flag || (n.flags ?? []).includes(m.flag)));
        if (kept.length > 0) hits.push({ syllable: syl, neume, notes: kept });
      }
    }
  }
  return hits;
}

/** Evaluates the rules (those enabled and valid for `sigle`) in order into the attributes per element. */
export function buildAnnotationIndex(root: VM.RootContainer, rules: MeiAnnotationRule[] | undefined, sigle?: string): AnnotationIndex {
  const index = emptyIndex();
  for (const rule of rules ?? []) {
    if (!rule.enabled || (rule.sigle && rule.sigle !== sigle)) continue;
    for (const hit of matchRule(root, rule)) {
      const neumeNotes = notesOfNeume(hit.neume);
      const put = (map: Map<string, AttrMap>, key: string, note: VM.Note) => {
        const cur = map.get(key) ?? {};
        const idx = neumeNotes.indexOf(note) + 1;
        for (const [name, value] of Object.entries(rule.set)) cur[name] = fill(value, note, hit.syllable, idx);
        map.set(key, cur);
      };
      if (rule.target === 'nc') for (const n of hit.notes) put(index.nc, n.uuid, n);
      else if (rule.target === 'neume') { const first = firstNoteOf(hit.neume); if (first) put(index.neume, first.uuid, hit.notes[0]); }
      else put(index.syllable, hit.syllable.uuid, hit.notes[0]);
    }
  }
  return index;
}

/** Attributes of one element: rules first, then what was set by hand. */
export function mergedAttrs(fromRules: AttrMap | undefined, byHand: AttrMap | undefined): AttrMap {
  return { ...(fromRules ?? {}), ...(byHand ?? {}) };
}

/** Sets the attributes on an element; names that cannot be written (invalid, or `xml:id`) and empty values are skipped. */
export function applyAnnotationAttrs(element: Element, attrs: AttrMap | undefined): void {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === '' || value == null || !isValidAttributeName(name)) continue;
    element.setAttribute(name, value);
  }
}

/** Sets or clears (empty value) one hand-set attribute; removes the map when it becomes empty. */
export function setHandAttr(holder: { meiAttrs?: AttrMap; meiNeumeAttrs?: AttrMap }, target: AnnotationTarget, name: string, value: string | null): void {
  const key = target === 'neume' ? 'meiNeumeAttrs' : 'meiAttrs';
  const map = { ...(holder[key] ?? {}) };
  if (value === null || value === '') delete map[name]; else map[name] = value;
  if (Object.keys(map).length > 0) holder[key] = map; else delete holder[key];
}

/** Dry run of a rule for the settings page: how many elements it would write to, with a few examples. */
export function previewRule(root: VM.RootContainer, rule: MeiAnnotationRule, maxSamples = 5): { count: number; samples: string[] } {
  const hits = matchRule(root, rule);
  const seen = new Set<string>();
  const samples: string[] = [];
  for (const h of hits) {
    if (rule.target === 'nc') h.notes.forEach(n => seen.add(n.uuid));
    else seen.add(rule.target === 'neume' ? (firstNoteOf(h.neume)?.uuid ?? '') : h.syllable.uuid);
    if (samples.length < maxSamples) samples.push(`${h.syllable.text || '(no text)'}: ${h.notes.map(n => n.base + n.octave).join(' ')}`);
  }
  return { count: seen.size, samples };
}

/** Flat, sharp and natural: the export writes them as `<accid>` (profile option `accidentals`), not as a note. */
export function isAccidentalType(noteType: string | undefined): boolean {
  return noteType === 'Flat' || noteType === 'Sharp' || noteType === 'Natural';
}

/** Name for a note of one of these types, for menus and headings. */
export function accidentalName(noteType: string | undefined): string {
  return noteType === 'Flat' ? 'flat' : noteType === 'Sharp' ? 'sharp' : noteType === 'Natural' ? 'natural' : '';
}
