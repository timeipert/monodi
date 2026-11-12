/**
 * Review of the MEI annotations of one document: what the export writes on every note, neume and syllable, and where each attribute
 * comes from. It is the data behind the *Overview* of the MEI tab (counts per attribute value and per flag, highlighting in the staff,
 * stepping from place to place) and behind the source labels of the *Note* view.
 *
 * The single source of truth is the export itself: the document is written with the active MEI profile (`emitMei`, without the
 * header), and the attributes of every element are read back. The source of an attribute follows the precedence of the export
 * (see MEI-ANNOTATIONS.md, section 1):
 *   - `hand`: set by hand in the editor (`Note.meiAttrs`, `Note.meiNeumeAttrs`, `Syllable.meiAttrs`);
 *   - `rule`: written by an annotation rule of the profile;
 *   - `flag`: written by a note flag (for example the flag V *Virga* writes `type="virga"`); `flagKey` names the flag;
 *   - `mapping`: written by the entity mapping or a pattern rule from the Monodi data (`con` after a gap, `tilt` of a note head with a
 *     stem, ...).
 * Pitch, ids and links between voices (`pname`, `oct`, `xml:id`, `synch`, `sameas`, `corresp`) are left out: they are not annotations.
 *
 * Angular-free, so that it can be tested directly.
 */
import * as VM from '../types/model';
import { AnnotationIndex, MeiMappingProfileV2, buildAnnotationIndex, emitMei } from '@monodi/core/mei';
import { NoteFlagDef, flagDefsOf } from '@monodi/core/document';

export type AttrSource = 'hand' | 'rule' | 'flag' | 'mapping';
export type ReviewTarget = 'nc' | 'neume' | 'syllable';

/** One element of the export (a note, a neume or a syllable) with the attributes the export writes on it. */
export interface ReviewPlace {
  target: ReviewTarget;
  /** MEI element as written (`nc`, `accid`, `neume`, `ligature`, `note`, `syllable`, ...). */
  element: string;
  /** The note to jump to: the note itself, the first note of the neume, or the first note of the syllable. */
  anchor: string;
  /** The notes to highlight in the staff. */
  notes: string[];
  syllableUuid: string;
  syllableText: string;
  /** Short description, for example `note G4` or `neume F4 G4 A4`. */
  label: string;
  /** 1 for the first voice, 2 for the second, ... */
  voice: number;
  attrs: Record<string, { value: string; source: AttrSource; flagKey?: string }>;
}

/** One attribute value on one kind of element, with the places that carry it. */
export interface ReviewValue {
  value: string;
  places: ReviewPlace[];
  /** Number of places per source. */
  bySource: Record<AttrSource, number>;
  /** Flags that write this value (the flag keys, in the order of the places). */
  flagKeys: string[];
}

/** One attribute name on one kind of element. */
export interface ReviewAttribute {
  element: string;
  target: ReviewTarget;
  name: string;
  /** Places that carry the attribute (any value). */
  count: number;
  values: ReviewValue[];
}

/** One note flag of the project and the notes of this document that carry it. */
export interface ReviewFlag {
  def: NoteFlagDef;
  /** What the flag writes, for example `type="virga"` or `<virga>`; empty when it writes nothing. */
  writes: string;
  places: ReviewPlace[];
}

export interface MeiReview {
  places: ReviewPlace[];
  attributes: ReviewAttribute[];
  flags: ReviewFlag[];
  /** Set when the export failed; the review is then empty. */
  error?: string;
}

/** Attributes that are not annotations: pitch, ids, links between voices. */
export const NOT_ANNOTATIONS = new Set(['xml:id', 'pname', 'oct', 'synch', 'sameas', 'corresp']);

const TARGET_ORDER: ReviewTarget[] = ['nc', 'neume', 'syllable'];

/** Elements of the score that hold syllables or neumes but are not a neume themselves. */
const CONTAINERS = new Set(['layer', 'staff', 'section', 'measure', 'syllable', 'supplied', 'app', 'rdg', 'lem', 'choice']);

interface NoteInfo { note: VM.Note; syllable: VM.Syllable; voice: number; neumeFirst?: VM.Note }

/** What a flag writes, as text: its element and its attributes. */
export function flagWrites(def: NoteFlagDef): string {
  const parts: string[] = [];
  if (def.meiTag) parts.push(`<${def.meiTag}>`);
  for (const [n, v] of Object.entries(def.mei ?? {})) parts.push(`${n}="${v}"`);
  return parts.join(' ');
}

