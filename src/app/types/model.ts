import { flatMap, assertNever } from '../../utils';
import { v4 as UUID } from "uuid";
import * as LDP from 'lodash/fp';
import * as _ from 'lodash';

export enum ContainerKind {
  FormteilContainer = "FormteilContainer",
  MiscContainer = "MiscContainer",
  ParatextContainer = "ParatextContainer",
  RootContainer = "RootContainer",
  ZeileContainer = "ZeileContainer",
}

export type Container = FormteilContainer | MiscContainer | ParatextContainer | RootContainer | ZeileContainer;

export interface FormteilContainer {
  "kind": ContainerKind.FormteilContainer;
  uuid: string;
  children: FormteilChildren[];
  data: FormteilData[];
}

export interface MiscContainer {
  "kind": ContainerKind.MiscContainer;
  uuid: string;
  children: MiscChildren[];
}

export interface ParatextContainer {
  "kind": ContainerKind.ParatextContainer;
  uuid: string;
  text: string;
  retro: boolean;
  paratextType: ParatextType;
  comment?: ParatextComment | undefined;
}

export interface RootContainer {
  "kind": ContainerKind.RootContainer;
  uuid: string;
  children: RootChildren[];
  comments: Comment[];
  documentType: DocumentType;
  version?: number | undefined;
  globalComment?: CommentTree;
  
  // CM-Transcription-Equivalents integration
  annotationRegions?: AnnotationRegion[];
  annotationItems?: AnnotationItem[];
  equivalents?: EquivalentMetadata[];
}

export interface AnnotationRegion {
  id: string;
  name: string;
  points: string;
  folio: string;
  /** UUID of the LineChange in the transcription that this region corresponds to */
  lineUUID?: string;
}

export type TranscriptionAnnotationType = 'line' | 'note' | 'clef_c' | 'clef_f' | 'accidental_flat' | 'accidental_sharp' | 'region';

export interface TranscriptionAnnotation {
  id: string;
  folio: string;
  type: TranscriptionAnnotationType;
  points: string;
  isNeumeStart?: boolean;
  graphicalConnection?: 'looped' | 'gaped';
}

export interface AnnotationItem {
  id: string;
  regionId: string;
  pattern: string;  // base pattern, e.g. "Virga"
  variant?: string; // variant letter, e.g. "a", "b" — combined display is "Virga a"
  points: string;   // percentage-based polygon points
  uuid?: string;    // Reference to the NonSpaced UUID
}

export interface EquivalentMetadata {
  pattern: string;
  refId: string;
  notes?: string;
}

export interface ZeileContainer {
  "kind": ContainerKind.ZeileContainer;
  uuid: string;
  voiceCount?: number;
  children: LinePart[];
}

export type RootChildren = FormteilContainer | MiscContainer | ZeileContainer | ParatextContainer;

export type FormteilChildren = ZeileContainer | ParatextContainer | FormteilContainer;

export type MiscChildren = ZeileContainer | ParatextContainer;

export enum ParatextType {
  Aufführung = "Aufführung",
  Feier = "Feier",
  Festtag = "Festtag",
  Formteil = "Formteil",
  Gesang = "Gesang",
  Melodiename = "Melodiename",
  Zuschreibung = "Zuschreibung",
}

export enum DocumentType {
  Level0 = "Level0",
  Level1 = "Level1",
  Level2 = "Level2",
  Level3 = "Level3",
}

export interface FormteilData {
  name: FormteilDataName;
  data: string;
}

export enum FormteilDataName {
  LemmatisiertesTextInitium = "LemmatisiertesTextInitium",
  Signatur = "Signatur",
  Status = "Status",
  Verweis = "Verweis",
}

export interface Comment {
  startUUID: string;
  endUUID: string;
  commentType?: 'text' | 'lines' | 'tree';
  text: string;
  emendation?: boolean;
  lines?: FormteilChildren[];
  tree?: CommentTree;
  category?: 'variant' | 'scribal' | 'liturgical' | 'commentary' | 'bibliography' | 'second_voice';
  readingWitnesses?: string[];
  intervention?: 'correction' | 'unclear' | 'supplied' | 'addition' | 'deletion' | 'damage';
  certainty?: 'high' | 'medium' | 'low';
}

export interface ParatextComment {
  emendation: boolean;
  comment: string;
  alternativeText: string;
  tree?: CommentTree;
}

export enum NoteType {
  Ascending = "Ascending",
  Descending = "Descending",
  Flat = "Flat",
  Liquescent = "Liquescent",
  Natural = "Natural",
  Normal = "Normal",
  Oriscus = "Oriscus",
  Quilisma = "Quilisma",
  Sharp = "Sharp",
  Strophicus = "Strophicus",
}

export enum BaseNote {
  A = "A",
  B = "B",
  C = "C",
  D = "D",
  E = "E",
  F = "F",
  G = "G",
}

export interface Note {
  uuid: string;
  noteType: NoteType;
  base: BaseNote;
  liquescent: boolean;
  octave: number;
  focus: boolean;
  isLatent?: boolean;
}

export interface Spaced {
  spaced: NonSpaced[];
}

export interface NonSpaced {
  nonSpaced: Grouped[];
}

export interface Grouped {
  grouped: Note[];
}

export enum LinePartKind {
  Box = "Box",
  Clef = "Clef",
  FolioChange = "FolioChange",
  LineChange = "LineChange",
  Syllable = "Syllable",
}

export enum CommentPartKind {
  Note = "Note",
  Syllable = "Syllable",
  LineChange = "LineChange",
  FolioChange = "FolioChange"
}

export type LinePart = Box | Clef | FolioChange | LineChange | Syllable;

export interface Box {
  "kind": LinePartKind.Box;
  uuid: string;
  focus: boolean;
}

export interface Clef {
  "kind": LinePartKind.Clef;
  uuid: string;
  focus: boolean;
  base: BaseNote;
  octave: number;
  shape: string;
}

export interface FolioChange {
  "kind": LinePartKind.FolioChange;
  uuid: string;
  focus: boolean;
  text: string;
}

export interface LineChange {
  "kind": LinePartKind.LineChange;
  uuid: string;
  focus: boolean;
}

export interface Syllable {
  "kind": LinePartKind.Syllable;
  uuid: string;
  text: string;
  notes: Spaced;
  additionalMelodies?: Spaced[];
  syllableType: SyllableType;
}

export enum SyllableType {
  EditorialEllipsis = "EditorialEllipsis",
  Normal = "Normal",
  SourceEllipsis = "SourceEllipsis",
  WithoutNotes = "WithoutNotes",
}

export function isOfFormteilContainer(x: any): boolean {
  return x['kind'] === ContainerKind.FormteilContainer && typeof (x['uuid']) === 'string' && x['children'].filter((x: any) => { return isOfFormteilChildren(x); }).length === x['children'].length && x['data'].filter((x: any) => { return isOfFormteilData(x); }).length === x['data'].length;
}

export function isOfMiscContainer(x: any): boolean {
  return x['kind'] === ContainerKind.MiscContainer && typeof (x['uuid']) === 'string' && x['children'].filter((x: any) => { return isOfMiscChildren(x); }).length === x['children'].length;
}

export function isOfParatextContainer(x: any): boolean {
  return x['kind'] === ContainerKind.ParatextContainer && typeof (x['uuid']) === 'string' && typeof (x['text']) === 'string' && typeof (x['retro']) === 'boolean' && isOfParatextType(x['paratextType']) && (x['comment'] === undefined || isOfParatextComment(x['comment']));
}

export function isOfRootContainer(x: any): boolean {
  return x['kind'] === ContainerKind.RootContainer && typeof (x['uuid']) === 'string' && x['children'].filter((x: any) => { return isOfRootChildren(x); }).length === x['children'].length && x['comments'].filter((x: any) => { return isOfComment(x); }).length === x['comments'].length && isOfDocumentType(x['documentType']) && (x['version'] === undefined || typeof (x['version']) === 'number');
}

export function isOfZeileContainer(x: any): boolean {
  return x['kind'] === ContainerKind.ZeileContainer && typeof (x['uuid']) === 'string' && x['children'].filter((x: any) => { return isOfLinePart(x); }).length === x['children'].length;
}

export function isOfContainer(x: any): boolean {
  return isOfFormteilContainer(x) || isOfMiscContainer(x) || isOfParatextContainer(x) || isOfRootContainer(x) || isOfZeileContainer(x);
}

export function isOfRootChildren(x: any): boolean {
  return isOfFormteilContainer(x) || isOfMiscContainer(x) || isOfZeileContainer(x) || isOfParatextContainer(x);
}

export function isOfFormteilChildren(x: any): boolean {
  return isOfZeileContainer(x) || isOfParatextContainer(x) || isOfFormteilContainer(x);
}

export function isOfMiscChildren(x: any): boolean {
  return isOfZeileContainer(x) || isOfParatextContainer(x);
}

