import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Focus } from './types/Focus';
import * as VM from './types/model';

@Injectable({
  providedIn: 'root'
})
export class FocusService {
  private lastFocus: (() => void) | undefined = undefined;

  registerFocus(callback: () => void): void {
    if (this.lastFocus) {
      try {
        this.lastFocus();
      } catch (e) {
        console.log(e);
      }
    }

    this.lastFocus = callback;
  }

  mode: Mode = { kind: "Normal" }

  preferredFocus: Focus = Focus.Notes;
  preferredVoiceIndex: number = 0;

  lastPitch?: { base: VM.BaseNote, octave: number };

  /** UUID of the first syllable of the currently displayed document. The
   *  notes.component for that syllable draws a G-clef at the chant start. */
  firstSyllableUuid: string | null = null;

  /** UUID of the note currently considered "selected" in the document.
   *  Used as a global cross-syllable signal: notes.component instances
   *  subscribe to this to know when to color their comment brackets in
   *  palette colors (matching the sidebar cards). */
  private readonly _focusedNoteUUID$ = new BehaviorSubject<string | undefined>(undefined);
  readonly focusedNoteUUID$: Observable<string | undefined> = this._focusedNoteUUID$.asObservable();

  get focusedNoteUUID(): string | undefined {
    return this._focusedNoteUUID$.value;
  }
  set focusedNoteUUID(uuid: string | undefined) {
    if (this._focusedNoteUUID$.value !== uuid) {
      this._focusedNoteUUID$.next(uuid);
    }
  }

  private readonly _focusedContainerUUID$ = new BehaviorSubject<string | undefined>(undefined);
  readonly focusedContainerUUID$: Observable<string | undefined> = this._focusedContainerUUID$.asObservable();

  get focusedContainerUUID(): string | undefined {
    return this._focusedContainerUUID$.value;
  }
  set focusedContainerUUID(uuid: string | undefined) {
    if (this._focusedContainerUUID$.value !== uuid) {
      this._focusedContainerUUID$.next(uuid);
    }
  }
}

type Mode = NormalMode | CommentPickStartMode | CommentCreateMode

export interface NormalMode {
  kind: "Normal";
}

/** Step 1 of comment creation: waiting for the user to click any note in the
 *  document to designate the *start* of the comment span. */
export interface CommentPickStartMode {
  kind: "CommentPickStart";
}

/** Step 2 of comment creation: a start note has been picked; we are now
 *  waiting for the user to click any note to designate the *end* of the span. */
export interface CommentCreateMode {
  kind: "CommentCreate";
  startNoteUUID: string;
}