/** The uuid an export id stands for: `m-<uuid>` (first voice) or `m-v2-<uuid>` (further voices); other ids (readings of comments, zones) are not elements of the music. */
function uuidOfId(id: string): { uuid: string; voice: number } | null {
  const m = /^m-(?:v(\d+)-)?(.+)$/.exec(id);
  if (!m || m[2].startsWith('comment-')) return null;
  return { uuid: m[2], voice: m[1] ? Number(m[1]) : 1 };
}

/**
 * Builds the review of a document. `flagDefs` are the note flags of the project (for the flag list and the `flag` source); `sigle` is
 * the siglum of the source (rules can be limited to one manuscript).
 */
export function buildMeiReview(root: VM.RootContainer, profile: MeiMappingProfileV2, flagDefs: NoteFlagDef[], sigle?: string): MeiReview {
  const notes = new Map<string, NoteInfo>();
  const syllables = new Map<string, VM.Syllable>();
  for (const syllable of VM.getSyllables(root)) {
    syllables.set(syllable.uuid, syllable);
    const voices: (VM.Spaced | undefined)[] = [syllable.notes, ...(syllable.additionalMelodies ?? [])];
    voices.forEach((spaced, v) => {
      for (const neume of spaced?.spaced ?? []) {
        const all = neume.nonSpaced.flatMap(g => g.grouped);
        for (const note of all) notes.set(note.uuid, { note, syllable, voice: v + 1, neumeFirst: all[0] });
      }
    });
  }

  const index: AnnotationIndex = buildAnnotationIndex(root, profile.annotationRules, sigle);
  let doc: Document;
  try {
    const xml = emitMei(root, { ...profile, emitHeader: false }, undefined, sigle);
    doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('The export is not well-formed XML.');
  } catch (e) {
    return { places: [], attributes: [], flags: [], error: e instanceof Error ? e.message : String(e) };
  }

  const places: ReviewPlace[] = [];
  const noteElements = new Map<Element, NoteInfo>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const ref = uuidOfId(el.getAttribute('xml:id') ?? '');
    if (ref && notes.has(ref.uuid) && notes.get(ref.uuid)!.voice === ref.voice) noteElements.set(el, notes.get(ref.uuid)!);
  }

  const read = (el: Element, sourceOf: (name: string) => { source: AttrSource; flagKey?: string }) => {
    const attrs: ReviewPlace['attrs'] = {};
    for (const a of Array.from(el.attributes)) {
      if (NOT_ANNOTATIONS.has(a.name) || a.name.startsWith('xmlns')) continue;
      attrs[a.name] = { value: a.value, ...sourceOf(a.name) };
    }
    return attrs;
  };

  // notes
  const neumeElements = new Map<Element, NoteInfo[]>();
  for (const [el, info] of noteElements) {
    const { note } = info;
    const flags = flagDefsOf(note.flags);
    places.push({
      target: 'nc', element: el.localName, anchor: note.uuid, notes: [note.uuid],
      syllableUuid: info.syllable.uuid, syllableText: info.syllable.text ?? '', voice: info.voice,
      label: `note ${note.base}${note.octave}`,
      attrs: read(el, name => {
        if (note.meiAttrs && name in note.meiAttrs) return { source: 'hand' };
        if (index.nc.get(note.uuid)?.[name] !== undefined) return { source: 'rule' };
        const flag = flags.find(f => f.mei && name in f.mei);
        return flag ? { source: 'flag', flagKey: flag.key } : { source: 'mapping' };
      })
    });
    // The element around the note is its neume, unless it is the syllable, the layer or another container of the score.
    const parent = el.parentElement;
    const parentIsSyllable = !!parent && syllables.has(uuidOfId(parent.getAttribute('xml:id') ?? '')?.uuid ?? '');
    if (parent && !parentIsSyllable && !CONTAINERS.has(parent.localName) && !noteElements.has(parent)) {
      if (!neumeElements.has(parent)) neumeElements.set(parent, []);
      neumeElements.get(parent)!.push(info);
    }
  }

  // neumes (the element around the notes of one neume: `neume`, or `ligature` in premensural notation)
  for (const [el, infos] of neumeElements) {
    const first = infos[0].neumeFirst ?? infos[0].note;
    places.push({
      target: 'neume', element: el.localName, anchor: infos[0].note.uuid, notes: infos.map(i => i.note.uuid),
      syllableUuid: infos[0].syllable.uuid, syllableText: infos[0].syllable.text ?? '', voice: infos[0].voice,
      label: `neume ${infos.map(i => i.note.base + i.note.octave).join(' ')}`,
      attrs: read(el, name => {
        if (first.meiNeumeAttrs && name in first.meiNeumeAttrs) return { source: 'hand' };
        if (index.neume.get(first.uuid)?.[name] !== undefined) return { source: 'rule' };
        return { source: 'mapping' };
      })
    });
  }

  // syllables
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const ref = uuidOfId(el.getAttribute('xml:id') ?? '');
    if (!ref || !syllables.has(ref.uuid)) continue;
    const syllable = syllables.get(ref.uuid)!;
    const inside = Array.from(el.getElementsByTagName('*')).map(c => noteElements.get(c)).filter((i): i is NoteInfo => !!i).map(i => i.note.uuid);
    if (inside.length === 0) continue;
    places.push({
      target: 'syllable', element: el.localName, anchor: inside[0], notes: inside,
      syllableUuid: syllable.uuid, syllableText: syllable.text ?? '', voice: ref.voice,
      label: `syllable "${syllable.text ?? ''}"${ref.voice > 1 ? ` (voice ${ref.voice})` : ''}`,
      attrs: read(el, name => {
        if (syllable.meiAttrs && name in syllable.meiAttrs) return { source: 'hand' };
        if (index.syllable.get(syllable.uuid)?.[name] !== undefined) return { source: 'rule' };
        return { source: 'mapping' };
      })
    });
  }

  // document order: by the position of the anchor note
  const order = new Map<string, number>([...notes.keys()].map((u, i) => [u, i]));
  places.sort((a, b) => TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) || (order.get(a.anchor) ?? 0) - (order.get(b.anchor) ?? 0));

  return { places, attributes: attributesOf(places), flags: flagsOf(flagDefs, places, notes) };
}