export function isOfParatextType(x: any): boolean {
  return x === 'Aufführung' || x === 'Feier' || x === 'Festtag' || x === 'Formteil' || x === 'Gesang';
}

export function isOfDocumentType(x: any): boolean {
  return x === 'Level0' || x === 'Level1' || x === 'Level2' || x === 'Level3';
}

export function isOfFormteilData(x: any): boolean {
  return isOfFormteilDataName(x['name']) && typeof (x['data']) === 'string';
}

export function isOfFormteilDataName(x: any): boolean {
  return x === 'LemmatisiertesTextInitium' || x === 'Signatur' || x === 'Status' || x === 'Verweis';
}

export function isOfComment(x: any): boolean {
  return typeof (x['startUUID']) === 'string' &&
    typeof (x['endUUID']) === 'string' &&
    typeof (x['text']) === 'string' &&
    (x['emendation'] === undefined || typeof (x['emendation']) === 'boolean') &&
    (x['line'] === undefined || isOfZeileContainer(x['line'])) &&
    (x['category'] === undefined || x['category'] === 'variant' || x['category'] === 'scribal' || x['category'] === 'liturgical' || x['category'] === 'commentary' || x['category'] === 'bibliography') &&
    (x['readingWitnesses'] === undefined || (Array.isArray(x['readingWitnesses']) && x['readingWitnesses'].every((y: any) => typeof y === 'string'))) &&
    (x['intervention'] === undefined || x['intervention'] === 'correction' || x['intervention'] === 'unclear' || x['intervention'] === 'supplied' || x['intervention'] === 'addition' || x['intervention'] === 'deletion' || x['intervention'] === 'damage') &&
    (x['certainty'] === undefined || x['certainty'] === 'high' || x['certainty'] === 'medium' || x['certainty'] === 'low');
}

export function isOfParatextComment(x: any): boolean {
  return typeof (x['emendation']) === 'boolean' && typeof (x['comment']) === 'string' && typeof (x['alternativeText']) === 'string';
}

export function isOfNoteType(x: any): boolean {
  return x === 'Ascending' || x === 'Descending' || x === 'Flat' || x === 'Liquescent' || x === 'Natural' || x === 'Normal' || x === 'Oriscus' || x === 'Quilisma' || x === 'Sharp' || x === 'Strophicus';
}

export function isOfBaseNote(x: any): boolean {
  return x === 'A' || x === 'B' || x === 'C' || x === 'D' || x === 'E' || x === 'F' || x === 'G';
}

export function isOfNote(x: any): boolean {
  return typeof (x['uuid']) === 'string' && isOfNoteType(x['noteType']) && isOfBaseNote(x['base']) && typeof (x['liquescent']) === 'boolean' && typeof (x['octave']) === 'number' && typeof (x['focus']) === 'boolean';
}

export function isOfSpaced(x: any): boolean {
  return x['spaced'].filter((x: any) => { return isOfNonSpaced(x); }).length === x['spaced'].length;
}

export function isOfNonSpaced(x: any): boolean {
  return x['nonSpaced'].filter((x: any) => { return isOfGrouped(x); }).length === x['nonSpaced'].length;
}

export function isOfGrouped(x: any): boolean {
  return x['grouped'].filter((x: any) => { return isOfNote(x); }).length === x['grouped'].length;
}

export function isOfClef(x: any): boolean {
  return x['kind'] === LinePartKind.Clef && typeof (x['uuid']) === 'string' && typeof (x['focus']) === 'boolean' && isOfBaseNote(x['base']) && typeof (x['octave']) === 'number' && typeof (x['shape']) === 'string';
}

export function isOfFolioChange(x: any): boolean {
  return x['kind'] === LinePartKind.FolioChange && typeof (x['uuid']) === 'string' && typeof (x['focus']) === 'boolean' && typeof (x['text']) === 'string';
}

export function isOfLineChange(x: any): boolean {
  return x['kind'] === LinePartKind.LineChange && typeof (x['uuid']) === 'string' && typeof (x['focus']) === 'boolean';
}

export function isOfSyllable(x: any): boolean {
  return x['kind'] === LinePartKind.Syllable && typeof (x['uuid']) === 'string' && typeof (x['text']) === 'string' && isOfSpaced(x['notes']) && isOfSyllableType(x['syllableType']);
}

export function isOfLinePart(x: any): boolean {
  return isOfClef(x) || isOfFolioChange(x) || isOfLineChange(x) || isOfSyllable(x);
}

export function isOfSyllableType(x: any): boolean {
  return x === 'EditorialEllipsis' || x === 'Normal' || x === 'SourceEllipsis' || x === 'WithoutNotes';
}



















type BaseNoteIndexes = {
  [BN in keyof typeof BaseNote]: number
}

export const baseNoteIndexes: BaseNoteIndexes = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

export const baseNotes: Array<BaseNote> = (() => {
  const tmp: BaseNote[] = [];

  for (let note in BaseNote) {
    tmp.push(note as BaseNote);
  }
  return tmp.sort((a, b) => baseNoteIndexes[a] - baseNoteIndexes[b])
})()

export function nextNotePart(octave: number, baseNote: BaseNote): [number, BaseNote] {
  let index = baseNotes.indexOf(baseNote);

  if (index === baseNotes.length - 1) {
    octave++;
  }

  let base = baseNotes[(index + 1) % baseNotes.length];

  return [octave, base]
}

export function nextNote(note: Note): Note {
  const [octave, base] = nextNotePart(note.octave, note.base);

  return {
    uuid: note.uuid,
    base: base,
    noteType: note.noteType,
    liquescent: note.liquescent,
    octave: octave,
    focus: note.focus
  }
}

export function previousNotePart(octave: number, baseNote: BaseNote): [number, BaseNote] {
  const index = baseNotes.indexOf(baseNote);

  if (index === 0) {
    octave--;
  }

  let base = baseNotes[(index - 1 + baseNotes.length) % baseNotes.length];

  return [octave, base];
}

export function previousNote(note: Note): Note {
  const [octave, base] = previousNotePart(note.octave, note.base);

  return {
    uuid: note.uuid,
    base: base,
    noteType: note.noteType,
    liquescent: note.liquescent,
    octave: octave,
    focus: note.focus
  }
}

export function comparePositions(octaveA: number, noteA: BaseNote, octaveB: number, noteB: BaseNote): number {
  return (octaveA * 7 + baseNoteIndexes[noteA]) - (octaveB * 7 + baseNoteIndexes[noteB]);
}

export function emptyRootContainer(): RootContainer {
  return {
    comments: [],
    uuid: UUID(),
    kind: ContainerKind.RootContainer,
    children: [],
    documentType: DocumentType.Level1
  };
}

export function emptyFormteilContainer(d: DocumentType, zipper: number[]): FormteilContainer {
  return {
    uuid: UUID(),
    kind: ContainerKind.FormteilContainer,
    children: [],
    data: [
      {
        name: FormteilDataName.Signatur,
        data: ""
      }
    ]
  };
}

export function createNestedFormteilContainer(d: DocumentType, currentDepth: number): FormteilContainer {
  const container = emptyFormteilContainer(d, []);
  const targetLevel = d === 'Level0' ? 0 : (parseInt(d.replace(/level/i, ''), 10) || 0);
  if (currentDepth < targetLevel) {
    const child = createNestedFormteilContainer(d, currentDepth + 1);
    container.children = [child];
  }
  return container;
}

export function emptyParatextContainer(): ParatextContainer {
  return {
    uuid: UUID(),
    kind: ContainerKind.ParatextContainer,
    text: "",
    retro: false,
    paratextType: ParatextType.Formteil,
  };
}

export function emptyZeileContainer(voiceCount: number = 1): ZeileContainer {
  return {
    uuid: UUID(),
    kind: ContainerKind.ZeileContainer,
    voiceCount: voiceCount,
    children: [emptySyllable(voiceCount)]
  };
}

/**
 * Turn every direct ZeileContainer child of a container into a single merged
 * line, keeping the original manuscript line breaks as inline LineChange markers
 * ("|") at the end of each former line. Mutates the container in place.
 *
 * Purpose: an ommr4all import makes one ZeileContainer per manuscript line, but
 * the editor wants a single editorial line to re-split by their own criteria
 * while the manuscript line breaks stay visible as "|".
 *
 * Returns the number of lines merged (0 if there was nothing to merge).
 */
