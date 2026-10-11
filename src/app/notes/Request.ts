import * as VM from '../types/model';
import { CommonEvent } from '../types/CommonEvent';

export type Request =
  CommonEvent |
  NewSegmentRequested |
  NewLineRequested |
  LineChangeRequested |
  SplitLineRequested |
  LineChangeToFolioChangeRequested |
  NewCommentRequested |
  CommentDeletionRequested |
  EditSyllableTextReqested |
  EditNotesTextReqested |
  AddNoteToNextSegment |
  NewClefRequested |
  StartCommentRequested |
  EndCommentRequested |
  ChangeToBoxRequested |
  ViewIiifRequested |
  HighlightRegionRequested |
  FlagPatternsRequested;

/** Open the "flag neumes by pattern" dialog, pre-filled with this pattern code (steps only). */
export interface FlagPatternsRequested {
  kind: "FlagPatternsRequested";
  pattern: string;
}

export interface ViewIiifRequested {
  kind: "ViewIiifRequested";
  folio: string;
}

export interface HighlightRegionRequested {
  kind: "HighlightRegionRequested";
  uuid: string; // The UUID of the LineChange that was clicked
}

export interface SplitLineRequested {
  kind: "SplitLineRequested";
}

export interface NewSegmentRequested {
  kind: "NewSegmentRequested";
  syllableType: VM.SyllableType;
  text: string;
}

export interface AddNoteToNextSegment {
  kind: "AddNoteToNextSegment";
  note: VM.Note;
}

export interface EditSyllableTextReqested {
  kind: "EditSyllableTextReqested"
}

export interface EditNotesTextReqested {
  kind: "EditNotesTextReqested"
}

export interface NewLineRequested {
  kind: "NewLineRequested"
}

export interface LineChangeRequested {
  kind: "LineChangeRequested";
  after: boolean;
}

export interface LineChangeToFolioChangeRequested {
  kind: "LineChangeToFolioChangeRequested";
}

export interface NewCommentRequested {
  kind: "NewCommentRequested";
  startUUID: string;
  endUUID: string;
  text: string;
  /** Optional: kind of the end element. Used by the root section to decide
   *  whether to swap start/end so that startUUID precedes endUUID in
   *  linearised document order. */
  endKind?: VM.CommentPartKind;
}

export interface CommentDeletionRequested {
  kind: "CommentDeletionRequested";
  comment: VM.Comment;
}

export interface NewClefRequested {
  kind: "NewClefRequested";
}

export interface StartCommentRequested {
  kind: "StartCommentRequested";
  startKind: VM.CommentPartKind;
  startUUID: string;
}

export interface EndCommentRequested {
  kind: "EndCommentRequested";
  endKind: VM.CommentPartKind;
  endUUID: string;
}

export interface ChangeToBoxRequested {
  kind: "ChangeToBoxRequested";
}
