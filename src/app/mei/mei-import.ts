import { v4 as UUID } from 'uuid';
import {
  BaseNote, ContainerKind, DocumentType, FormteilDataName, LinePartKind, NoteType, SyllableType,
  emptyRootContainer
} from '../types/model';
import type { FormteilContainer, LinePart, Note, NonSpaced, RootContainer, Spaced, Syllable, ZeileContainer } from '../types/model';

/**
 * Reads an MEI file (MEI is the Music Encoding Initiative's XML format for music) into a Monodi-Zero document: the reverse of the MEI
 * export (`@monodi/core/mei`, `emitMei`). Two notations are read, the two that the presets of the export write:
 *
 *  - `neume`: `<syllable>` with `<syl>` and `<neume>` of `<nc>` (MEI neume notation).
 *  - `premensural`: no syllable; a `<ligature>` of `<note>`s or a single `<note>`, the text in a `<verse><syl>` of the first element of a
 *    syllable (MEI mensural notation, premensural staves).
 *
 * Lines and voices. The staves of a section with increasing `@n` are the voices of one line (a staff with several layers adds one voice
 * per further layer, as older exports wrote them). The first voice is the `notes` of a syllable, the others are the additional melodies.
 * Text and alignment follow the links of the file where it has them: `syl/@sameas` (the text of another `syl`), `syllable/@corresp`
 * (another syllable) and `neume/@synch` (an aligned neume); without links the n-th syllable of a voice belongs to the n-th syllable of
 * the first voice.
 *
 * What is carried over besides notes and text (all of it is what the export writes, so an export of the result reads back the same):
 * `sb` and `pb` in the first voice (line change, folio change), `clef`, `accid` (flat, natural, sharp), the stroke of a liquescent
 * note (`nc` with `intm` and `<liquescent/>` after a note: ascending / descending), `oriscus`, `quilisma`, `strophicus`, `liquescent`
 * inside an `nc`, the type of a syllable (`@type` of the syllable or `<supplied>` around it), the label of a section (signature), lines of
 * adiastematic notation (a staff of `@type="adiastematic"`: the contour `@intm` is turned into pitches one step apart).
 *
 * Attributes that Monodi has no field for (`name`, `lig`, `tilt`, ...) are kept as MEI attributes set by hand (`Note.meiAttrs`, on
 * the neume `Note.meiNeumeAttrs`), so an export writes them again. State 2026-11-05.
 */
export type MeiImportFormat = 'auto' | 'neume' | 'premensural';

export interface MeiImportStats {
  lines: number;
  syllables: number;
  voices: number;
  notes: number;
}

export interface MeiImportResult {
  root: RootContainer;
  /** The notation that was read. */
  format: 'neume' | 'premensural';
  /** Title from `fileDesc/titleStmt/title`, or an empty string. */
  title: string;
  /** Labels of the staves (`staffDef/label`), in staff order. */
  voiceLabels: string[];
  /** What the document holds, for a preview. */
  stats: MeiImportStats;
  /** Things the import could not carry over (unknown elements, unresolved links, ...). */
  warnings: string[];
}

const NS = 'http://www.music-encoding.org/ns/mei';
/** Attributes that become fields of Monodi and are not kept as hand-set MEI attributes. */
const STRUCTURAL = new Set(['xml:id', 'pname', 'oct', 'con', 'synch', 'sameas', 'corresp']);
/** Elements of a layer that carry no music of their own and are handled or ignored without a warning. */
const QUIET = new Set(['annot', 'space', 'app', 'lem', 'rdg']);
const ACCIDENTAL: Record<string, NoteType> = { f: NoteType.Flat, n: NoteType.Natural, s: NoteType.Sharp };

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
  syllableType: SyllableType;
  meiAttrs?: Record<string, string>;
}

/** What stands in a layer, in order: a syllable or something that is not one (a line change, a clef, ...). */
type LayerItem = { unit: VoiceUnit } | { part: LinePart };

/** State while the notes of one staff are read. */
interface Reading {
  warnings: string[];
  /** The staff is adiastematic: notes without pitch are contour steps (`@intm`). */
  contour: boolean;
  /** Pitch (octave * 7 + step) of the previous note of the line, for a contour. */
  previous: number | null;
}

