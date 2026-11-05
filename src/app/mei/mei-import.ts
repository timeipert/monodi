import { v4 as UUID } from 'uuid';
import {
  BaseNote, ContainerKind, DocumentType, FormteilDataName, LinePartKind, NoteType, SyllableType,
  emptyRootContainer
} from '../types/model';
import type { FormteilContainer, Note, NonSpaced, RootContainer, Spaced, Syllable, ZeileContainer } from '../types/model';

/**
 * Reads an MEI file (MEI is the Music Encoding Initiative's XML format for music) into a Monodi-Zero document: the reverse of the MEI
 * export (`@monodi/core/mei`, `emitMei`). Two notations are read, the two that the presets of the export write:
 *
 *  - `neume`: `<syllable>` with `<syl>` and `<neume>` of `<nc>` (MEI neume notation).
 *  - `premensural`: no syllable; a `<ligature>` of `<note>`s or a single `<note>`, the text in a `<verse><syl>` of the first element of a
 *    syllable (MEI mensural notation, premensural staves).
 *
 * Voices. The staves of a section with increasing `@n` are the voices of one line: the first staff is the first voice (`notes` of a
 * syllable), the others are the additional melodies. Text and alignment follow the links of the file where it has them: `syl/@sameas`
 * (the text of another `syl`), `syllable/@corresp` (another syllable) and `neume/@synch` (an aligned neume); without links the n-th
 * syllable of a voice belongs to the n-th syllable of the first voice.
 *
 * Attributes that Monodi has no field for (`name`, `lig`, `tilt`, ...) are kept as MEI attributes set by hand (`Note.meiAttrs`, on
 * the neume `Note.meiNeumeAttrs`), so an export writes them again. State 2026-11-05.
 */
export type MeiImportFormat = 'auto' | 'neume' | 'premensural';

export interface MeiImportResult {
  root: RootContainer;
  /** The notation that was read. */
  format: 'neume' | 'premensural';
  /** Title from `fileDesc/titleStmt/title`, or an empty string. */
  title: string;
  /** Labels of the staves of the first line's voices (`staffDef/label`), in voice order. */
  voiceLabels: string[];
  /** Things the import could not carry over (unknown elements, unresolved links, ...). */
  warnings: string[];
}

const NS = 'http://www.music-encoding.org/ns/mei';
/** Attributes that become fields of Monodi and are not kept as hand-set MEI attributes. */
const STRUCTURAL = new Set(['xml:id', 'pname', 'oct', 'con', 'synch', 'sameas', 'corresp']);

/** The notation of an MEI file, from `@notationtype` of the staves or, failing that, from the elements it uses; null if neither is found. */
export function detectMeiFormat(doc: Document): 'neume' | 'premensural' | null {
  const types = Array.from(doc.getElementsByTagNameNS(NS, 'staffDef')).map(d => d.getAttribute('notationtype'));
  if (types.includes('neume')) return 'neume';
  if (types.some(t => t === 'premensural' || t === 'mensural')) return 'premensural';
  if (doc.getElementsByTagNameNS(NS, 'syllable').length > 0) return 'neume';
  if (doc.getElementsByTagNameNS(NS, 'ligature').length > 0 || doc.getElementsByTagNameNS(NS, 'verse').length > 0) return 'premensural';
  return null;
}

/** A syllable of one voice as the file has it, before the voices are put together. */
interface VoiceUnit {
  /** `xml:id` of the syllable (neume) or of the element that carries the text (premensural). */
  id?: string;
  /** `xml:id` of the `syl`. */
  sylId?: string;
  text: string;
  /** `syl/@sameas`: the `syl` this one stands for. */
  sameas?: string;
  /** `syllable/@corresp`: the syllable this one corresponds to. */
  corresp?: string;
  neumes: NonSpaced[];
  /** `xml:id` of each neume and, in a ligature, of each of its notes, mapped to the index in `neumes`. */
  neumeIds: Map<string, number>;
  /** Targets of `@synch` of the neumes. */
  synch: string[];
  meiAttrs?: Record<string, string>;
}

