import * as VM from '../types/model';
import { CommonEvent } from '../types/CommonEvent';
import { ViewIiifRequested, HighlightRegionRequested } from '../notes/Request';

export type Event =
  CommonEvent |
  NewNoteLineRequsted |
  NewParatextRequested |
  NewFormteilRequested |
  MoveRequested |
  NoFocusRequested |
  NewCommentRequested |
  StaleCommentRemovealRequested |
  PasteRequested |
  ViewIiifRequested |
  HighlightRegionRequested |
  OpenCommentModalRequested |
  MergeWithNextLineRequested |
  MergeAllLinesRequested |
  MergeSectionRequested |
  DeleteSectionKeepContentRequested |
  SplitSectionAtLineRequested |
  FixSyllableDashesRequested |
  DocumentUpdated;

export interface MergeAllLinesRequested {
  kind: "MergeAllLinesRequested";
  containerUuid?: string;
}


export interface FixSyllableDashesRequested {
  kind: "FixSyllableDashesRequested";
}

export interface DocumentUpdated {
  kind: "DocumentUpdated";
}

export interface SplitSectionAtLineRequested {
  kind: "SplitSectionAtLineRequested";
  lineUuid: string;
  splitLevel: number;
}

export interface MergeWithNextLineRequested {
  kind: "MergeWithNextLineRequested";
  uuid: string;
}

export interface MergeSectionRequested {
  kind: "MergeSectionRequested";
  uuid: string;
}

export interface DeleteSectionKeepContentRequested {
  kind: "DeleteSectionKeepContentRequested";
  uuid: string;
}

export interface NewNoteLineRequsted {
  kind: "NewNoteLineRequsted";
  container: VM.ZeileContainer;
}

export interface NewParatextRequested {
  kind: "NewParatextRequested";
}

export interface NewFormteilRequested {
  kind: "NewFormteilRequested";
}

export interface MoveRequested {
  kind: "MoveRequested";
  from: number[];
  to: number[];
}

export interface NoFocusRequested {
  kind: "NoFocusRequested";
}

export interface NewCommentRequested {
  kind: "NewCommentRequested";
  startUUID: string;
  endUUID: string;
  text: string;
  /**
   * Kind of the end element that the user clicked on. Used at the root level
   * to decide if start/end should be swapped (so that startUUID always
   * appears before endUUID in the linearised document order). Optional for
   * backwards compatibility — when absent, no swap is performed.
   */
  endKind?: VM.CommentPartKind;
}

export interface OpenCommentModalRequested {
  kind: "OpenCommentModalRequested";
  comment: VM.Comment;
}

export interface StaleCommentRemovealRequested {
  kind: "StaleCommentRemovealRequested";
}

export interface PasteRequested {
  kind: "PasteRequested";
  at: number[];
  withoutNotes: boolean;
  withoutText: boolean;
}