function attributesOf(places: ReviewPlace[]): ReviewAttribute[] {
  const byKey = new Map<string, ReviewAttribute>();
  for (const p of places) {
    for (const [name, a] of Object.entries(p.attrs)) {
      const key = `${p.target}|${p.element}|${name}`;
      let attr = byKey.get(key);
      if (!attr) { attr = { element: p.element, target: p.target, name, count: 0, values: [] }; byKey.set(key, attr); }
      attr.count++;
      let v = attr.values.find(x => x.value === a.value);
      if (!v) { v = { value: a.value, places: [], bySource: { hand: 0, rule: 0, flag: 0, mapping: 0 }, flagKeys: [] }; attr.values.push(v); }
      v.places.push(p);
      v.bySource[a.source]++;
      if (a.flagKey && !v.flagKeys.includes(a.flagKey)) v.flagKeys.push(a.flagKey);
    }
  }
  const out = [...byKey.values()];
  out.forEach(a => a.values.sort((x, y) => y.places.length - x.places.length || x.value.localeCompare(y.value)));
  out.sort((a, b) => TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) || a.element.localeCompare(b.element) || a.name.localeCompare(b.name));
  return out;
}

function flagsOf(defs: NoteFlagDef[], places: ReviewPlace[], notes: Map<string, NoteInfo>): ReviewFlag[] {
  const ncPlace = new Map(places.filter(p => p.target === 'nc').map(p => [p.anchor, p]));
  return defs.map(def => ({
    def,
    writes: flagWrites(def),
    places: [...notes.values()].filter(i => (i.note.flags ?? []).includes(def.key)).map(i => ncPlace.get(i.note.uuid)).filter((p): p is ReviewPlace => !!p)
  }));
}

/**
 * The element a lens names: only accidentals are told apart (an `<accid>` is written for the note of an accidental); every other
 * target has one kind of element per document (`nc` or `note`, `neume` or `ligature`, `syllable`). Keeping the element out of the
 * lens otherwise makes a lens chosen in the Note view the same as the one chosen in the Overview.
 */
export function lensElement(target: ReviewTarget, element: string | undefined): string | undefined {
  return target === 'nc' && element === 'accid' ? 'accid' : undefined;
}

function matches(p: ReviewPlace, target: ReviewTarget, element: string | undefined): boolean {
  if (p.target !== target) return false;
  return element ? p.element === element : !(target === 'nc' && p.element === 'accid');
}

/**
 * The places of one kind of element that do not carry the attribute (for "which notes still lack a name?"). Without `element`, the
 * accidentals are left out of the notes.
 */
export function placesWithout(review: MeiReview, attr: { target: ReviewTarget; element?: string; name: string }): ReviewPlace[] {
  return review.places.filter(p => matches(p, attr.target, attr.element) && !(attr.name in p.attrs));
}