export function mergeZeilenWithLineChanges(container: { children: any[] }): number {
  const children = container.children;
  const zeileIdxs: number[] = [];
  for (let i = 0; i < children.length; i++) {
    if (children[i] && children[i].kind === ContainerKind.ZeileContainer) zeileIdxs.push(i);
  }
  if (zeileIdxs.length === 0) return 0;

  const mergedParts: LinePart[] = [];
  for (const idx of zeileIdxs) {
    const z = children[idx] as ZeileContainer;
    mergedParts.push(...(z.children || []));
    mergedParts.push({ kind: LinePartKind.LineChange, uuid: UUID(), focus: false });
  }

  // Reuse the first ZeileContainer as the merged line; drop the rest.
  (children[zeileIdxs[0]] as ZeileContainer).children = mergedParts;
  for (let k = zeileIdxs.length - 1; k >= 1; k--) {
    children.splice(zeileIdxs[k], 1);
  }
  return zeileIdxs.length;
}

export function emptySyllable(voiceCount: number = 1): Syllable {
  const notes = {
    spaced: [{
      nonSpaced: [{
        grouped: [{
          uuid: UUID(),
          base: BaseNote.A,
          liquescent: false,
          noteType: NoteType.Normal,
          octave: 4,
          focus: false
        }]
      }]
    }]
  };
  const additionalMelodies: Spaced[] = [];
  for (let i = 1; i < voiceCount; i++) {
    additionalMelodies.push(JSON.parse(JSON.stringify(notes)));
  }
  return {
    uuid: UUID(),
    kind: LinePartKind.Syllable,
    text: "",
    syllableType: SyllableType.Normal,
    notes: notes,
    additionalMelodies: additionalMelodies.length > 0 ? additionalMelodies : undefined
  };
}

export function trueEmptySyllable(voiceCount: number = 1): Syllable {
  const notes = {
    spaced: [{
      nonSpaced: [{
        grouped: []
      }]
    }]
  };
  const additionalMelodies: Spaced[] = [];
  for (let i = 1; i < voiceCount; i++) {
    additionalMelodies.push(JSON.parse(JSON.stringify(notes)));
  }
  return {
    uuid: UUID(),
    kind: LinePartKind.Syllable,
    text: "",
    syllableType: SyllableType.Normal,
    notes: notes,
    additionalMelodies: additionalMelodies.length > 0 ? additionalMelodies : undefined
  };
}

export function copyNote(n: Note): Note {
  return {
    uuid: UUID(),
    base: n.base,
    liquescent: n.liquescent,
    noteType: n.noteType,
    octave: n.octave,
    focus: false
  };

}


export function emptyLineChange(): LineChange {
  return {
    uuid: UUID(),
    kind: LinePartKind.LineChange,
    focus: false,
  };
}

export function emptyFolioChange(): FolioChange {
  return {
    uuid: UUID(),
    kind: LinePartKind.FolioChange,
    focus: false,
    text: "",
  };
}

export function emptyBox(): Box {
  return {
    uuid: UUID(),
    kind: LinePartKind.Box,
    focus: false,
  };
}

export function emptyClef(): Clef {
  return {
    uuid: UUID(),
    kind: LinePartKind.Clef,
    focus: false,
    base: BaseNote.A,
    octave: 4,
    shape: "F"
  };
}

export function allNotes(s: Spaced): Note[] {
  return flatMap(s.spaced, a => flatMap(a.nonSpaced, b => b.grouped));
}

export function focusLast(s: Spaced): void {
  allNotes(s).forEach((n, i, c) => n.focus = i === c.length - 1);
}

export function focusFirst(s: Spaced): void {
  allNotes(s).forEach((n, i, c) => n.focus = i === 0);
}

export function focusOne(s: Spaced, note: Note): void {
  for (let n of allNotes(s)) {
    n.focus = n.uuid === note.uuid;
  }
}

export function getFocusedPath(s: Spaced): [Spaced, NonSpaced, Grouped, Note] | undefined {
  for (const ns of s.spaced) {
    for (const gr of ns.nonSpaced) {
      for (const n of gr.grouped) {
        if (n.focus) {
          return [s, ns, gr, n];
        }
      }
    }
  }

  return undefined;
}

export function getFocused(s: Spaced): Note | undefined {
  return allNotes(s).find(n => n.focus);
}

export function getLeftOf(s: Spaced, reference: Note): Note | undefined {
  return allNotes(s).find((_, i, c) => i < c.length - 1 && c[i + 1] === reference);
}

export function getRightOf(s: Spaced, reference: Note): Note | undefined {
  return allNotes(s).find((_, i, c) => i > 0 && c[i - 1] === reference);
}

export function copyUuids(s1: Spaced, s2: Spaced): UUIDInfo {
  const n1 = allNotes(s1);
  const n2 = allNotes(s2);
  const lostUuids: string[] = [];

  for (let i = 0; i < n1.length; i++) {
    if (i < n2.length) {
      n2[i].uuid = n1[i].uuid;
    } else {
      lostUuids.push(n1[i].uuid);
    }
  }

  const fallback: string | undefined = n2.length > 0 ? n2[n2.length - 1].uuid : undefined;

  return {
    lostUUIDs: lostUuids,
    fallbackUUID: fallback,
  };
}

export interface UUIDInfo {
  lostUUIDs: string[];
  fallbackUUID: string | undefined;
}

export function splitGroup(g: Grouped, n: Note): [Grouped, Grouped, Grouped] {
  const notesBefore = g.grouped.slice(0, g.grouped.indexOf(n) + 1);
  const notesAfter = g.grouped.slice(g.grouped.indexOf(n) + 1);

  return [
    { grouped: notesBefore },
    { grouped: [n] },
    { grouped: notesAfter },
  ];
}

export function splitNonSpaced(ns: NonSpaced, g: Grouped): [NonSpaced, NonSpaced, NonSpaced] {
  const groupsBefore = ns.nonSpaced.slice(0, ns.nonSpaced.indexOf(g) + 1);
  const groupsAfter = ns.nonSpaced.slice(ns.nonSpaced.indexOf(g) + 1);

  return [
    { nonSpaced: groupsBefore },
    { nonSpaced: [g] },
    { nonSpaced: groupsAfter },
  ];
}

export function resolve(c: Container, zipper: number[]): Container | undefined {
  const children = getContainerChildren(c);

  if (zipper.length === 0) {
    return c;
  } else {
    if (children[zipper[0]] !== undefined) {
      return resolve(children[zipper[0]], zipper.slice(1));
    }
  }
}

export function getContainerChildren(c: Container): Container[] {
  switch (c.kind) {
    case ContainerKind.RootContainer: return c.children;
    case ContainerKind.FormteilContainer: return c.children;
    case ContainerKind.ParatextContainer: return [];
    case ContainerKind.ZeileContainer: return [];
    case ContainerKind.MiscContainer: return c.children;
    default: return assertNever(c);
  }
}

