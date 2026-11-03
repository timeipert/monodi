/**
 * The transcription data that the shared code reads: a document of Monodi-Zero is a tree of containers (sections
 * with lines), a line holds line parts (clefs, syllables, line and folio changes), a syllable holds notes.
 *
 * These are structural, type-only copies of the parts of `apps/monodi/src/app/types/model.ts` that the MEI export
 * and the pattern analysis need. The app's own types are assignable to them (the app's `kind` and `noteType` are
 * string enums, whose members are assignable to the string literals used here), so the app passes its documents to
 * the shared code without conversion. Neither side imports the other. Only fields that the shared code reads are
 * listed; the app's types may have more. Where the app uses an enum, this file has a constant object of the same
 * name with the same string values (Node runs TypeScript without enums, see README.md).
 *
 * `apps/monodi/src/app/types/model.ts` is authoritative for the data format. A change there that renames a value or
 * a field read here makes the app's type check fail, because the app hands its types to this package.
 */

export const ContainerKind = {
  FormteilContainer: 'FormteilContainer',
  MiscContainer: 'MiscContainer',
  ParatextContainer: 'ParatextContainer',
  RootContainer: 'RootContainer',
  ZeileContainer: 'ZeileContainer'
} as const;
export type ContainerKind = typeof ContainerKind[keyof typeof ContainerKind];

export const LinePartKind = {
  Box: 'Box',
  Clef: 'Clef',
  FolioChange: 'FolioChange',
  LineChange: 'LineChange',
  Syllable: 'Syllable'
} as const;
export type LinePartKind = typeof LinePartKind[keyof typeof LinePartKind];

export const NoteType = {
  Ascending: 'Ascending',
  Descending: 'Descending',
  Flat: 'Flat',
  Liquescent: 'Liquescent',
  Natural: 'Natural',
  Normal: 'Normal',
  Oriscus: 'Oriscus',
  Quilisma: 'Quilisma',
  Sharp: 'Sharp',
  Strophicus: 'Strophicus'
} as const;
export type NoteType = typeof NoteType[keyof typeof NoteType];