const ref = (v: string | null): string | undefined => (v ? v.replace(/^#/, '').split(/\s+/)[0] : undefined);
const BASES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const pitchOf = (b: BaseNote, oct: number) => oct * 7 + BASES.indexOf(b);
const fromPitch = (p: number): { base: BaseNote; octave: number } => ({ base: BASES[((p % 7) + 7) % 7] as BaseNote, octave: Math.floor(p / 7) });

function newNote(base: BaseNote, octave: number, noteType: NoteType, liquescent: boolean, meiAttrs: Record<string, string>): Note {
  const note: Note = { uuid: UUID(), base, octave, noteType, liquescent, focus: false };
  if (Object.keys(meiAttrs).length > 0) note.meiAttrs = meiAttrs;
  return note;
}

function noteFrom(el: Element, reading: Reading): Note | null {
  const pname = (el.getAttribute('pname') ?? '').toUpperCase();
  let base = (BaseNote as Record<string, BaseNote>)[pname];
  let octave = Number(el.getAttribute('oct'));
  if (!base || el.getAttribute('oct') === null || !Number.isFinite(octave)) {
    if (!reading.contour) {
      reading.warnings.push(`A <${el.localName}> without pitch name and octave was skipped${el.getAttribute('xml:id') ? ` (${el.getAttribute('xml:id')})` : ''}.`);
      return null;
    }
    // adiastematic: a step up, down or level from the previous note (the first note starts at G4)
    const step = el.getAttribute('intm');
    const p = reading.previous === null ? pitchOf(BaseNote.G, 4) : reading.previous + (step === 'u' ? 1 : step === 'd' ? -1 : 0);
    ({ base, octave } = fromPitch(p));
  }
  reading.previous = pitchOf(base, octave);
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
  // The export writes a note head with a stroke up or down as `tilt="n"` or `tilt="s"` (direction of the pen stroke): read it back
  // as that note type, so the export writes it again. Any other tilt stays an attribute of the note.
  if (noteType === NoteType.Normal && (meiAttrs['tilt'] === 'n' || meiAttrs['tilt'] === 's')) {
    noteType = meiAttrs['tilt'] === 'n' ? NoteType.Ascending : NoteType.Descending;
    delete meiAttrs['tilt'];
  }
  return newNote(base, octave, noteType, liquescent, meiAttrs);
}

/** A flat, natural or sharp (`<accid accid ploc oloc>`) as a note of Monodi. */
function accidentalFrom(el: Element, reading: Reading): Note | null {
  const type = ACCIDENTAL[el.getAttribute('accid') ?? ''];
  const base = (BaseNote as Record<string, BaseNote>)[(el.getAttribute('ploc') ?? '').toUpperCase()];
  const octave = Number(el.getAttribute('oloc'));
  if (!type || !base || el.getAttribute('oloc') === null || !Number.isFinite(octave)) {
    reading.warnings.push('An <accid> without accid, ploc and oloc was skipped.');
    return null;
  }
  return newNote(base, octave, type, false, {});
}

/**
 * The notes of a neume or ligature, in order, as `Grouped` lists: `con="g"` on a note starts a new group (a gap inside the neume).
 * The stroke the export writes after a note head with a stroke (an `nc` with `intm` and `<liquescent/>` but no pitch) makes the
 * note before it ascending (`u`) or descending (`d`). `pending` are accidentals that stood before the neume; they open its first group.
 */
function neumeFrom(noteEls: Element[], reading: Reading, pending: Note[]): NonSpaced | null {
  const groups: Note[][] = [];
  let last: Note | undefined;
  for (const el of noteEls) {
    const hasPitch = el.getAttribute('pname') !== null;
    const stroke = !hasPitch && !reading.contour && el.getAttribute('intm') && Array.from(el.children).some(c => c.localName === 'liquescent');
    if (stroke && last) {
      if (last.noteType === NoteType.Normal) last.noteType = el.getAttribute('intm') === 'u' ? NoteType.Ascending : el.getAttribute('intm') === 'd' ? NoteType.Descending : NoteType.Normal;
      continue;
    }
    const note = noteFrom(el, reading);
    if (!note) continue;
    if (groups.length === 0 || el.getAttribute('con') === 'g') groups.push([]);
    groups[groups.length - 1].push(note);
    last = note;
  }
  if (groups.length === 0) return null;
  if (pending.length > 0) groups[0].unshift(...pending.splice(0));
  return { nonSpaced: groups.map(g => ({ grouped: g })) };
}

function extraAttrs(el: Element, skip: string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) if (!STRUCTURAL.has(a.name) && !skip.includes(a.name)) out[a.name] = a.value;
  return Object.keys(out).length > 0 ? out : undefined;
}

const SYLLABLE_TYPES = ['withoutNotes', 'sourceEllipsis', 'editorialEllipsis'];
const syllableTypeOf = (value: string | null, supplied?: string | null): SyllableType => {
  const v = value ?? supplied ?? '';
  return v === 'withoutNotes' ? SyllableType.WithoutNotes : v === 'sourceEllipsis' ? SyllableType.SourceEllipsis : v === 'editorialEllipsis' ? SyllableType.EditorialEllipsis : SyllableType.Normal;
};

/** A `clef` of the layer as a clef of Monodi (the line is turned back into the position the editor draws). */
function clefFrom(el: Element): LinePart {
  const shape = (el.getAttribute('shape') ?? 'C').toLowerCase();
  const base = (BaseNote as Record<string, BaseNote>)[shape.toUpperCase()] ?? BaseNote.C;
  const line = Math.min(5, Math.max(1, Number(el.getAttribute('line')) || 1));
  const steps = (line - 1) * 2;
  const octave = Math.round((steps + 4 * 7 + 2 - BASES.indexOf(base)) / 7);
  return { kind: LinePartKind.Clef, uuid: UUID(), focus: false, base, octave, shape };
}

/** An element of a layer that is not music: a line change, a folio change or a clef; null if it is none of them. */
function breakFrom(el: Element): LinePart | null {
  if (el.localName === 'sb') return { kind: LinePartKind.LineChange, uuid: UUID(), focus: false };
  if (el.localName === 'pb') return { kind: LinePartKind.FolioChange, uuid: UUID(), focus: false, text: el.getAttribute('label') ?? el.getAttribute('n') ?? '' };
  if (el.localName === 'clef') return clefFrom(el);
  return null;
}

function readNeumeLayer(layer: Element, reading: Reading): LayerItem[] {
  const items: LayerItem[] = [];
  const visit = (parent: Element, suppliedType: string | null) => {
    for (const c of Array.from(parent.children)) {
      if (c.localName === 'syllable') items.push({ unit: readNeumeSyllable(c, reading, suppliedType) });
      else if (c.localName === 'supplied') visit(c, c.getAttribute('type'));
      else {
        const part = breakFrom(c);
        if (part) items.push({ part });
        else if (!QUIET.has(c.localName)) reading.warnings.push(`<${c.localName}> in a layer was skipped.`);
      }
    }
  };
  visit(layer, null);
  return items;
}

function readNeumeSyllable(s: Element, reading: Reading, suppliedType: string | null): VoiceUnit {
  const unit: VoiceUnit = {
    id: s.getAttribute('xml:id') ?? undefined, text: '', corresp: ref(s.getAttribute('corresp')), neumes: [], neumeIds: new Map(), synch: [],
    syllableType: syllableTypeOf(s.getAttribute('type'), suppliedType)
  };
  // `@type` is the syllable type of Monodi when it is one of the values the export writes; any other value is an attribute of the syllable.
  const attrs = extraAttrs(s, SYLLABLE_TYPES.includes(s.getAttribute('type') ?? '') ? ['type'] : []);
  if (attrs) unit.meiAttrs = attrs;
  const pending: Note[] = [];
  for (const c of Array.from(s.children)) {
    if (c.localName === 'syl') {
      unit.text = (c.textContent ?? '').trim();
      unit.sylId = c.getAttribute('xml:id') ?? undefined;
      unit.sameas = ref(c.getAttribute('sameas'));
    } else if (c.localName === 'neume') {
      const neume = neumeFrom(Array.from(c.children).filter(n => n.localName === 'nc'), reading, pending);
      if (!neume) continue;
      const nAttrs = extraAttrs(c, []);
      if (nAttrs) neume.nonSpaced[0].grouped[0].meiNeumeAttrs = nAttrs;
      const id = c.getAttribute('xml:id');
      if (id) unit.neumeIds.set(id, unit.neumes.length);
      const synch = ref(c.getAttribute('synch'));
      if (synch) unit.synch.push(synch);
      unit.neumes.push(neume);
    } else if (c.localName === 'accid') {
      const a = accidentalFrom(c, reading);
      if (a) pending.push(a);
    } else if (c.localName !== 'gap') {
      reading.warnings.push(`<${c.localName}> in a syllable was skipped.`);
    }
  }
  // accidentals after the last neume belong to it
  if (pending.length > 0 && unit.neumes.length > 0) {
    const groups = unit.neumes[unit.neumes.length - 1].nonSpaced;
    groups[groups.length - 1].grouped.push(...pending);
  }
  return unit;
}

function readPremensuralLayer(layer: Element, reading: Reading): LayerItem[] {
  const items: LayerItem[] = [];
  let current: VoiceUnit | undefined;
  const pending: Note[] = [];
  const verseOf = (el: Element): Element | undefined => {
    const own = Array.from(el.children).find(c => c.localName === 'verse');
    if (own) return own;
    const first = Array.from(el.children).find(c => c.localName === 'note');
    return first ? Array.from(first.children).find(c => c.localName === 'verse') : undefined;
  };
  for (const el of Array.from(layer.children)) {
    if (el.localName === 'accid') {
      const a = accidentalFrom(el, reading);
      if (a) pending.push(a);
      continue;
    }
    if (!['ligature', 'note'].includes(el.localName)) {
      const part = breakFrom(el);
      if (part) items.push({ part });
      else if (!QUIET.has(el.localName)) reading.warnings.push(`<${el.localName}> in a layer was skipped.`);
      continue;
    }
    const noteEls = el.localName === 'ligature' ? Array.from(el.children).filter(c => c.localName === 'note') : [el];
    const neume = neumeFrom(noteEls, reading, pending);
    if (!neume) continue;
    const verse = verseOf(el);
    if (verse || !current) {
      const syl = verse && Array.from(verse.children).find(c => c.localName === 'syl');
      current = {
        id: el.getAttribute('xml:id') ?? undefined,
        sylId: syl?.getAttribute('xml:id') ?? undefined,
        text: (syl?.textContent ?? '').trim(), sameas: ref(syl?.getAttribute('sameas') ?? null),
        neumes: [], neumeIds: new Map(), synch: [], syllableType: SyllableType.Normal
      };
      items.push({ unit: current });
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
  return items;
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
  // per line: the items of every voice (a staff gives one voice per layer)
  const parsedLines = lines.map(line => {
    const contour = line[0].getAttribute('type') === 'adiastematic';
    const reading: Reading = { warnings, contour, previous: null };
    const voices: LayerItem[][] = [];
    for (const staff of line) {
      for (const layer of Array.from(staff.children).filter(c => c.localName === 'layer')) {
        reading.previous = null;
        const items = readLayer(layer, reading);
        for (const it of items) if ('unit' in it && it.unit.sylId && it.unit.text) sylTexts.set(it.unit.sylId, it.unit.text);
        voices.push(items);
      }
    }
    return { voices, contour };
  });

  const formteil: FormteilContainer = {
    uuid: UUID(), kind: ContainerKind.FormteilContainer, children: [], data: [{ name: FormteilDataName.Signatur, data: '' }]
  };
  const sectionLabel = Array.from(body.getElementsByTagNameNS(NS, 'section')).map(s => s.getAttribute('label')).find(l => !!l);
  if (sectionLabel) formteil.data = [{ name: FormteilDataName.Signatur, data: sectionLabel }];

  const stats: MeiImportStats = { lines: 0, syllables: 0, voices: 1, notes: 0 };
  for (const { voices: voiceItems, contour } of parsedLines) {
    const units: VoiceUnit[][] = voiceItems.map(items => items.filter((i): i is { unit: VoiceUnit } => 'unit' in i).map(i => i.unit));
    const zeile: ZeileContainer = { uuid: UUID(), kind: ContainerKind.ZeileContainer, voiceCount: voiceItems.length, children: [] };
    if (contour) zeile.notation = 'adiastematic';
    const base = units[0] ?? [];
    // syllable index of the first voice for every unit of the other voices
    const placed: Map<number, NonSpaced[]>[] = units.map(() => new Map());
    const textFrom: (string | undefined)[] = base.map(u => u.text || (u.sameas ? sylTexts.get(u.sameas) : undefined));
    const extra: { text: string; neumes: NonSpaced[]; voice: number }[] = [];
    units.forEach((list, v) => {
      list.forEach((u, j) => {
        let i = v === 0 ? j : baseIndexOf(units, v, j);
        if (i === undefined) {
          i = j < base.length ? j : undefined;
          if (i !== undefined && (u.sameas || u.corresp || u.synch.length > 0)) warnings.push(`A link in voice ${v + 1} (syllable ${j + 1}) points to nothing the import found; the syllables were matched by position.`);
        }
        if (i === undefined) { extra.push({ text: u.text || (u.sameas ? sylTexts.get(u.sameas) ?? '' : ''), neumes: u.neumes, voice: v }); return; }
        if (v > 0 && !textFrom[i]) textFrom[i] = u.text || (u.sameas ? sylTexts.get(u.sameas) : undefined);
        placed[v].set(i, [...(placed[v].get(i) ?? []), ...u.neumes]);
      });
    });
    const syllableAt = (i: number, u: VoiceUnit): Syllable => {
      const syllable: Syllable = {
        kind: LinePartKind.Syllable, uuid: UUID(), text: textFrom[i] ?? '', syllableType: u.syllableType,
        notes: { spaced: placed[0].get(i) ?? [] } as Spaced
      };
      if (u.meiAttrs) syllable.meiAttrs = u.meiAttrs;
      if (units.length > 1) syllable.additionalMelodies = units.slice(1).map((_, k) => ({ spaced: placed[k + 1].get(i) ?? [] }));
      const hasNotes = syllable.notes.spaced.length > 0 || (syllable.additionalMelodies ?? []).some(m => m.spaced.length > 0);
      if (!hasNotes && syllable.syllableType === SyllableType.Normal) syllable.syllableType = SyllableType.WithoutNotes;
      return syllable;
    };
    // the first voice decides the order of syllables, line changes, folio changes and clefs
    let next = 0;
    for (const item of voiceItems[0] ?? []) {
      if ('part' in item) zeile.children.push(item.part);
      else zeile.children.push(syllableAt(next, base[next++]));
    }
    for (const e of extra) {
      warnings.push(`Voice ${e.voice + 1} has more syllables than the first voice; the rest were added as syllables of their own.`);
      const syllable: Syllable = { kind: LinePartKind.Syllable, uuid: UUID(), text: e.text, syllableType: SyllableType.Normal, notes: { spaced: e.voice === 0 ? e.neumes : [] } };
      if (units.length > 1) syllable.additionalMelodies = units.slice(1).map((_, k) => ({ spaced: k + 1 === e.voice ? e.neumes : [] }));
      zeile.children.push(syllable);
    }
    for (const c of zeile.children) {
      if (c.kind !== LinePartKind.Syllable) continue;
      stats.syllables++;
      for (const voice of [c.notes, ...(c.additionalMelodies ?? [])]) for (const n of voice.spaced) for (const g of n.nonSpaced) stats.notes += g.grouped.length;
    }
    stats.lines++;
    stats.voices = Math.max(stats.voices, voiceItems.length);
    formteil.children.push(zeile);
  }

  const root = emptyRootContainer();
  root.documentType = DocumentType.Level1;
  root.children = [formteil];
  const title = (dom.getElementsByTagNameNS(NS, 'title')[0]?.textContent ?? '').trim();
  const voiceLabels = Array.from(dom.getElementsByTagNameNS(NS, 'staffDef'))
    .sort((a, b) => Number(a.getAttribute('n') ?? 0) - Number(b.getAttribute('n') ?? 0))
    .map(d => (Array.from(d.children).find(c => c.localName === 'label')?.textContent ?? '').trim());
  return { root, format, title, voiceLabels, stats, warnings: Array.from(new Set(warnings)) };
}