export function move(root: RootContainer, movedZ: number[], afterZ: number[]): string | undefined {
  const moved = resolve(root, movedZ);
  const after = resolve(root, afterZ);
  if (!moved || !after) {
    return "The given paths do not point to containers.";
  }

  const movedDepth = movedZ.length;
  const afterDepth = afterZ.length;

  if (after === moved) { return "An item cannot be moved onto itself."; }

  switch (after.kind) {
    case ContainerKind.RootContainer: switch (moved.kind) {
      case ContainerKind.RootContainer: return "The Edition unit cannot be moved.";
      case ContainerKind.FormteilContainer: if (movedDepth === 1) {
        root.children.splice(root.children.indexOf(moved), 1);
        root.children.unshift(moved); return undefined;
      } else {
        return "This operation would violate the hierarchy levels. Please create containers manually and then drag the item into the appropriate container.";
      }
      case ContainerKind.ParatextContainer: return "A paratext can only be dragged into a Formteil.";
      case ContainerKind.ZeileContainer: return "A line can only be dragged into a Formteil.";
      case ContainerKind.MiscContainer: return "The Misc container cannot be moved.";
      default: return assertNever(moved);
    }
    case ContainerKind.FormteilContainer: switch (moved.kind) {
      case ContainerKind.RootContainer: return "The Edition unit cannot be moved.";
      case ContainerKind.FormteilContainer: {
        if (afterDepth === movedDepth - 1) {
          remove(root, moved);
          after.children.unshift(moved);
          return undefined;
        } else if (afterDepth === movedDepth) {
          remove(root, moved);
          const parent = parentOf(root, after);
          const children = getContainerChildren(parent!);
          const afterIndex = children.indexOf(after);
          children.splice(afterIndex + 1, 0, moved);
          return undefined;
        } else {
          return "This operation would violate the hierarchy levels. Please create containers manually and then drag the item into the appropriate container.";
        }
      }
      case ContainerKind.ParatextContainer: remove(root, moved); after.children.unshift(moved); return undefined;
      case ContainerKind.ZeileContainer: {
        const docStruct = getStructure(root.documentType);
        const limit = docStruct[afterZ.length - 1];
        if (limit && limit.canHaveLines) {
          remove(root, moved);
          after.children.unshift(moved);
          return undefined;
        } else {
          return "In Edition units of this type, no note lines can be moved to this level. Please create additional intermediate containers and drop the lines there.";
        }
      }
      case ContainerKind.MiscContainer: return "The Misc container cannot be moved.";
      default: return assertNever(moved);
    }
    case ContainerKind.ZeileContainer: switch (moved.kind) {
      case ContainerKind.RootContainer: return "The Edition unit cannot be moved.";
      case ContainerKind.FormteilContainer: return "A Formteil cannot be inserted after a line.";
      case ContainerKind.ParatextContainer: { remove(root, moved); const parent = parentOf(root, after); getContainerChildren(parent!).splice(getContainerChildren(parent!).indexOf(after) + 1, 0, moved); return undefined; }
      case ContainerKind.ZeileContainer: { remove(root, moved); const parent = parentOf(root, after); getContainerChildren(parent!).splice(getContainerChildren(parent!).indexOf(after) + 1, 0, moved); return undefined; }
      case ContainerKind.MiscContainer: return "The Misc container cannot be moved.";
      default: return assertNever(moved);
    }
    case ContainerKind.ParatextContainer: switch (moved.kind) {
      case ContainerKind.RootContainer: return "The Edition unit cannot be moved.";
      case ContainerKind.FormteilContainer: {
        if (afterZ.length === movedZ.length) {
          remove(root, moved);
          const parent = parentOf(root, after);
          const children = getContainerChildren(parent!);
          children.splice(children.indexOf(after) + 1, 0, moved);
          return undefined;
        } else {
          return "This operation would violate the hierarchy levels.";
        }
      }
      case ContainerKind.ParatextContainer: { remove(root, moved); const parent = parentOf(root, after); getContainerChildren(parent!).splice(getContainerChildren(parent!).indexOf(after) + 1, 0, moved); return undefined; }
      case ContainerKind.ZeileContainer: { remove(root, moved); const parent = parentOf(root, after); getContainerChildren(parent!).splice(getContainerChildren(parent!).indexOf(after) + 1, 0, moved); return undefined; }
      case ContainerKind.MiscContainer: return "The Misc container cannot be moved.";
      default: return assertNever(moved);
    }
    case ContainerKind.MiscContainer: switch (moved.kind) {
      case ContainerKind.RootContainer: return "The Edition unit cannot be moved.";
      case ContainerKind.FormteilContainer: return "Der Misc-Container kann keine Formteile enthalten";
      case ContainerKind.ParatextContainer: remove(root, moved); after.children.unshift(moved); return undefined;
      case ContainerKind.ZeileContainer: {
        remove(root, moved);
        after.children.unshift(moved);
        return undefined;
      }
      case ContainerKind.MiscContainer: return "The Misc container cannot be moved.";
      default: return assertNever(moved);
    }
    default: assertNever(after);
  }
}

export function parentOf(root: Container, child: Container): Container | undefined {
  const children = getContainerChildren(root);
  if (children.find(c => c === child)) {
    return root;
  } else {
    for (const subContainer of children) {
      const result = parentOf(subContainer, child);
      if (result !== undefined) {
        return result;
      }
    }
  }
}

export function remove(from: Container, toRemove: Container): void {
  const children = getContainerChildren(from);
  const childIndex = children.indexOf(toRemove);
  if (childIndex != -1) {
    children.splice(childIndex, 1);
  } else {
    for (const child of children) {
      remove(child, toRemove);
    }
  }
}

export function noteTypeFromString(s: string): NoteType | undefined {
  const index: { [key: string]: NoteType } = {
    "-": NoteType.Normal,
    "a": NoteType.Ascending,
    "d": NoteType.Descending,
    "o": NoteType.Oriscus,
    "q": NoteType.Quilisma,
    ",": NoteType.Strophicus,
    "f": NoteType.Flat,
    "n": NoteType.Natural,
    "s": NoteType.Sharp,
  };

  return index[s];
}

export function noteTypeToString(n: NoteType): string {
  const index: { [key: string]: string } = {
    'Normal': "-",
    'Ascending': "a",
    'Descending': "d",
    'Oriscus': "o",
    'Quilisma': "q",
    'Strophicus': ",",
    'Flat': 'f',
    'Natural': 'n',
    'Sharp': 's',
  };

  return index[n];
}

export function removeFocus(c: RootContainer): void {
  const traverse = (node: any) => {
    if (node.kind === ContainerKind.ZeileContainer) {
      for (const part of node.children) {
        removeFocusFromLinePart(part);
      }
    } else if (node.children) {
      node.children.forEach(traverse);
    }
  };
  c.children.forEach(traverse);
}

export function removeFocusFromLinePart(lp: LinePart) {
  switch (lp.kind) {
    case LinePartKind.FolioChange: lp.focus = false; break;
    case LinePartKind.LineChange: lp.focus = false; break;
    case LinePartKind.Syllable: removeFocusFromSyllable(lp); break;
    case LinePartKind.Clef: lp.focus = false; break;
    case LinePartKind.Box: lp.focus = false; break;
    default: assertNever(lp);
  }
}

export function removeFocusFromSyllable(s: Syllable) {
  allNotes(s.notes).forEach(n => { n.focus = false });
}

export function removeStaleComments(r: RootContainer): void {
  let allUUIDs: string[] = getAllCommentableUUIDs(r);
  r.comments = r.comments.filter(c => allUUIDs.find(u => c.startUUID === u) && allUUIDs.find(u => c.endUUID === u));
}

export function getAllCommentableUUIDs(c: Container): string[] {
  switch (c.kind) {
    case ContainerKind.RootContainer:
    case ContainerKind.FormteilContainer:
    case ContainerKind.MiscContainer: return LDP.flatMap(getAllCommentableUUIDs)(c.children);
    case ContainerKind.ParatextContainer: return [];
    case ContainerKind.ZeileContainer: return LDP.flatMap(getCommentableUUIDsOfLinePart)(c.children);
    default: return assertNever(c);
  }
}

export function getCommentableUUIDsOfLinePart(lp: LinePart): string[] {
  switch (lp.kind) {
    case LinePartKind.FolioChange: return [lp.uuid];
    case LinePartKind.LineChange: return [lp.uuid];
    case LinePartKind.Syllable: {
      let t: string[] = allNotes(lp.notes).map(n => n.uuid);
      t.unshift(lp.uuid);
      return t;
    }
    case LinePartKind.Clef: return [lp.uuid];
    case LinePartKind.Box: return [];
    default: return assertNever(lp);
  }
}

export function getSyllables(c: Container): Syllable[] {
  const forChildren = LDP.flatMap(getSyllables);
  switch (c.kind) {
    case ContainerKind.RootContainer: return forChildren(c.children);
    case ContainerKind.FormteilContainer: return forChildren(c.children);
    case ContainerKind.ParatextContainer: return [];
    case ContainerKind.ZeileContainer: return flatMap(c.children, lp => (lp.kind === LinePartKind.Syllable ? [lp] : []));
    case ContainerKind.MiscContainer: return forChildren(c.children);
    default: return assertNever(c);
  }
}

export function linePartContainsComments(lp: LinePart, cs: Comment[]): boolean {
  let allUUIDs: string[] = getCommentableUUIDsOfLinePart(lp);

  return !!flatMap(cs, c => [c.startUUID, c.endUUID]).find(uuid => allUUIDs.indexOf(uuid) !== -1);
}

export type StructureHead = {
  [kind in DocumentType]: FormteilDescription[]
}

export interface FormteilDescription {
  canHaveLines: Boolean;
  name: string;
}

export const structure: StructureHead = {
  Level0: [],
  Level1: [
    {
      canHaveLines: true,
      name: "L1"
    }
  ],
  Level2: [
    {
      canHaveLines: false,
      name: "L1",
    },
    {
      canHaveLines: true,
      name: "L2"
    }
  ],
  Level3: [
    {
      canHaveLines: false,
      name: "L1",
    },
    {
      canHaveLines: false,
      name: "L2",
    },
    {
      canHaveLines: true,
      name: "L3",
    }
  ]
}

export function getStructure(docType: any): FormteilDescription[] {
  if (!docType) {
    return structure.Level1;
  }
  const normalized = Object.keys(structure).find(
    k => k.toLowerCase() === String(docType).toLowerCase()
  ) as DocumentType | undefined;

  if (normalized && structure[normalized]) {
    return structure[normalized];
  }
  return structure.Level1;
}

export function print(c: Container, indent: string): void {
  switch (c.kind) {
    case ContainerKind.RootContainer:
      console.log(indent + "root");
      for (let child of c.children) {
        print(child, indent + "  ");
      }
      break;
    case ContainerKind.FormteilContainer:
      console.log(indent + "formteil");
      for (let child of c.children) {
        print(child, indent + "  ");
      }
      break;
    case ContainerKind.ParatextContainer: console.log(indent + "para"); break;
    case ContainerKind.ZeileContainer: console.log(indent + "zeile"); break;
  }
}

export function getUUID(x: Container | Note | LinePart): string {
  return x.uuid;
}