/** What the staff highlights: a set of places, chosen in the Overview or from a row of the Note view. */
export type LensSpec =
  | { kind: 'value'; target: ReviewTarget; element?: string; name: string; value: string }
  | { kind: 'without'; target: ReviewTarget; element?: string; name: string }
  | { kind: 'flag'; key: string };

export function lensKey(s: LensSpec): string {
  return s.kind === 'flag' ? `flag|${s.key}` : `${s.kind}|${s.target}|${s.element}|${s.name}|${s.kind === 'value' ? s.value : ''}`;
}

/** Text for the lens bar, for example `type="virga" on <nc>`. */
export function lensLabel(s: LensSpec, flags: NoteFlagDef[] = []): string {
  if (s.kind === 'flag') {
    const d = flags.find(f => f.key === s.key);
    return `flag ${s.key}${d ? ` (${d.label})` : ''}`;
  }
  const el = s.element ?? s.target;
  return s.kind === 'value' ? `${s.name}="${s.value}" on <${el}>` : `<${el}> without @${s.name}`;
}

/** The places a lens shows, in document order. */
export function lensPlaces(review: MeiReview, s: LensSpec): ReviewPlace[] {
  if (s.kind === 'flag') return review.flags.find(f => f.def.key === s.key)?.places ?? [];
  if (s.kind === 'without') return placesWithout(review, s);
  return review.places.filter(p => matches(p, s.target, s.element) && p.attrs[s.name]?.value === s.value);
}

/**
 * A flag that writes exactly this attribute and value (and nothing else), so that a hand-set value can be replaced by the flag; the
 * flag then carries the meaning in the editor (its marker in the staff, its digit key, its rules) and the export writes the same.
 */
export function flagFor(name: string, value: string, defs: NoteFlagDef[]): NoteFlagDef | undefined {
  return defs.find(d => !d.meiTag && d.mei && Object.keys(d.mei).length === 1 && d.mei[name] === value);
}

/**
 * Removes a hand-set attribute from the given notes (target `nc`), from the neumes they start (target `neume`) or from their syllables
 * (target `syllable`). Returns the number of elements changed. Works on the document in place.
 */
export function removeHandAttribute(root: VM.RootContainer, target: ReviewTarget, anchors: string[], name: string, value?: string): number {
  const wanted = new Set(anchors);
  let changed = 0;
  const strip = (holder: { meiAttrs?: Record<string, string>; meiNeumeAttrs?: Record<string, string> }, key: 'meiAttrs' | 'meiNeumeAttrs') => {
    const map = holder[key];
    if (!map || !(name in map) || (value !== undefined && map[name] !== value)) return;
    delete map[name];
    if (Object.keys(map).length === 0) delete holder[key];
    changed++;
  };
  for (const syllable of VM.getSyllables(root)) {
    const voices: (VM.Spaced | undefined)[] = [syllable.notes, ...(syllable.additionalMelodies ?? [])];
    let syllableDone = false;
    for (const spaced of voices) {
      for (const neume of spaced?.spaced ?? []) {
        const all = neume.nonSpaced.flatMap(g => g.grouped);
        for (const note of all) {
          if (!wanted.has(note.uuid)) continue;
          if (target === 'nc') strip(note, 'meiAttrs');
          else if (target === 'neume' && note === all[0]) strip(note, 'meiNeumeAttrs');
          else if (target === 'syllable' && !syllableDone) { strip(syllable, 'meiAttrs'); syllableDone = true; }
        }
      }
    }
  }
  return changed;
}

/**
 * Replaces a hand-set attribute by a flag that writes the same (see flagFor): on each given note that has `name="value"` set by hand,
 * the attribute is removed and the flag is set. Returns the number of notes changed. Works on the document in place.
 */
export function replaceHandAttributeByFlag(root: VM.RootContainer, anchors: string[], name: string, value: string, flag: NoteFlagDef): number {
  const wanted = new Set(anchors);
  let changed = 0;
  for (const syllable of VM.getSyllables(root)) {
    const voices: (VM.Spaced | undefined)[] = [syllable.notes, ...(syllable.additionalMelodies ?? [])];
    for (const spaced of voices) for (const neume of spaced?.spaced ?? []) for (const g of neume.nonSpaced) for (const note of g.grouped) {
      if (!wanted.has(note.uuid) || note.meiAttrs?.[name] !== value) continue;
      delete note.meiAttrs[name];
      if (Object.keys(note.meiAttrs).length === 0) delete note.meiAttrs;
      if (!(note.flags ?? []).includes(flag.key)) note.flags = [...(note.flags ?? []), flag.key];
      changed++;
    }
  }
  return changed;
}