const ref = (v: string | null): string | undefined => (v ? v.replace(/^#/, '').split(/\s+/)[0] : undefined);

function noteFrom(el: Element, warnings: string[]): Note | null {
  const pname = (el.getAttribute('pname') ?? '').toUpperCase();
  const base = (BaseNote as Record<string, BaseNote>)[pname];
  const oct = Number(el.getAttribute('oct'));
  if (!base || !Number.isFinite(oct) || el.getAttribute('oct') === null) {
    warnings.push(`A <${el.localName}> without pitch name and octave was skipped${el.getAttribute('xml:id') ? ` (${el.getAttribute('xml:id')})` : ''}.`);
    return null;
  }
  let noteType: NoteType = NoteType.Normal;
  let liquescent = false;
  for (const c of Array.from(el.children)) {
    if (c.localName === 'oriscus') noteType = NoteType.Oriscus;
    else if (c.localName === 'quilisma') noteType = NoteType.Quilisma;
    else if (c.localName === 'strophicus') noteType = NoteType.Strophicus;
    else if (c.localName === 'liquescent') liquescent = true;
  }
  const meiAttrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (!STRUCTURAL.has(a.name) && a.name !== 'intm') meiAttrs[a.name] = a.value;
  const note: Note = { uuid: UUID(), base, octave: oct, noteType, liquescent, focus: false };
  if (Object.keys(meiAttrs).length > 0) note.meiAttrs = meiAttrs;
  return note;
}

/** The `Grouped` lists of a neume or ligature: its notes in order; `con="g"` on a note starts a new group (a gap inside the neume). */
function neumeFrom(noteEls: Element[], warnings: string[]): NonSpaced | null {
  const groups: Note[][] = [];
  for (const el of noteEls) {
    const note = noteFrom(el, warnings);
    if (!note) continue;
    if (groups.length === 0 || el.getAttribute('con') === 'g') groups.push([]);
    groups[groups.length - 1].push(note);
  }
  return groups.length > 0 ? { nonSpaced: groups.map(g => ({ grouped: g })) } : null;
}

function extraAttrs(el: Element, skip: string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (!STRUCTURAL.has(a.name) && !skip.includes(a.name)) out[a.name] = a.value;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readNeumeLayer(layer: Element, warnings: string[]): VoiceUnit[] {
  const units: VoiceUnit[] = [];
  const syllables: Element[] = [];
  const collect = (parent: Element) => {
    for (const c of Array.from(parent.children)) {
      if (c.localName === 'syllable') syllables.push(c);
      else if (c.localName === 'supplied') collect(c);
      else if (!['sb', 'pb', 'clef', 'space', 'annot'].includes(c.localName)) warnings.push(`<${c.localName}> in a layer was skipped.`);
    }
  };
  collect(layer);
  for (const s of syllables) {
    const unit: VoiceUnit = { id: s.getAttribute('xml:id') ?? undefined, text: '', corresp: ref(s.getAttribute('corresp')), neumes: [], neumeIds: new Map(), synch: [] };
    const attrs = extraAttrs(s, ['type']);
    if (attrs) unit.meiAttrs = attrs;
    for (const c of Array.from(s.children)) {
      if (c.localName === 'syl') {
        unit.text = (c.textContent ?? '').trim();
        unit.sylId = c.getAttribute('xml:id') ?? undefined;
        unit.sameas = ref(c.getAttribute('sameas'));
      } else if (c.localName === 'neume') {
        const neume = neumeFrom(Array.from(c.children).filter(n => n.localName === 'nc'), warnings);
        if (!neume) continue;
        const attrs = extraAttrs(c, []);
        if (attrs) neume.nonSpaced[0].grouped[0].meiNeumeAttrs = attrs;
        const id = c.getAttribute('xml:id');
        if (id) unit.neumeIds.set(id, unit.neumes.length);
        const synch = ref(c.getAttribute('synch'));
        if (synch) unit.synch.push(synch);
        unit.neumes.push(neume);
      } else if (c.localName !== 'accid' && c.localName !== 'gap') {
        warnings.push(`<${c.localName}> in a syllable was skipped.`);
      }
    }
    units.push(unit);
  }
  return units;
}

function readPremensuralLayer(layer: Element, warnings: string[]): VoiceUnit[] {
  const units: VoiceUnit[] = [];
  let current: VoiceUnit | undefined;
  const verseOf = (el: Element): Element | undefined => {
    const own = Array.from(el.children).find(c => c.localName === 'verse');
    if (own) return own;
    const first = Array.from(el.children).find(c => c.localName === 'note');
    return first ? Array.from(first.children).find(c => c.localName === 'verse') : undefined;
  };
  for (const el of Array.from(layer.children)) {
    if (!['ligature', 'note'].includes(el.localName)) {
      if (!['sb', 'pb', 'clef', 'space', 'annot'].includes(el.localName)) warnings.push(`<${el.localName}> in a layer was skipped.`);
      continue;
    }
    const noteEls = el.localName === 'ligature' ? Array.from(el.children).filter(c => c.localName === 'note') : [el];
    const neume = neumeFrom(noteEls, warnings);
    if (!neume) continue;
    const verse = verseOf(el);
    if (verse || !current) {
      const syl = verse && Array.from(verse.children).find(c => c.localName === 'syl');
      current = {
        id: el.getAttribute('xml:id') ?? undefined,
        sylId: syl?.getAttribute('xml:id') ?? undefined,
        text: (syl?.textContent ?? '').trim(), sameas: ref(syl?.getAttribute('sameas') ?? null),
        neumes: [], neumeIds: new Map(), synch: []
      };
      units.push(current);
    }
    const index = current.neumes.length;
    const id = el.getAttribute('xml:id');
    if (id) current.neumeIds.set(id, index);
    for (const n of noteEls) { const nid = n.getAttribute('xml:id'); if (nid) current.neumeIds.set(nid, index); }
    for (const target of [el, ...noteEls]) { const sy = ref(target.getAttribute('synch')); if (sy) { current.synch.push(sy); break; } }
    if (el.localName === 'ligature') {
      const attrs = extraAttrs(el, []);
      if (attrs) neume.nonSpaced[0].grouped[0].meiNeumeAttrs = attrs;
    }
    current.neumes.push(neume);
  }
  return units;
}

/** Index of the unit of voice 0 that voice `v`'s unit `j` belongs to; `undefined` if the file gives no link. */
function baseIndexOf(units: VoiceUnit[][], v: number, j: number): number | undefined {
  const unit = units[v][j];
  const base = units[0];
  // 1. a neume that points to a neume of the first voice
  for (const target of unit.synch) {
    const i = base.findIndex(b => b.neumeIds.has(target));
    if (i >= 0) return i;
  }
  // 2. a syllable or a syl that points to one of the first voice, or one of the first voice that points to this one
  for (const target of [unit.corresp, unit.sameas]) {
    if (!target) continue;
    const i = base.findIndex(b => b.id === target || b.sylId === target);
    if (i >= 0) return i;
  }
  const i = base.findIndex(b => (unit.id && (b.corresp === unit.id || b.sameas === unit.id)) || (unit.sylId && b.sameas === unit.sylId));
  return i >= 0 ? i : undefined;
}

export function importMei(xml: string, requested: MeiImportFormat = 'auto'): MeiImportResult {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) throw new Error('The file is not well-formed XML.');
  if (dom.documentElement.localName !== 'mei') throw new Error('The file is not an MEI file (the root element is not <mei>).');
  const body = dom.getElementsByTagNameNS(NS, 'body')[0] ?? dom.documentElement;
  const staves = Array.from(body.getElementsByTagNameNS(NS, 'staff'));
  if (staves.length === 0) throw new Error('The file has no <staff>.');

  const detected = detectMeiFormat(dom);
  const format = requested === 'auto' ? detected : requested;
  if (!format) throw new Error('The notation of the file could not be recognized: it has neither syllables nor ligatures. Choose the format.');
  const warnings: string[] = [];
  if (requested !== 'auto' && detected && detected !== requested) warnings.push(`The file looks like ${detected} notation but was read as ${requested}.`);

  // Lines: a run of staves with increasing @n (one staff per voice).
  const lines: Element[][] = [];
  let previousN = Infinity;
  for (const staff of staves) {
    const n = Number(staff.getAttribute('n') ?? '1');
    if (lines.length === 0 || n <= previousN) lines.push([]);
    lines[lines.length - 1].push(staff);
    previousN = n;
  }

  const readLayer = format === 'neume' ? readNeumeLayer : readPremensuralLayer;
  const sylTexts = new Map<string, string>();
  const parsedLines = lines.map(line => line.map(staff => {
    const layers = Array.from(staff.children).filter(c => c.localName === 'layer');
    if (layers.length > 1) warnings.push(`Staff ${staff.getAttribute('n') ?? ''} has ${layers.length} layers; only the first is read.`);
    const units = layers[0] ? readLayer(layers[0], warnings) : [];
    for (const u of units) if (u.sylId && u.text) sylTexts.set(u.sylId, u.text);
    return units;
  }));

  const formteil: FormteilContainer = {
    uuid: UUID(), kind: ContainerKind.FormteilContainer, children: [], data: [{ name: FormteilDataName.Signatur, data: '' }]
  };
  for (const voices of parsedLines) {
    const zeile: ZeileContainer = { uuid: UUID(), kind: ContainerKind.ZeileContainer, voiceCount: voices.length, children: [] };
    const base = voices[0] ?? [];
    // syllable index of the first voice for every unit of the other voices
    const placed: Map<number, NonSpaced[]>[] = voices.map(() => new Map());
    const textFrom: (string | undefined)[] = base.map(u => u.text || (u.sameas ? sylTexts.get(u.sameas) : undefined));
    const extra: { text: string; neumes: NonSpaced[]; voice: number }[] = [];
    voices.forEach((units, v) => {
      units.forEach((u, j) => {
        let i = v === 0 ? j : baseIndexOf(voices, v, j);
        if (i === undefined) {
          i = j < base.length ? j : undefined;
          if (i !== undefined && (u.sameas || u.corresp || u.synch.length > 0)) warnings.push(`A link in voice ${v + 1} (syllable ${j + 1}) points to nothing the import found; the syllables were matched by position.`);
        }
        if (i === undefined) { extra.push({ text: u.text || (u.sameas ? sylTexts.get(u.sameas) ?? '' : ''), neumes: u.neumes, voice: v }); return; }
        if (v > 0) {
          if (!textFrom[i]) textFrom[i] = u.text || (u.sameas ? sylTexts.get(u.sameas) : undefined);
        }
        placed[v].set(i, [...(placed[v].get(i) ?? []), ...u.neumes]);
      });
    });
    base.forEach((u, i) => {
      const syllable: Syllable = {
        kind: LinePartKind.Syllable, uuid: UUID(), text: textFrom[i] ?? '', syllableType: SyllableType.Normal,
        notes: { spaced: placed[0].get(i) ?? [] } as Spaced
      };
      if (u.meiAttrs) syllable.meiAttrs = u.meiAttrs;
      if (voices.length > 1) syllable.additionalMelodies = voices.slice(1).map((_, k) => ({ spaced: placed[k + 1].get(i) ?? [] }));
      if (syllable.notes.spaced.length === 0 && !(syllable.additionalMelodies ?? []).some(m => m.spaced.length > 0)) syllable.syllableType = SyllableType.WithoutNotes;
      zeile.children.push(syllable);
    });
    for (const e of extra) {
      warnings.push(`Voice ${e.voice + 1} has more syllables than the first voice; the rest were added as syllables of their own.`);
      const syllable: Syllable = { kind: LinePartKind.Syllable, uuid: UUID(), text: e.text, syllableType: SyllableType.Normal, notes: { spaced: e.voice === 0 ? e.neumes : [] } };
      if (voices.length > 1) syllable.additionalMelodies = voices.slice(1).map((_, k) => ({ spaced: k + 1 === e.voice ? e.neumes : [] }));
      zeile.children.push(syllable);
    }
    formteil.children.push(zeile);
  }

  const root = emptyRootContainer();
  root.documentType = DocumentType.Level1;
  root.children = [formteil];
  const title = (dom.getElementsByTagNameNS(NS, 'title')[0]?.textContent ?? '').trim();
  const voiceLabels = Array.from(dom.getElementsByTagNameNS(NS, 'staffDef'))
    .sort((a, b) => Number(a.getAttribute('n') ?? 0) - Number(b.getAttribute('n') ?? 0))
    .map(d => (Array.from(d.children).find(c => c.localName === 'label')?.textContent ?? '').trim());
  return { root, format, title, voiceLabels, warnings: Array.from(new Set(warnings)) };
}