//modifies in place
export function unsafeGenerateNewUUIDs(c: Container): void {
  c.uuid = UUID();

  switch (c.kind) {
    case ContainerKind.RootContainer: c.children.forEach(unsafeGenerateNewUUIDs); break;
    case ContainerKind.FormteilContainer: c.children.forEach(unsafeGenerateNewUUIDs); break;
    case ContainerKind.ParatextContainer: break;
    case ContainerKind.MiscContainer: c.children.forEach(unsafeGenerateNewUUIDs); break;
    case ContainerKind.ZeileContainer: c.children.forEach(unsafeGenerateNewUUIDsForLinePart); break;
    default: assertNever(c);
  }
}

//modifies in place
export function unsafeGenerateNewUUIDsForLinePart(l: LinePart): void {
  l.uuid = UUID();

  switch (l.kind) {
    case LinePartKind.FolioChange: break;
    case LinePartKind.LineChange: break;
    case LinePartKind.Clef: break;
    case LinePartKind.Syllable: allNotes(l.notes).forEach(n => n.uuid = UUID()); break;
    case LinePartKind.Box: break;
    default: assertNever(l);
  }
}

export function extractComment(r: RootContainer, c: Comment): ZeileContainer {
  const line = emptyZeileContainer();
  const isNotAnchor = (lp: LinePart) => lp.uuid !== c.endUUID && lp.uuid !== c.startUUID && !linePartContainsComments(lp, [c])
  line.children = _.dropRightWhile(_.dropWhile(getAllLineParts(r), isNotAnchor), isNotAnchor);
  return line;
}

export function getAllLineParts(r: Container): LinePart[] {
  switch (r.kind) {
    case ContainerKind.FormteilContainer: return _.flatMap(r.children, getAllLineParts);
    case ContainerKind.MiscContainer: return _.flatMap(r.children, getAllLineParts);
    case ContainerKind.ParatextContainer: return [];
    case ContainerKind.RootContainer: return _.flatMap(r.children, getAllLineParts);
    case ContainerKind.ZeileContainer: return r.children;
    default: return assertNever(r);
  }
}

export const emptyCommentTree = (): CommentTree => {
  return {
    kind: "CommentTreeUndecided",
    id: UUID(),
  }
};

export type Justification = {
  kind: "Left";
} | {
  kind: "Right";
} | {
  kind: "Center";
}

export type CommentTreeLeafContentText = {
  kind: "Text";
  content: string;
}

export type CommentTreeLeafContentNotes = {
  kind: "Notes";
  content: ZeileContainer;
  context?: boolean;
}

export type CommentTreeLeafBracket = {
  kind: "Bracket";
}

export type CommentTreeLeafContent = CommentTreeLeafContentText | CommentTreeLeafContentNotes | CommentTreeLeafBracket;

export type CommentTreeUndecided = {
  kind: "CommentTreeUndecided";
  id: string;
}

export type CommentTreeLeaf = {
  kind: "CommentTreeLeaf";
  id: string;
  content: CommentTreeLeafContent;
  justification?: Justification;
}

export type CommentTreeGrid = {
  kind: "CommentTreeGrid";
  id: string;
  items: CommentTree[][];
  justification?: Justification;
};

export type CommentTree = CommentTreeLeaf | CommentTreeGrid | CommentTreeUndecided;

export type CommentTreePath = [number, number][];

export type CommentTreeIntent = {
  kind: "AddRow";
} | {
  kind: "AddColumn";
} | {
  kind: "BecomeGrid";
} | {
  kind: "BecomeLeaf";
  content: CommentTreeLeafContent;
} | {
  kind: "UpdateContent";
  content: CommentTreeLeafContent;
} | {
  kind: "Delete";
} | {
  kind: "DeleteRow";
  index: number;
} | {
  kind: "DeleteColumn";
  index: number;
} | {
  kind: "SetJustification";
  justification?: Justification;
} | {
  kind: "SetContext";
  context: boolean;
}

export type CommentTreeEvent = {
  source: CommentTreePath;
  intent: CommentTreeIntent;
}