export const BaseNote = { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G' } as const;
export type BaseNote = typeof BaseNote[keyof typeof BaseNote];

export const SyllableType = {
  EditorialEllipsis: 'EditorialEllipsis',
  Normal: 'Normal',
  SourceEllipsis: 'SourceEllipsis',
  WithoutNotes: 'WithoutNotes'
} as const;
export type SyllableType = typeof SyllableType[keyof typeof SyllableType];

/** Index of a base note within an octave, counted from C (the octave starts at C). */
export const baseNoteIndexes: Record<BaseNote, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export interface Note {
  uuid: string;
  noteType: NoteType;
  base: BaseNote;
  liquescent: boolean;
  octave: number;
  focus: boolean;
  isLatent?: boolean;
  /** Keys of user-defined note flags (see note-flags.ts), e.g. ['V']. */
  flags?: string[];
  /** MEI attributes set by hand on this note's `<nc>`. They win over every mapping and rule of the export profile. */
  meiAttrs?: Record<string, string>;
  /** MEI attributes set by hand on the `<neume>` this note starts (held by the neume's first note). */
  meiNeumeAttrs?: Record<string, string>;
}

export interface Grouped { grouped: Note[] }
export interface NonSpaced { nonSpaced: Grouped[] }
export interface Spaced { spaced: NonSpaced[] }

export interface Box { kind: 'Box'; uuid: string; focus: boolean }
export interface Clef { kind: 'Clef'; uuid: string; focus: boolean; base: BaseNote; octave: number; shape: string }
export interface FolioChange { kind: 'FolioChange'; uuid: string; focus: boolean; text: string }
export interface LineChange { kind: 'LineChange'; uuid: string; focus: boolean }
export interface Syllable {
  kind: 'Syllable';
  uuid: string;
  text: string;
  notes: Spaced;
  additionalMelodies?: Spaced[];
  syllableType: SyllableType;
  /** MEI attributes set by hand on the `<syllable>`. */
  meiAttrs?: Record<string, string>;
}
export type LinePart = Box | Clef | FolioChange | LineChange | Syllable;

/** How a line's notation is drawn: pitched on a staff (default) or contour-only without staff lines. */
export type NotationType = 'diastematic' | 'adiastematic';

export interface ZeileContainer {
  kind: 'ZeileContainer';
  uuid: string;
  voiceCount?: number;
  notation?: NotationType;
  children: LinePart[];
}

export interface FormteilData { name: string; data: string }

export interface ParatextComment {
  emendation: boolean;
  comment: string;
  alternativeText: string;
  tree?: CommentTree;
}

export interface ParatextContainer {
  kind: 'ParatextContainer';
  uuid: string;
  text: string;
  retro: boolean;
  paratextType: string;
  comment?: ParatextComment | undefined;
}

export interface FormteilContainer {
  kind: 'FormteilContainer';
  uuid: string;
  children: (ZeileContainer | ParatextContainer | FormteilContainer)[];
  data: FormteilData[];
}

export interface MiscContainer {
  kind: 'MiscContainer';
  uuid: string;
  children: (ZeileContainer | ParatextContainer)[];
}

/** A comment on a range of the document (from `startUUID` to `endUUID`). */
export interface Comment {
  startUUID: string;
  endUUID: string;
  commentType?: 'text' | 'lines' | 'tree';
  text: string;
  emendation?: boolean;
  lines?: (ZeileContainer | ParatextContainer | FormteilContainer)[];
  tree?: CommentTree;
  category?: 'variant' | 'scribal' | 'liturgical' | 'commentary' | 'bibliography' | 'second_voice';
  readingWitnesses?: string[];
  intervention?: 'correction' | 'unclear' | 'supplied' | 'addition' | 'deletion' | 'damage';
  certainty?: 'high' | 'medium' | 'low';
}

export interface RootContainer {
  kind: 'RootContainer';
  uuid: string;
  children: (FormteilContainer | MiscContainer | ZeileContainer | ParatextContainer)[];
  comments: Comment[];
  documentType: string;
  version?: number | undefined;
  globalComment?: CommentTree;
}

export type Container = FormteilContainer | MiscContainer | ParatextContainer | RootContainer | ZeileContainer;

export type Justification = { kind: 'Left' } | { kind: 'Right' } | { kind: 'Center' };
export type CommentTreeLeafContent =
  | { kind: 'Text'; content: string }
  | { kind: 'Notes'; content: ZeileContainer; context?: boolean }
  | { kind: 'Bracket' };
export type CommentTreeUndecided = { kind: 'CommentTreeUndecided'; id: string };
export type CommentTreeLeaf = { kind: 'CommentTreeLeaf'; id: string; content: CommentTreeLeafContent; justification?: Justification };
export type CommentTreeGrid = { kind: 'CommentTreeGrid'; id: string; items: CommentTree[][]; justification?: Justification };
export type CommentTree = CommentTreeLeaf | CommentTreeGrid | CommentTreeUndecided;

/** All notes of a voice, in reading order. */
export function allNotes(s: Spaced): Note[] {
  return s.spaced.flatMap(a => a.nonSpaced.flatMap(b => b.grouped));
}

/** All syllables below a container, in reading order. */
export function getSyllables(c: Container): Syllable[] {
  switch (c.kind) {
    case ContainerKind.RootContainer:
    case ContainerKind.FormteilContainer:
    case ContainerKind.MiscContainer:
      return (c.children as Container[]).flatMap(getSyllables);
    case ContainerKind.ParatextContainer:
      return [];
    case ContainerKind.ZeileContainer:
      return c.children.flatMap(lp => (lp.kind === LinePartKind.Syllable ? [lp] : []));
  }
}