export const applyCommentTreeEvent = (commentTree: CommentTree, event: CommentTreeEvent): CommentTree => {
  const go = (node: CommentTree, path: CommentTreePath, setter: (tg: CommentTree | null) => CommentTree): CommentTree => {
    const [head, ...tail] = path;
    if (head === undefined) {
      switch (event.intent.kind) {
        case "AddRow":
          if (node.kind !== "CommentTreeGrid") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          return setter({ ...node, items: [...node.items, Array(node.items[0].length).fill({ kind: "CommentTreeUndecided", id: UUID() })] });
        case "AddColumn":
          if (node.kind !== "CommentTreeGrid") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          return setter({ ...node, items: node.items.map(row => [...row, { kind: "CommentTreeUndecided", id: UUID() }]) });
        case "BecomeGrid": return setter({ kind: "CommentTreeGrid", id: UUID(), items: [[{ kind: "CommentTreeUndecided", id: UUID() }]] });
        case "BecomeLeaf": return setter({ kind: "CommentTreeLeaf", id: UUID(), content: event.intent.content });
        case "UpdateContent":
          if (node.kind !== "CommentTreeLeaf") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-leaf node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          return setter({ ...node, content: event.intent.content });
        case "Delete":
          console.log("deleting");
          return setter(null);
        case "DeleteRow": {
          const index = event.intent.index;
          if (node.kind !== "CommentTreeGrid") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          return setter({ ...node, items: node.items.filter((_, i) => i !== index) });
        }
        case "DeleteColumn": {
          const index = event.intent.index;
          if (node.kind !== "CommentTreeGrid") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          return setter({ ...node, items: node.items.map(row => row.filter((_, i) => i !== index)) });
        }
        case "SetJustification":
          switch (node.kind) {
            case 'CommentTreeGrid': return setter({ ...node, justification: event.intent.justification });
            case 'CommentTreeLeaf': return setter({ ...node, justification: event.intent.justification });
            case 'CommentTreeUndecided': throw new Error(`Cannot apply event ${JSON.stringify(event)} to undecided node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
            default: assertNever(node);
          }
        case "SetContext":
          if (node.kind !== "CommentTreeLeaf") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-leaf node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          else if (node.content.kind !== "Notes") throw new Error(`Cannot apply event ${JSON.stringify(event)} to non-notes node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
          else return setter({ ...node, content: { ...node.content, context: event.intent.context } });
        default: assertNever(event.intent);
      }
    } else {
      switch (node.kind) {
        case "CommentTreeUndecided": throw new Error(`Cannot apply event ${JSON.stringify(event)} to undecided node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
        case "CommentTreeLeaf": throw new Error(`Cannot apply event ${JSON.stringify(event)} to leaf node ${JSON.stringify(node)} at path ${JSON.stringify(path)}`);
        case "CommentTreeGrid":
          const [y, x] = head;
          if (node.items.length <= y) throw new Error(`Cannot apply event ${JSON.stringify(event)} to grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}: y=${y} out of bounds`);
          if (node.items[y].length <= x) throw new Error(`Cannot apply event ${JSON.stringify(event)} to grid node ${JSON.stringify(node)} at path ${JSON.stringify(path)}: x=${x} out of bounds`);
          const newItems = [...node.items];
          const newGrid: CommentTreeGrid = {
            kind: "CommentTreeGrid",
            id: node.id,
            items: newItems,
          }
          newItems[y] = [...node.items[y]];
          const newSetter = (tg: CommentTree | null): CommentTree => {
            if (tg === null) {
              newItems[y][x] = { kind: "CommentTreeUndecided", id: UUID() };
            } else {
              newItems[y][x] = tg;
            }
            return setter(newGrid);
          };

          return go(node.items[y][x], tail, newSetter);
      }
    }
  }

  return go(commentTree, event.source, (tg) => tg ?? { kind: "CommentTreeUndecided", id: UUID() });
}

/** Build a CommentTree from a legacy text-only comment body. */
export const textToCommentTree = (text: string): CommentTree => ({
  kind: "CommentTreeLeaf",
  id: UUID(),
  content: { kind: "Text", content: text },
});

/**
 * Build a CommentTree from legacy `lines[]` (the old "Staff Line" reading
 * editor): a single-column grid with one row per line. ZeileContainer lines
 * become Notes leaves, ParatextContainer lines become Text leaves, anything
 * else becomes an empty (Undecided) cell.
 */
export const linesToCommentTree = (lines: FormteilChildren[]): CommentTree => {
  const rows: CommentTree[][] = lines.map((line): CommentTree[] => {
    if (line.kind === ContainerKind.ZeileContainer) {
      return [{
        kind: "CommentTreeLeaf",
        id: UUID(),
        content: { kind: "Notes", content: JSON.parse(JSON.stringify(line)) as ZeileContainer },
      }];
    }
    if (line.kind === ContainerKind.ParatextContainer) {
      return [{
        kind: "CommentTreeLeaf",
        id: UUID(),
        content: { kind: "Text", content: (line as ParatextContainer).text ?? "" },
      }];
    }
    return [{ kind: "CommentTreeUndecided", id: UUID() }];
  });
  if (rows.length === 0) return emptyCommentTree();
  return { kind: "CommentTreeGrid", id: UUID(), items: rows };
};

/**
 * Ensure a comment has a `tree`, migrating a legacy text/lines body in place.
 * The old `text`/`lines` fields are left untouched as a back-compat fallback;
 * we simply stop editing them. Returns the (possibly newly created) tree.
 */
export const ensureCommentTree = (comment: Comment): CommentTree => {
  if (comment.tree) return comment.tree;
  if (comment.lines && comment.lines.length > 0) {
    comment.tree = linesToCommentTree(comment.lines);
  } else if (comment.text && comment.text.trim().length > 0) {
    comment.tree = textToCommentTree(comment.text);
  } else {
    comment.tree = emptyCommentTree();
  }
  return comment.tree;
};

/**
 * Normalizes and upgrades a RootContainer loaded from storage or import.
 * 1. Ensures root.comments is defined as an array.
 * 2. Migrates legacy comments lacking a `tree` structure.
 * 3. Resolves startUUID/endUUID to note UUIDs if they were assigned to Syllable/Zeile UUIDs in older Monodi versions.
 */
export function normalizeDocumentComments(root: RootContainer): RootContainer {
  if (!root || root.kind !== ContainerKind.RootContainer) return root;

  if (!Array.isArray(root.comments)) {
    root.comments = [];
  }

  // Build a lookup map of all container UUIDs in the document to their first & last Note UUIDs
  const uuidToNoteMap = new Map<string, { firstNoteUUID: string; lastNoteUUID: string }>();

  function collectUUIDs(node: any) {
    if (!node) return;

    if (node.kind === ContainerKind.ZeileContainer) {
      const zeile = node as ZeileContainer;
      let zeileFirstNote = '';
      let zeileLastNote = '';

      for (const child of zeile.children) {
        if (!child) continue;

        if (child.kind === LinePartKind.Syllable) {
          const syl = child as Syllable;
          let sylFirstNote = '';
          let sylLastNote = '';

          if (syl.notes && Array.isArray(syl.notes.spaced)) {
            for (const sp of syl.notes.spaced) {
              for (const ns of (sp?.nonSpaced ?? [])) {
                for (const n of (ns?.grouped ?? [])) {
                  if (n && n.uuid) {
                    if (!sylFirstNote) sylFirstNote = n.uuid;
                    sylLastNote = n.uuid;
                    if (!zeileFirstNote) zeileFirstNote = n.uuid;
                    zeileLastNote = n.uuid;
                    uuidToNoteMap.set(n.uuid, { firstNoteUUID: n.uuid, lastNoteUUID: n.uuid });
                  }
                }
              }
            }
          }

          if (syl.uuid && sylFirstNote && sylLastNote) {
            uuidToNoteMap.set(syl.uuid, { firstNoteUUID: sylFirstNote, lastNoteUUID: sylLastNote });
          }
        }
      }

      if (zeile.uuid && zeileFirstNote && zeileLastNote) {
        uuidToNoteMap.set(zeile.uuid, { firstNoteUUID: zeileFirstNote, lastNoteUUID: zeileLastNote });
      }
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        collectUUIDs(child);
      }
    }
  }

  collectUUIDs(root);

  for (const comment of root.comments) {
    if (!comment) continue;

    // Upgrade missing comment tree
    ensureCommentTree(comment);

    // Resolve startUUID if it matched a Syllable/Zeile container UUID
    if (comment.startUUID && uuidToNoteMap.has(comment.startUUID)) {
      const target = uuidToNoteMap.get(comment.startUUID)!;
      comment.startUUID = target.firstNoteUUID;
    }

    // Resolve endUUID if it matched a Syllable/Zeile container UUID
    if (comment.endUUID && uuidToNoteMap.has(comment.endUUID)) {
      const target = uuidToNoteMap.get(comment.endUUID)!;
      comment.endUUID = target.lastNoteUUID;
    }
  }

  return root;
}

/**
 * True when a comment carries no editorial content: empty text, no legacy
 * lines, and an empty / Undecided tree. Used to drop accidentally-created
 * comments when the editor is dismissed without any input.
 */
export const isCommentEmpty = (comment: Comment): boolean => {
  const emptyText = !comment.text || comment.text.trim() === '';
  const emptyLines = !comment.lines || comment.lines.length === 0;
  const emptyTree = !comment.tree || comment.tree.kind === 'CommentTreeUndecided';
  return emptyText && emptyLines && emptyTree;
};

export function changeDocumentStructure(root: RootContainer, targetType: DocumentType): void {
  let currentLevel = parseInt(root.documentType.replace(/level/i, ''), 10) || 0;
  const hasFormteil = root.children.some((c: any) => c.kind === ContainerKind.FormteilContainer);
  if (root.children.length > 0) {
    if (!hasFormteil) {
      currentLevel = 0;
    } else {
      currentLevel = 1;
      const l1 = root.children.find((c: any) => c.kind === ContainerKind.FormteilContainer) as any;
      if (l1) {
        const l2 = l1.children.find((c: any) => c.kind === ContainerKind.FormteilContainer) as any;
        if (l2) {
          currentLevel = 2;
          const l3 = l2.children.find((c: any) => c.kind === ContainerKind.FormteilContainer);
          if (l3) {
            currentLevel = 3;
          }
        }
      }
    }
  }

  const targetLevel = parseInt(targetType.replace(/level/i, ''), 10) || 0;

  if (currentLevel === targetLevel) {
    root.documentType = targetType;
    return;
  }

  // 1. If targeting Level 0 (flat), flatten all descendants directly
  if (targetLevel === 0) {
    const newChildren: any[] = [];
    const collect = (node: any) => {
      if (node.kind === ContainerKind.ZeileContainer || node.kind === ContainerKind.ParatextContainer) {
        newChildren.push(node);
      } else if (node.children) {
        node.children.forEach(collect);
      }
    };
    root.children.forEach(collect);
    root.children = newChildren;
    root.documentType = targetType;
    return;
  }

  let level = currentLevel;
  // 2. If starting from Level0, wrap in a single L1 FormteilContainer first
  if (level === 0) {
    const l1 = emptyFormteilContainer(targetType, []);
    l1.children = root.children as any[];
    root.children = [l1];
    level = 1;
  }

  const step = level < targetLevel ? 1 : -1;

  while (level !== targetLevel) {
    const nextLevel = level + step;
    if (step === 1) {
      if (level === 1) {
        for (const l1 of root.children) {
          if (l1.kind === ContainerKind.FormteilContainer) {
            const l2 = emptyFormteilContainer(targetType, []);
            l2.children = l1.children as any[];
            l1.children = [l2] as any[];
          }
        }
      } else if (level === 2) {
        for (const l1 of root.children) {
          if (l1.kind === ContainerKind.FormteilContainer) {
            for (const l2 of l1.children) {
              if (l2.kind === ContainerKind.FormteilContainer) {
                const l3 = emptyFormteilContainer(targetType, []);
                l3.children = l2.children as any[];
                l2.children = [l3] as any[];
              }
            }
          }
        }
      }
    } else {
      if (level === 3) {
        for (const l1 of root.children) {
          if (l1.kind === ContainerKind.FormteilContainer) {
            for (const l2 of l1.children) {
              if (l2.kind === ContainerKind.FormteilContainer) {
                const newChildren: FormteilChildren[] = [];
                for (const l3 of l2.children) {
                  if (l3.kind === ContainerKind.FormteilContainer) {
                    newChildren.push(...(l3.children as FormteilChildren[]));
                  } else {
                    newChildren.push(l3);
                  }
                }
                l2.children = newChildren;
              }
            }
          }
        }
      } else if (level === 2) {
        for (const l1 of root.children) {
          if (l1.kind === ContainerKind.FormteilContainer) {
            const newChildren: FormteilChildren[] = [];
            for (const l2 of l1.children) {
              if (l2.kind === ContainerKind.FormteilContainer) {
                newChildren.push(...(l2.children as FormteilChildren[]));
              } else {
                newChildren.push(l2);
              }
            }
            l1.children = newChildren;
          }
        }
      }
    }
    level = nextLevel;
  }

  root.documentType = targetType;
}

export function getAllLineContainers(c: Container): ZeileContainer[] {
  switch (c.kind) {
    case ContainerKind.RootContainer:
    case ContainerKind.FormteilContainer:
    case ContainerKind.MiscContainer:
      return _.flatMap(c.children, getAllLineContainers);
    case ContainerKind.ZeileContainer:
      return [c];
    case ContainerKind.ParatextContainer:
      return [];
    default:
      return assertNever(c);
  }
}

export function findParentContainer(root: Container, targetUuid: string): { parent: Container; index: number } | undefined {
  if (root.kind === ContainerKind.ZeileContainer || root.kind === ContainerKind.ParatextContainer) {
    return undefined;
  }
  const idx = root.children.findIndex(c => c.uuid === targetUuid);
  if (idx >= 0) {
    return { parent: root, index: idx };
  }
  for (const child of root.children) {
    const found = findParentContainer(child, targetUuid);
    if (found) return found;
  }
  return undefined;
}

export function findZipperPath(root: Container, targetUuid: string): number[] | undefined {
  if (root.uuid === targetUuid) {
    return [];
  }
  if (root.kind === ContainerKind.ZeileContainer || root.kind === ContainerKind.ParatextContainer) {
    return undefined;
  }
  for (let i = 0; i < root.children.length; i++) {
    const subPath = findZipperPath(root.children[i], targetUuid);
    if (subPath) {
      return [i, ...subPath];
    }
  }
  return undefined;
}

export function splitTreeAtLine(root: RootContainer, lineUuid: string, splitLevel: number): void {
  const path = findZipperPath(root, lineUuid);
  if (!path) return;

  const K = parseInt(root.documentType.replace(/level/i, ''), 10) || 1;
  if (splitLevel < 1 || splitLevel > K) return;

  const containers: any[] = [root];
  let current: any = root;
  for (let idx of path) {
    current = current.children[idx];
    containers.push(current);
  }

  for (let i = K; i >= splitLevel; i--) {
    const parent = containers[i - 1];
    const self = containers[i];
    if (!parent || !self) continue;
    const splitIdx = path[i];
    if (splitIdx === undefined) continue;

    const sliced = self.children.slice(splitIdx);
    self.children.length = splitIdx;

    const newContainer = emptyFormteilContainer(root.documentType, []);
    newContainer.children = sliced;
    newContainer.data = [];

    parent.children.splice(path[i - 1] + 1, 0, newContainer);
    path[i - 1] = path[i - 1] + 1;
  }
}

export function fixSyllableDashes(root: RootContainer): void {
  const syllables = getSyllables(root);
  for (let i = 1; i < syllables.length; i++) {
    const prev = syllables[i - 1];
    const curr = syllables[i];
    const trimmed = curr.text.trim();
    if (trimmed.startsWith('-')) {
      curr.text = curr.text.replace('-', '').trim();
      if (!prev.text.endsWith('-')) {
        prev.text = prev.text.trim() + '-';
      }
    }
  }
}

function hasNotesInSpaced(spaced: Spaced | undefined): boolean {
  if (!spaced || !Array.isArray(spaced.spaced)) return false;
  for (const sp of spaced.spaced) {
    for (const ns of (sp?.nonSpaced ?? [])) {
      if ((ns?.grouped ?? []).length > 0) return true;
    }
  }
  return false;
}

function regenerateNotesUUIDs(spaced: Spaced): void {
  if (!spaced || !Array.isArray(spaced.spaced)) return;
  for (const sp of spaced.spaced) {
    for (const ns of (sp?.nonSpaced ?? [])) {
      for (const n of (ns?.grouped ?? [])) {
        if (n) n.uuid = UUID();
      }
    }
  }
}

/**
 * Converts a RootContainer into a backwards-compatible document tree for older Monodi versions.
 * Option 1: Any phrase (ZeileContainer) with a 2nd voice has its 2nd voice extracted into an
 * apparatus Comment (2-row grid: Row 0 "Second Voice" text, Row 1 staff line) attached to the phrase range.
 */
export function convertToBackwardsCompatibleComment(root: RootContainer): RootContainer {
  if (!root || root.kind !== ContainerKind.RootContainer) return root;

  const cloned: RootContainer = JSON.parse(JSON.stringify(root));
  if (!cloned.comments) {
    cloned.comments = [];
  }

  function processNode(node: any) {
    if (!node) return;

    if (node.kind === ContainerKind.FormteilContainer || node.kind === ContainerKind.MiscContainer || node.kind === ContainerKind.RootContainer) {
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          processNode(child);
        }
      }
    } else if (node.kind === ContainerKind.ZeileContainer) {
      processZeile(node as ZeileContainer);
    }
  }

  function processZeile(zeile: ZeileContainer) {
    if (!zeile.children || !Array.isArray(zeile.children) || zeile.children.length === 0) return;

    const hasSecondVoice = zeile.voiceCount === 2 || zeile.children.some(child => {
      return child.kind === LinePartKind.Syllable && 
             (child as Syllable).additionalMelodies && 
             (child as Syllable).additionalMelodies!.length > 0 &&
             hasNotesInSpaced((child as Syllable).additionalMelodies![0]);
    });

    if (!hasSecondVoice) {
      delete zeile.voiceCount;
      return;
    }

    // Find Note UUIDs for startUUID and endUUID in Voice 1
    let firstUUID = '';
    let lastUUID = '';
    for (const child of zeile.children) {
      if (child.kind === LinePartKind.Syllable) {
        const syl = child as Syllable;
        if (syl.notes && Array.isArray(syl.notes.spaced)) {
          for (const sp of syl.notes.spaced) {
            for (const ns of (sp?.nonSpaced ?? [])) {
              for (const n of (ns?.grouped ?? [])) {
                if (n && n.uuid) {
                  if (!firstUUID) firstUUID = n.uuid;
                  lastUUID = n.uuid;
                }
              }
            }
          }
        }
      }
    }

    // Fallback to child UUIDs if no note UUIDs found
    if (!firstUUID && zeile.children.length > 0) {
      firstUUID = zeile.children[0].uuid;
      lastUUID = zeile.children[zeile.children.length - 1].uuid;
    }

    const voice2Children: LinePart[] = [];
    for (const child of zeile.children) {
      if (child.kind === LinePartKind.Syllable) {
        const syl = child as Syllable;
        const syl2Uuid = UUID();

        let notes2: Spaced;
        if (syl.additionalMelodies && syl.additionalMelodies.length > 0) {
          notes2 = JSON.parse(JSON.stringify(syl.additionalMelodies[0]));
          regenerateNotesUUIDs(notes2);
        } else {
          notes2 = { spaced: [{ nonSpaced: [{ grouped: [] }] }] };
        }

        const syl2: Syllable = {
          kind: LinePartKind.Syllable,
          uuid: syl2Uuid,
          text: syl.text || '',
          syllableType: syl.syllableType || SyllableType.Normal,
          notes: notes2
        };
        voice2Children.push(syl2);
      } else {
        const childCopy = JSON.parse(JSON.stringify(child));
        childCopy.uuid = UUID();
        voice2Children.push(childCopy);
      }
    }

    const voice2Zeile: ZeileContainer = {
      kind: ContainerKind.ZeileContainer,
      uuid: UUID(),
      children: voice2Children
    };

    // Strip voiceCount and additionalMelodies from original zeile
    delete zeile.voiceCount;
    for (const child of zeile.children) {
      if (child.kind === LinePartKind.Syllable) {
        delete (child as Syllable).additionalMelodies;
      }
    }

    // Attach as comment to cloned.comments with 2-row grid: Row 0 "Second Voice" text, Row 1 staff line
    if (firstUUID && lastUUID) {
      const textLeaf: CommentTreeLeaf = {
        kind: 'CommentTreeLeaf',
        id: UUID(),
        content: { kind: 'Text', content: 'Second Voice' }
      };
      const notesLeaf: CommentTreeLeaf = {
        kind: 'CommentTreeLeaf',
        id: UUID(),
        content: { kind: 'Notes', content: voice2Zeile }
      };
      const commentTree: CommentTreeGrid = {
        kind: 'CommentTreeGrid',
        id: UUID(),
        items: [
          [ textLeaf ],
          [ notesLeaf ]
        ]
      };

      const newComment: Comment = {
        startUUID: firstUUID,
        endUUID: lastUUID,
        commentType: 'tree',
        text: 'Second Voice',
        lines: [voice2Zeile],
        tree: commentTree,
        category: 'second_voice'
      };
      cloned.comments.push(newComment);
    }
  }

  processNode(cloned);
  return cloned;
}

export const convertToBackwardsCompatibleMonodi = convertToBackwardsCompatibleComment;

/** Checks if a comment represents an exported Second Voice. */
export function isSecondVoiceComment(c: Comment): boolean {
  if (!c) return false;
  if (c.category === 'second_voice') return true;
  if (c.text === 'Second Voice') return true;
  if (c.tree && c.tree.kind === 'CommentTreeGrid') {
    for (const row of c.tree.items) {
      for (const cell of row) {
        if (cell.kind === 'CommentTreeLeaf' && cell.content.kind === 'Text' && cell.content.content.trim() === 'Second Voice') {
          return true;
        }
      }
    }
  }
  return false;
}

/** Finds all Second Voice comments present in a RootContainer. */
export function findSecondVoiceComments(root: RootContainer): Comment[] {
  if (!root || !Array.isArray(root.comments)) return [];
  return root.comments.filter(isSecondVoiceComment);
}

/** Extracts the voice 2 ZeileContainer from a Second Voice comment. */
export function extractZeileFromSecondVoiceComment(c: Comment): ZeileContainer | undefined {
  if (!c) return undefined;
  if (c.tree && c.tree.kind === 'CommentTreeGrid') {
    for (const row of c.tree.items) {
      for (const cell of row) {
        if (cell.kind === 'CommentTreeLeaf' && cell.content.kind === 'Notes') {
          return cell.content.content as ZeileContainer;
        }
      }
    }
  }
  if (c.lines && c.lines.length > 0 && c.lines[0].kind === ContainerKind.ZeileContainer) {
    return c.lines[0] as ZeileContainer;
  }
  return undefined;
}

/**
 * Reincorporates "Second Voice" apparatus comments back into native polyphonic staves
 * (restoring zeile.voiceCount = 2 and syllable.additionalMelodies).
 */
export function reincorporateSecondVoiceComments(root: RootContainer): { root: RootContainer; count: number } {
  if (!root || !Array.isArray(root.comments)) return { root, count: 0 };

  const cloned: RootContainer = JSON.parse(JSON.stringify(root));
  const svComments = cloned.comments.filter(isSecondVoiceComment);
  if (svComments.length === 0) return { root: cloned, count: 0 };

  let reincorporatedCount = 0;

  // Build a lookup map of note/syllable/zeile UUID -> ZeileContainer
  const uuidToZeileMap = new Map<string, ZeileContainer>();
  function collectZeiles(node: any) {
    if (!node) return;
    if (node.kind === ContainerKind.ZeileContainer) {
      const zeile = node as ZeileContainer;
      uuidToZeileMap.set(zeile.uuid, zeile);
      for (const child of zeile.children || []) {
        if (child.uuid) uuidToZeileMap.set(child.uuid, zeile);
        if (child.kind === LinePartKind.Syllable && child.notes?.spaced) {
          for (const sp of child.notes.spaced) {
            for (const ns of sp.nonSpaced || []) {
              for (const n of ns.grouped || []) {
                if (n.uuid) uuidToZeileMap.set(n.uuid, zeile);
              }
            }
          }
        }
      }
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) collectZeiles(child);
    }
  }
  collectZeiles(cloned);

  const commentsToRemove = new Set<Comment>();

  for (const c of svComments) {
    const targetZeile = uuidToZeileMap.get(c.startUUID) || uuidToZeileMap.get(c.endUUID);
    const voice2Zeile = extractZeileFromSecondVoiceComment(c);

    if (targetZeile && voice2Zeile) {
      targetZeile.voiceCount = 2;

      const targetSyllables = (targetZeile.children || []).filter(ch => ch.kind === LinePartKind.Syllable) as Syllable[];
      const v2Syllables = (voice2Zeile.children || []).filter(ch => ch.kind === LinePartKind.Syllable) as Syllable[];

      for (let i = 0; i < targetSyllables.length; i++) {
        const syl1 = targetSyllables[i];
        if (i < v2Syllables.length) {
          const syl2 = v2Syllables[i];
          syl1.additionalMelodies = [JSON.parse(JSON.stringify(syl2.notes))];
        }
      }

      commentsToRemove.add(c);
      reincorporatedCount++;
    }
  }

  cloned.comments = cloned.comments.filter(c => !commentsToRemove.has(c));
  return { root: cloned, count: reincorporatedCount };
}

/**
 * Option 2: Converts any 2nd voice phrase into a second standalone staff line (Notenzeile)
 * with the same text and 2nd voice notes, placed directly below the 1st voice phrase.
 */
export function convertToBackwardsCompatibleConsecutiveLines(root: RootContainer): RootContainer {
  if (!root || root.kind !== ContainerKind.RootContainer) return root;

  const cloned: RootContainer = JSON.parse(JSON.stringify(root));

  function processChildren(children: any[]) {
    if (!Array.isArray(children)) return;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;

      if (child.kind === ContainerKind.FormteilContainer || child.kind === ContainerKind.MiscContainer || child.kind === ContainerKind.RootContainer) {
        processChildren(child.children);
      } else if (child.kind === ContainerKind.ZeileContainer) {
        const zeile = child as ZeileContainer;
        const hasSecondVoice = zeile.voiceCount === 2 || zeile.children?.some(c => {
          return c.kind === LinePartKind.Syllable && 
                 (c as Syllable).additionalMelodies && 
                 (c as Syllable).additionalMelodies!.length > 0 &&
                 hasNotesInSpaced((c as Syllable).additionalMelodies![0]);
        });

        if (hasSecondVoice) {
          const voice2Children: LinePart[] = [];
          for (const c of zeile.children) {
            if (c.kind === LinePartKind.Syllable) {
              const syl = c as Syllable;
              const syl2Uuid = UUID();

              let notes2: Spaced;
              if (syl.additionalMelodies && syl.additionalMelodies.length > 0) {
                notes2 = JSON.parse(JSON.stringify(syl.additionalMelodies[0]));
                regenerateNotesUUIDs(notes2);
              } else {
                notes2 = { spaced: [{ nonSpaced: [{ grouped: [] }] }] };
              }

              const syl2: Syllable = {
                kind: LinePartKind.Syllable,
                uuid: syl2Uuid,
                text: syl.text || '',
                syllableType: syl.syllableType || SyllableType.Normal,
                notes: notes2
              };
              voice2Children.push(syl2);
            } else {
              const childCopy = JSON.parse(JSON.stringify(c));
              childCopy.uuid = UUID();
              voice2Children.push(childCopy);
            }
          }

          const voice2Zeile: ZeileContainer = {
            kind: ContainerKind.ZeileContainer,
            uuid: UUID(),
            children: voice2Children
          };

          // Strip 2nd voice fields from original zeile (Voice 1)
          delete zeile.voiceCount;
          for (const c of zeile.children) {
            if (c.kind === LinePartKind.Syllable) {
              delete (c as Syllable).additionalMelodies;
            }
          }

          // Insert voice2Zeile immediately after zeile
          children.splice(i + 1, 0, voice2Zeile);
          i++; // Skip the inserted voice2Zeile in loop iteration
        } else {
          delete zeile.voiceCount;
        }
      }
    }
  }

  if (cloned.children) {
    processChildren(cloned.children);
  }

  return cloned;
}

export interface SplitDocumentsExportResult {
  v1: RootContainer;
  v2: RootContainer;
  filename1: string;
  filename2: string;
}

/**
 * Option 3: Generates two separate RootContainer documents for download:
 * - Document 1 (Voice 1): Contains only the first voice.
 * - Document 2 (Voice 2): Contains only the second voice.
 */
export function convertToBackwardsCompatibleSplitDocuments(
  root: RootContainer, 
  baseDocId: string = 'document'
): SplitDocumentsExportResult {
  if (!root || root.kind !== ContainerKind.RootContainer) {
    return { v1: root, v2: root, filename1: `${baseDocId}-v1.json`, filename2: `${baseDocId}-v2.json` };
  }

  // Build Voice 1 Document
  const v1: RootContainer = JSON.parse(JSON.stringify(root));
  function cleanV1(node: any) {
    if (!node) return;
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.kind === ContainerKind.ZeileContainer) {
          delete (child as ZeileContainer).voiceCount;
          for (const lp of child.children) {
            if (lp.kind === LinePartKind.Syllable) {
              delete (lp as Syllable).additionalMelodies;
            }
          }
        } else {
          cleanV1(child);
        }
      }
    }
  }
  cleanV1(v1);

  // Build Voice 2 Document
  const v2: RootContainer = JSON.parse(JSON.stringify(root));
  function cleanV2(node: any) {
    if (!node) return;
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.kind === ContainerKind.ZeileContainer) {
          delete (child as ZeileContainer).voiceCount;
          for (const lp of child.children) {
            if (lp.kind === LinePartKind.Syllable) {
              const syl = lp as Syllable;
              if (syl.additionalMelodies && syl.additionalMelodies.length > 0 && hasNotesInSpaced(syl.additionalMelodies[0])) {
                syl.notes = JSON.parse(JSON.stringify(syl.additionalMelodies[0]));
                regenerateNotesUUIDs(syl.notes);
              }
              delete syl.additionalMelodies;
            }
          }
        } else {
          cleanV2(child);
        }
      }
    }
  }
  cleanV2(v2);

  const cleanBaseId = baseDocId.replace(/\.json$/i, '').replace(/\.monodijson$/i, '');
  const filename1 = `${cleanBaseId}-v1.json`;
  const filename2 = `${cleanBaseId}-v2.json`;

  return { v1, v2, filename1, filename2 };
}

