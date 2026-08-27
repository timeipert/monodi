import {
  ChangeDetectorRef, Component, OnInit, QueryList, ViewChildren,
  OnDestroy, ChangeDetectionStrategy, ElementRef, ViewChild, Output, Input, EventEmitter, AfterViewInit, HostListener
} from '@angular/core';
import * as VM from '../types/model';
import { fromSpaced, fromSpaceds, Drawable, DNote, DTie, DCommentStart, DCommentEnd, DHelperLine } from './Drawables';
import { ToolsService } from '../tools.service';
import { musicLanguage } from './language';
import { assertNever, maxOf, textWidth, focusContentEditable } from '../../utils';
import { ToastrService } from 'ngx-toastr';
import * as R from './Request';
import { v4 as UUID } from "uuid";
import { FocusService } from '../focus.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { handleTextInputMove, Focusable, Focus, FocusChange } from '../types/Focus';
import { CommentComponent } from '../comment/comment.component';
import { commentColor } from '../comment/comment-colors';
import { ReplaySubject, Subscription } from 'rxjs';
import { UndoService } from '../undoService';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { Router } from '@angular/router';
import { extractPattern } from '../transcription-analyzer-core';

declare const $: any;

const GLYPH_PATHS: { [key: string]: string } = {
  'Flat': 'm 28.113523,20.108109 c -0.066,1.39566 -0.110001,4.047415 -0.132,6.722431 0.571999,-0.93044 1.759997,-1.814358 2.903996,-1.814358 1.407998,0 2.243997,1.16305 2.243997,2.907626 0,3.349586 -4.465995,7.117869 -5.389993,7.117869 -0.286,0 -0.549999,-0.139566 -0.549999,-0.697829 -0.066,-3.18676 -0.176,-11.421157 -0.176,-13.886824 0,-0.348915 0.527999,-0.395437 1.099999,-0.348915 z m 1.583998,6.489821 c -0.637999,0 -1.319999,0.697831 -1.737998,1.279356 -0.022,2.395884 -0.022,4.721985 -0.022,6.071125 1.847998,-1.465445 2.815996,-3.512414 2.815996,-5.443079 0,-1.18631 -0.395999,-1.907402 -1.055998,-1.907402 z',
  'Natural': 'm 32.612328,25.358907 c 0,4.866656 0.176511,9.960252 0.176511,13.818272 0,0.378238 -0.403453,0.504316 -1.059066,0.504316 0.05043,-1.487732 0.100861,-3.933667 0.100861,-6.480466 l -3.958885,1.765107 c -0.30259,0.126081 -0.403453,-0.07565 -0.403453,-0.378235 0,-5.92572 -0.201727,-10.313274 -0.201727,-13.793057 0,-0.378238 0.428669,-0.504317 1.059065,-0.504317 -0.05043,1.51295 -0.07565,3.933668 -0.100861,6.480467 l 3.933668,-1.714676 c 0.302591,-0.100861 0.453886,0.05043 0.453887,0.302589 z m -4.387554,4.009318 v 2.849388 L 31.855852,30.6038 v -2.849388 z',
  'Sharp': 'm 33.240217,32.756023 c 0,0.134183 -0.01917,0.191679 -0.172513,0.230016 l -1.456777,0.460033 v 3.354422 c 0,0.153336 -0.383363,0.287519 -0.632546,0.230015 0,-0.881731 -0.01917,-2.070155 -0.01917,-3.392755 l -1.93598,0.613379 v 3.507766 c 0,0.153337 -0.383362,0.268356 -0.632547,0.230016 0,-0.920069 -0.01916,-2.165995 -0.01916,-3.546099 l -1.303432,0.402529 c -0.21085,0.05751 -0.325857,0 -0.325857,-0.230018 v -1.782635 c 0,-0.115001 0.03834,-0.153335 0.172512,-0.191679 l 1.437608,-0.440867 c -0.01916,-1.188424 -0.03834,-2.396015 -0.03834,-3.565268 l -1.245924,0.383362 c -0.210849,0.05751 -0.325858,0 -0.325858,-0.230017 v -1.782637 c 0,-0.115 0.03834,-0.172511 0.172515,-0.210846 l 1.380102,-0.421699 c -0.01917,-1.360935 -0.01917,-2.54936 -0.01917,-3.335252 0,-0.345025 0.4217,-0.498372 0.881734,-0.345025 -0.03834,0.670883 -0.05751,1.91681 -0.07665,3.450259 l 1.763468,-0.555874 c -0.01917,-1.418443 -0.01917,-2.664369 -0.01917,-3.469429 0,-0.383362 0.460034,-0.498372 0.900901,-0.383362 -0.03834,0.690052 -0.05751,2.012649 -0.07667,3.603603 l 1.341768,-0.40253 c 0.172512,-0.05751 0.249185,0 0.249185,0.172515 v 1.801801 c 0,0.153351 -0.01916,0.172514 -0.172513,0.230017 l -1.437618,0.440867 c 0,1.188424 -0.01916,2.415183 -0.01916,3.622775 l 1.380102,-0.440867 c 0.172514,-0.05751 0.249186,0 0.249186,0.172512 z m -2.319341,-1.341769 -0.03834,-3.584438 -1.840138,0.575044 c 0,1.169256 0,2.396016 -0.01916,3.584438 z',
  'Normal': 'm 28.840114,34.975049 c -2.283304,0 -4.338278,-1.541231 -4.338278,-4.081407 0,-2.825589 3.082461,-5.822427 6.393253,-5.822427 2.911213,0 4.395361,1.94081 4.395361,3.995784 0,3.367874 -3.253709,5.90805 -6.450336,5.90805 z',
  'Ascending': 'm 28.846225,35.094337 c -2.306802,0 -4.382925,-1.557091 -4.382925,-4.123409 0,-2.85467 3.114184,-5.88235 6.459049,-5.88235 1.672433,0 2.796998,0.749712 3.3737,1.528257 l 0.02883,-0.05767 c -0.02883,-0.34602 -0.08651,-0.807381 -0.11534,-1.903111 l -0.173006,-6.574387 c 0,-0.519032 0.634372,-0.720877 1.326412,-0.547867 v 11.591686 c 0,3.402533 -3.287195,5.968852 -6.51672,5.968851 z',
  'Descending': 'm 35.388649,29.040909 v 0.260586 12.739849 c 0,0.463264 -0.463266,0.636991 -1.216075,0.608038 0.115817,-2.866468 0.260587,-6.804239 0.289543,-10.626192 -1.187124,1.824113 -3.416596,3.011237 -5.617115,3.011237 -2.316337,0 -4.401038,-1.563528 -4.401038,-4.14045 0,-2.866466 3.127053,-5.906657 6.485741,-5.906657 2.953327,0 4.458944,1.968886 4.458944,4.053589 z',
  'Oriscus': 'm 24.852088,34.972151 c -1.488003,0 -0.909335,-5.125344 0.248001,-9.368908 0.137778,-0.468446 0.661335,-0.496001 1.12978,-0.496001 -0.08267,2.755562 -0.220444,4.546676 0.826668,4.546676 1.184891,0 6.558237,-4.629343 8.046239,-4.629343 1.488003,0 0.909336,5.125344 -0.248,9.368908 -0.110222,0.468446 -0.661334,0.496001 -1.102225,0.496001 0.08267,-2.755561 0.19289,-4.546676 -0.826668,-4.546676 -1.212447,0 -6.585792,4.629343 -8.073795,4.629343 z',
  'Strophicus': 'm 25.01637,39.951822 c -0.353153,-0.0736 -0.510708,-0.208826 -0.510708,-0.438314 0,-0.07091 0.410392,-0.83157 1.113554,-2.063968 2.065526,-3.62015 2.984598,-5.397636 3.386043,-6.548609 0.204631,-0.586695 0.221806,-0.817451 0.08145,-1.094425 -0.268178,-0.529225 -1.009029,-1.101763 -3.006631,-2.323561 -1.605363,-0.98189 -2.225032,-1.437879 -2.345351,-1.725844 -0.04071,-0.09743 -0.0434,-0.169456 -0.01084,-0.29053 0.314859,-1.170954 3.570921,-4.258107 5.468489,-5.18481 0.664714,-0.324622 0.974136,-0.334641 1.633586,-0.05289 1.811657,0.774025 4.939675,3.102157 5.922604,4.408098 0.29108,0.386734 0.391821,0.614282 0.392957,0.887585 0.0037,0.88143 -1.428073,3.291894 -3.924811,6.607794 -2.720053,3.612483 -5.855617,7.089418 -6.845926,7.591245 -0.39415,0.199731 -1.000736,0.301946 -1.354417,0.228232 z',
  'Quilisma': 'm 24.070966,29.337707 c 0,-0.688503 1.807319,-2.560368 2.388243,-2.560368 0.559409,0 2.366727,2.710978 3.012197,2.710978 0.666988,0 4.905581,-2.259149 6.002881,-2.990682 0.537892,-0.365766 0.580926,0.387283 0.215157,0.903659 -1.032753,1.463069 -6.519256,6.196521 -7.810199,6.196521 -0.710018,0 -3.808279,-3.528573 -3.808279,-4.260108 z'
};

@Component({
  selector: 'app-notes',
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotesComponent implements OnDestroy, OnInit, Focusable, AfterViewInit {
  getGlyphDataUri(noteType: string, focused: boolean): string {
    const d = GLYPH_PATHS[noteType] || GLYPH_PATHS['Normal'];
    const fill = focused ? '#5bf186' : '#000000';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="60" viewBox="24 0 12 60"><path fill="${fill}" d="${d}"/></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  @ViewChildren('noteText') noteTextElements!: QueryList<ElementRef>;
  @ViewChild('syllableText', { static: true }) syllableTextElement!: ElementRef;
  @ViewChildren('notesDiv') notesDivElements!: QueryList<ElementRef>;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;

  @Input()
  readOnly!: boolean;

  @Input()
  comments!: VM.Comment[];

  @Output()
  request = new EventEmitter<R.Request>();

  @Input()
  model!: VM.Syllable;

  @Input()
  highlightNoteUUIDs?: Set<string> | null;

  @Input()
  hideSyllableText = false;

  @Input()
  staffScale = 1.0;

  syllableWidth = 0;
  noteTextWidth = 0;
  syllTextWidth = 0;
  svgWidth = 0;
  hasFocus: boolean[] = [];
  focusedVoiceIndex = 0;
  timeoutF: any = undefined;
  drawablesCache: Drawable[][] = [];
  lastModelString = '';

  getVoices(): VM.Spaced[] {
    const voices = [this.model.notes];
    if (this.model.additionalMelodies) {
      voices.push(...this.model.additionalMelodies);
    }
    return voices;
  }

  private isUUIDInCommentSpan(targetUUID: string, comment: VM.Comment): boolean {
    if (!targetUUID || !comment) return false;
    if (comment.startUUID === targetUUID || comment.endUUID === targetUUID) return true;

    if (typeof document !== 'undefined') {
      const allEl = Array.from(document.querySelectorAll('[data-uuid]'));
      if (allEl.length > 0) {
        const uuids = allEl.map(el => el.getAttribute('data-uuid')).filter((u): u is string => !!u);
        const startIdx = uuids.indexOf(comment.startUUID);
        const endIdx = uuids.indexOf(comment.endUUID);
        const targetIdx = uuids.indexOf(targetUUID);

        if (startIdx !== -1 && endIdx !== -1 && targetIdx !== -1) {
          const min = Math.min(startIdx, endIdx);
          const max = Math.max(startIdx, endIdx);
          return targetIdx >= min && targetIdx <= max;
        }
      }
    }
    return false;
  }

  getActiveComments(): VM.Comment[] {
    const focusedNote = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
    if (focusedNote) {
      return this.comments.filter(c => this.isUUIDInCommentSpan(focusedNote.uuid, c));
    }
    return [];
  }

  getSyllableComments(): VM.Comment[] {
    const syllableUUIDs = [this.model.uuid];
    if (this.model.notes && this.model.notes.spaced) {
      for (const sp of this.model.notes.spaced) {
        for (const ns of sp.nonSpaced) {
          for (const n of ns.grouped) {
            if (n.uuid) syllableUUIDs.push(n.uuid);
          }
        }
      }
    }
    return this.comments.filter(c =>
      syllableUUIDs.some(uuid => this.isUUIDInCommentSpan(uuid, c))
    );
  }

  constructor(
    private focusService: FocusService,
    private cdr: ChangeDetectorRef,
    private toastr: ToastrService,
    private domRoot: ElementRef,
    private toolsService: ToolsService,
    private undoService: UndoService,
    private modalService: NgbModal,
    private contextMenuService: ContextMenuService,
    private router: Router) {
  }

  refresh() { this.cdr.detectChanges(); this.notesToText(); }

  ngOnInit() {
    this.notesToText();
    (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model.text;
    this.recalculateWidths();
  }

  ngAfterViewInit() {
    // Populate contenteditable fields now that ViewChildren are available
    // (ngOnInit runs before ViewChildren are resolved, so we must do it here)
    setTimeout(() => this.notesToText(), 0);
    this.noteTextElements.changes.subscribe(() => {
      setTimeout(() => this.notesToText(), 0);
    });
    // Re-render this OnPush component whenever the globally-selected note
    // changes, so palette-coloured brackets in this syllable can light up
    // (or fade back to gray) without depending on local focus.
    this.focusedNoteSub = this.focusService.focusedNoteUUID$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  private focusedNoteSub?: Subscription;

  @HostListener('window:focus')
  onWindowFocus() {
    // When the user returns from another app, Angular CD may have cleared the
    // imperatively-managed contenteditable textContent. Re-sync from model.
    setTimeout(() => this.notesToText(), 0);
  }

  undoCallback = async () => {
    setTimeout(() => {
      this.notesToText();
      (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model.text;
      this.recalculateWidths();
      this.cdr.detectChanges();
    }, 5);
  }

  ngOnDestroy() {
    this.undoService.deregisterNotesCallbacks(this.model.uuid);
    this.focusedNoteSub?.unsubscribe();
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  requestDeleteComment(c: VM.Comment): void {
    this.request.emit({ kind: 'CommentDeletionRequested', comment: c });
  }

  hasCurrentFocus(d: Drawable, voiceIndex: number) {
    return this.hasFocus[voiceIndex] && (d.ref as any).focus;
  }

  setDivFocus(focus: boolean, voiceIndex: number) {
    this.hasFocus[voiceIndex] = focus;
    this.focusedVoiceIndex = voiceIndex;
    if (focus) {
      this.focusService.preferredVoiceIndex = voiceIndex;
      // Re-sync contenteditable from model after Angular CD may have cleared it
      // (happens when browser window loses and regains focus)
      setTimeout(() => this.notesToText(), 0);
    }
    const notes = this.getVoices()[voiceIndex];
    if (focus && (VM.getFocused(notes) || this.model.syllableType !== VM.SyllableType.Normal)) {
      this.addNoteTools();
    } else {
      // Discard latent notes on blur
      if (!focus) {
        const focusedNote = VM.getFocused(notes);
        if (focusedNote && focusedNote.isLatent) {
           this.discardLatentNote(voiceIndex);
        }
      }
      this.timeoutF = setTimeout(() => this.toolsService.remove(this), 200);
    }
  }

  discardLatentNote(voiceIndex: number) {
    if (voiceIndex === 0) {
      this.model.notes.spaced = [];
    } else {
      if (this.model.additionalMelodies) {
         this.model.additionalMelodies[voiceIndex - 1].spaced = [];
      }
    }
    this.notesToText();
    this.recalculateWidths();
    this.cdr.markForCheck();
    this.cdr.detectChanges();
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    this.focusedVoiceIndex = this.focusService.preferredVoiceIndex || 0;
    
    // Safety check: if preferredVoiceIndex is out of bounds, reset to 0
    if (this.focusedVoiceIndex >= this.getVoices().length) {
        this.focusedVoiceIndex = 0;
    }
    
    switch (level) {
      case Focus.Notes:
        const voice = this.getVoices()[this.focusedVoiceIndex];
        if (voice.spaced.length === 0 || (voice.spaced.length > 0 && voice.spaced[0].nonSpaced.length === 0) || (voice.spaced.length > 0 && voice.spaced[0].nonSpaced.length > 0 && voice.spaced[0].nonSpaced[0].grouped.length === 0)) {
          // If moving right (+1) into empty syllable, or we just want to focus it, create latent note
          if (!change.focusLast) {
              const emptyNotes = JSON.parse(JSON.stringify(VM.emptySyllable().notes));
              const newNote = emptyNotes.spaced[0].nonSpaced[0].grouped[0];
              if (this.focusService.lastPitch) {
                newNote.base = this.focusService.lastPitch.base;
                newNote.octave = this.focusService.lastPitch.octave;
              } else {
                newNote.base = VM.BaseNote.C;
                newNote.octave = 4;
              }
              newNote.isLatent = true;
              newNote.focus = true;
              if (this.focusedVoiceIndex === 0) {
                this.model.notes = emptyNotes;
              } else {
                if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
                this.model.additionalMelodies[this.focusedVoiceIndex - 1] = emptyNotes;
              }
              this.notesToText();
              this.recalculateWidths();
              this.cdr.markForCheck();
              if (this.notesDivElements) {
                setTimeout(() => {
                  (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
                }, 0);
              }
          } else {
             this.requestFocusShift(level, change.focusLast, -1);
          }
        } else {
          if (change.focusLast) { this.focusLast(); } else { this.focusFirst(); }
        }
        break;
      case Focus.Code:
        this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
        focusContentEditable(this.noteTextElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement, change.focusLast);
        break;
      case Focus.Text:
        this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
        focusContentEditable(this.syllableTextElement.nativeElement as HTMLElement, change.focusLast);
        break;
      default: assertNever(level);
    }
  }

  getData(): any {
    return this.model;
  }

  private focusFirst(): void {
    VM.focusFirst(this.getVoices()[this.focusedVoiceIndex]);
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  private focusLast(): void {
    VM.focusLast(this.getVoices()[this.focusedVoiceIndex]);
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  changeNoteText(event: KeyboardEvent, voiceIndex: number) {
    this.focusedVoiceIndex = voiceIndex;
    const voices = this.getVoices();
    const oldNoteText = spacedToString(voices[voiceIndex]);
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    const newNoteText = el.textContent || '';
    //Do not call function if nothing changes thus adding empty changes to undoService
    if (oldNoteText !== newNoteText) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      event.stopPropagation();
      event.preventDefault();
      this.textToNotes(voiceIndex);
      this.recalculateWidths();
    }
  }

  private showComments(syllable: boolean) {
    const rp = new ReplaySubject<VM.ZeileContainer[]>(1);
    let comments: VM.Comment[] = [];
    if (syllable) {
      comments = this.getSyllableComments();
    } else {
      comments = this.getActiveComments();
    }
    rp.subscribe(originals => {
      // Use the same modal options as document.openComment() for a
      // consistent look-and-feel across every route into the comment dialog.
      const modalRef = this.modalService.open(CommentComponent, { size: 'xl', centered: true, backdrop: 'static', windowClass: 'comment-modal-window', scrollable: true, fullscreen: 'lg' });
      modalRef.componentInstance.comments = JSON.parse(JSON.stringify(comments));
      modalRef.componentInstance.originals = JSON.parse(JSON.stringify(originals));
      modalRef.componentInstance.saveEvent.subscribe((newComments: (VM.Comment | null)[]) => {
        for (let i = 0; i < newComments.length; i++) {
          const nc = newComments[i];
          if (nc === null) {
            this.request.emit({ kind: 'CommentDeletionRequested', comment: comments[i] });
          } else {
            comments[i].emendation = nc.emendation;
            comments[i].lines = nc.lines;
            comments[i].tree = nc.tree;
            comments[i].text = nc.text;
          }
        }
      });
    });
    this.request.emit({
      kind: 'ResolveCommentSpansRequested',
      onResolve: rp,
      spans: comments
    });
  }

  changeSyllableTextDown(event: KeyboardEvent) {

    const textBefore = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
    if (event.key === 'Enter') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'NewLineRequested' });
    } else if (event.key === ' ') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: '' });
    } else if (event.key === 'Backspace' && textBefore === '') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'DeletionRequested', focusLast: true });
    }

    handleTextInputMove(this.syllableTextElement.nativeElement, event, e => this.request.emit(e));

    if (event.key === 'ArrowUp') {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      event.preventDefault();
      this.focusService.preferredFocus = Focus.Code;
      this.focusedVoiceIndex = this.getVoices().length - 1; // bottom-most voice
      this.focus({ focusLast: false });
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  onNoteTextDown(event: KeyboardEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    handleTextInputMove(el, event, e => this.request.emit(e));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.focusedVoiceIndex < this.getVoices().length - 1) {
         this.focusedVoiceIndex++;
         this.focusService.preferredFocus = Focus.Code;
         this.focus({ focusLast: false });
      } else {
         this.focusService.preferredFocus = Focus.Text;
         this.focus({ focusLast: false });
         focusContentEditable(this.syllableTextElement.nativeElement, 2);
      }
    }
    if (event.key === 'ArrowUp') {
      if (this.focusedVoiceIndex > 0) {
         event.preventDefault();
         this.focusedVoiceIndex--;
         this.focusService.preferredFocus = Focus.Code;
         this.focus({ focusLast: false });
      } else {
         event.preventDefault();
         this.request.emit({ kind: 'LineFocusShiftRequest', uuid: this.model.uuid, direction: -1 });
      }
    }
    if (event.ctrlKey && event.key === 'z') {
      event.stopPropagation();
      event.preventDefault();
      this.undoService.undo();
    }
  }

  splitAndCreateNewSegments(text: string): boolean {
    let newTextSegments: string[] = [];
    if (text) {
      newTextSegments = text.split(/(?=\-)/);
      newTextSegments.map((t, i) => {
        if (i < newTextSegments.length - 1) {
          if (newTextSegments[i + 1].indexOf("-") === 0) {
            newTextSegments[i] = t + "-";
            newTextSegments[i + 1] = newTextSegments[i + 1].replace("-", "");
          }
        }
      })
      newTextSegments = newTextSegments.filter(t => t.length > 0)
      if (newTextSegments.length > 1) {
        for (let i = newTextSegments.length - 1; i > 0; i--) {
          this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: newTextSegments[i] });
        }
        const thisNewText = newTextSegments[0];
        (this.syllableTextElement.nativeElement as HTMLElement).textContent = thisNewText;
        this.model.text = thisNewText;
        return true;
      }
    }
    return false;
  }

  pasteSyllableText(e: ClipboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.clipboardData) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      const text = e.clipboardData.getData('text');
      this.splitAndCreateNewSegments(text);
      this.recalculateWidths();
    }
  }

  changeSyllableText(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    const oldText = this.model.text;
    const newText = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';

    if (oldText !== newText) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      if (e.key === '-') {
          e.stopPropagation();
          const text = (this.syllableTextElement.nativeElement as HTMLElement).textContent;
          if (text) {
            const splitOccurred = this.splitAndCreateNewSegments(text);
            if (!splitOccurred) {
              this.model.text = text;
            }
          }
        } else {
          const newContent = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
          this.model.text = newContent;
        }
      }
    this.recalculateWidths();
  }

  clickOn(e: MouseEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    e.preventDefault();
    e.stopPropagation();
    const voices = this.getVoices();
    const focused = VM.getFocused(voices[voiceIndex]);
    if (voices[voiceIndex].spaced.length === 0 || voices[voiceIndex].spaced[0].nonSpaced.length === 0) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      const emptyNotes = JSON.parse(JSON.stringify(VM.emptySyllable().notes));
      const newNote = this.getNoteByClickPos(e.offsetY);
      newNote.isLatent = true;
      newNote.focus = true;
      emptyNotes.spaced[0].nonSpaced[0].grouped[0] = newNote;
      if (voiceIndex === 0) {
        this.model.notes = emptyNotes;
      } else {
        if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
        this.model.additionalMelodies[voiceIndex - 1] = emptyNotes;
      }
      this.focus({ preferredLevel: Focus.Notes, focusLast: true });
    } else if (focused && focused.isLatent) {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      delete focused.isLatent;
      const clickedNote = this.getNoteByClickPos(e.offsetY);
      focused.base = clickedNote.base;
      focused.octave = clickedNote.octave;
    } else {
      this.insertNoteNear(this.getNoteByClickPos(e.offsetY));
    }
    this.notesToText();
    this.recalculateWidths();
  }

  getNoteByClickPos(y: number): VM.Note {
    let newBase = VM.BaseNote.A;
    let newOctave = 4;
    if (y > 90) {
      newBase = VM.BaseNote.C;
      newOctave = 4;
    } else if (y <= 90 && y > 85) {
      newBase = VM.BaseNote.D;
    } else if (y <= 85 && y > 80) {
      newBase = VM.BaseNote.E;
    } else if (y <= 80 && y > 75) {
      newBase = VM.BaseNote.F;
    } else if (y <= 75 && y > 70) {
      newBase = VM.BaseNote.G;
    } else if (y <= 70 && y > 65) {
      newBase = VM.BaseNote.A;
    } else if (y <= 65 && y > 60) {
      newBase = VM.BaseNote.B;
    } else if (y <= 60 && y > 55) {
      newBase = VM.BaseNote.C;
      newOctave = 5;
    } else if (y <= 55 && y > 50) {
      newBase = VM.BaseNote.D;
      newOctave = 5;
    } else if (y <= 50 && y > 45) {
      newBase = VM.BaseNote.E;
      newOctave = 5;
    } else if (y <= 45 && y > 40) {
      newBase = VM.BaseNote.F;
      newOctave = 5;
    } else if (y <= 40 && y > 35) {
      newBase = VM.BaseNote.G;
      newOctave = 5;
    } else if (y <= 35) {
      newBase = VM.BaseNote.A;
      newOctave = 5;
    }

    return {
      uuid: UUID(),
      base: newBase,
      focus: true,
      liquescent: false,
      noteType: VM.NoteType.Normal,
      octave: newOctave
    };
  }

  switchVoice(delta: number): void {
    const newIndex = this.focusedVoiceIndex + delta;
    if (newIndex >= 0 && newIndex < this.getVoices().length) {
      // Unfocus current
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused) focused.focus = false;

      // Update preferred voice
      this.focusedVoiceIndex = newIndex;
      this.focusService.preferredVoiceIndex = newIndex;

      // Focus the new voice's first note
      const notes = this.getVoices()[newIndex];
      const newFocus = VM.getFocused(notes);
      if (!newFocus && notes.spaced.length > 0 && notes.spaced[0].nonSpaced.length > 0 && notes.spaced[0].nonSpaced[0].grouped.length > 0) {
         notes.spaced[0].nonSpaced[0].grouped[0].focus = true;
      }
      this.notesToText();
      this.cdr.detectChanges();
    } else {
      this.request.emit({ kind: 'LineFocusShiftRequest', uuid: this.model.uuid, direction: delta < 0 ? -1 : 1 });
    }
  }

  keyDown(e: KeyboardEvent, voiceIndex: number): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      return;
    }
    if (e.key === 'Escape') {
      return;
    }
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredVoiceIndex = voiceIndex;
    e.preventDefault();
    e.stopPropagation();
    if ((e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') { this.switchVoice(1); }
    else if ((e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') { this.switchVoice(-1); }
    else if (e.key === 'ArrowUp') { this.changePitch(VM.nextNote); }
    else if (e.altKey && e.key === 't') { this.request.emit({ kind: 'EditSyllableTextReqested' }); }
    else if (e.altKey && e.key === 'n') { this.request.emit({ kind: 'EditNotesTextReqested' }); }
    else if (e.altKey && e.key === 'ArrowRight') { this.insertOrShiftRight(); }
    else if (e.altKey && e.key === 'ArrowLeft') { } //do nothing
    else if (e.altKey && e.key === 'Enter') { this.splitLine(); }
    else if (e.ctrlKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.altKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.key === 'ArrowDown') { this.changePitch(VM.previousNote); }
    else if (e.key === 'ArrowLeft') {
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused && focused.isLatent) {
        this.discardLatentNote(this.focusedVoiceIndex);
        this.requestFocusShift(undefined, true, -1);
      } else {
        this.focusOther(VM.getLeftOf, () => this.requestFocusShift(undefined, true, -1));
      }
    }
    else if (e.key === 'ArrowRight') {
      const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
      if (focused && focused.isLatent) {
        delete focused.isLatent;
        this.notesToText();
        this.cdr.markForCheck();
      }
      this.focusOther(VM.getRightOf, () => this.requestFocusShift(undefined, false, +1));
    }
    else if (e.key === 's') { this.toggleNoteType(VM.NoteType.Sharp); }
    else if (e.key === 'n') { this.toggleNoteType(VM.NoteType.Natural); }
    else if (e.key === 'f') { this.toggleNoteType(VM.NoteType.Flat); }
    else if (e.key === 'o') { this.toggleNoteType(VM.NoteType.Oriscus); }
    else if (e.key === 'a') { this.toggleNoteType(VM.NoteType.Ascending); }
    else if (e.key === 'd') { this.toggleNoteType(VM.NoteType.Descending); }
    else if (e.key === ',') { this.toggleNoteType(VM.NoteType.Strophicus); }
    else if (e.key === 'q') { this.toggleNoteType(VM.NoteType.Quilisma); }
    else if (e.key === 'l') { this.toggleLiquescent(); }
    else if (e.key === 'Shift') { this.insertNoteSlur(); }
    else if (e.key === ' ') { this.insertNear(); }
    else if (e.key === 'Enter') { this.insertFar(); }
    else if (e.key === 'j') { this.request.emit({ kind: 'LineChangeRequested', after: true }); }
    else if (e.key === 'c') { this.request.emit({ kind: 'NewClefRequested' }); }
    else if (e.key === '-') { this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: '' }); }
    else if (e.key === 'i') { this.request.emit({ kind: 'LineChangeRequested', after: false }); }
    else if (e.key === 'Delete') { this.deleteNote(false); }
    else if (e.key === 'Backspace') { this.deleteNote(true); }
    else if (e.ctrlKey && e.key === 'z') {
      this.undoService.undo();
    }
    this.notesToText();
    this.recalculateWidths();
  }

  splitLine() {
    this.undoService.beforeChange('Edit Note');
    this.request.emit({ kind: 'SplitLineRequested' })
  }

  insertLinChangeInFront() {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.request.emit({ kind: 'LineChangeRequested', after: false });
    });
  }

  insertOrShiftRight() {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.request.emit({ kind: 'AddNoteToNextSegment', note: no });
    });
  }

  insertFar(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      if (no.isLatent) {
        delete no.isLatent;
      }
      const newNote = noteFromTemplate(no);
      this.insertNoteFar(newNote);
    });
  }

  insertNoteFar(note: VM.Note) {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      no.focus = false;
      const notesBefore = gr.grouped.slice(0, gr.grouped.indexOf(no) + 1);
      const notesAfter = gr.grouped.slice(gr.grouped.indexOf(no) + 1);
      const newGroups: VM.Grouped[] = [];
      if (notesBefore.length > 0) newGroups.push({ grouped: notesBefore });
      const newGroup = { grouped: [note] };
      newGroups.push(newGroup);
      if (notesAfter.length > 0) newGroups.push({ grouped: notesAfter });
      ns.nonSpaced.splice(ns.nonSpaced.indexOf(gr), 1, ...newGroups);

      const groupsBefore = ns.nonSpaced.slice(0, ns.nonSpaced.indexOf(newGroup));
      const groupsAfter = ns.nonSpaced.slice(ns.nonSpaced.indexOf(newGroup) + 1);
      const newNonSpaceds: VM.NonSpaced[] = [];
      if (groupsBefore.length > 0) newNonSpaceds.push({ nonSpaced: groupsBefore });
      const newNonspaced = { nonSpaced: [newGroup] };
      newNonSpaceds.push(newNonspaced);
      if (groupsAfter.length > 0) newNonSpaceds.push({ nonSpaced: groupsAfter });
      s.spaced.splice(s.spaced.indexOf(ns), 1, ...newNonSpaceds);
    });
  }

  requestFocusShift(level: Focus | undefined, focusLast: boolean, direction: number) {
    this.request.emit({
      kind: 'FocusShiftRequested',
      change: {
        focusLast: focusLast,
        preferredLevel: level
      },
      direction: direction
    });
    this.withFocus(n => { n.focus = false; });
  }

  insertNear(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      if (no.isLatent) {
        delete no.isLatent;
      }
      const newNote = noteFromTemplate(no);
      this.insertNoteNear(newNote);
    });
  }

  insertNoteNear(note: VM.Note) {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      no.focus = false;
      const notesBefore = gr.grouped.slice(0, gr.grouped.indexOf(no) + 1);
      const notesAfter = gr.grouped.slice(gr.grouped.indexOf(no) + 1);
      const newGroups: VM.Grouped[] = [];
      if (notesBefore.length > 0) newGroups.push({ grouped: notesBefore });
      newGroups.push({ grouped: [note] });
      if (notesAfter.length > 0) newGroups.push({ grouped: notesAfter });
      ns.nonSpaced.splice(ns.nonSpaced.indexOf(gr), 1, ...newGroups);
    });
  }

  insertNoteSlur(): void {
    this.withPath((s, ns, gr, no) => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      if (no.isLatent) {
        delete no.isLatent;
      }
      const newNote = noteFromTemplate(no);
      no.focus = false;

      gr.grouped.splice(gr.grouped.indexOf(no) + 1, 0, newNote);
    });
  }

  deleteNote(focusLast: boolean): void {
    if (this.getActiveComments().length > 0) {
      this.toastr.info('Please delete the comment before deleting the symbol.');
    } else {
      const nextNote = this.withPath((s, ns, gr, no) => {
        this.undoService.beforeChange('Edit Note');
        this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
        let nextNote = !focusLast ? VM.getRightOf(s, no) : VM.getLeftOf(s, no);
        gr.grouped.splice(gr.grouped.indexOf(no), 1);
        if (gr.grouped.length === 0) {
          const filteredNS = ns.nonSpaced.filter(function(e) {
            return e.grouped.length !== 0;
          });
          ns.nonSpaced = filteredNS;
          if (ns.nonSpaced.length === 0) {
            var filteredS = s.spaced.filter(function(e) {
              return e.nonSpaced.length !== 0;
            });
            s.spaced = filteredS;
          }
        }

        this.notesToText();
        if (nextNote !== undefined) {
          nextNote.focus = true;
        } else {
          if (s.spaced.length === 0) {
            // Do not delete the syllable! Just move focus.
            if (focusLast) {
               this.requestFocusShift(undefined, true, -1);
            } else {
               this.requestFocusShift(undefined, false, +1);
            }
          } else {
            this.requestFocusShift(undefined, focusLast, -1);
          }
        }

        return nextNote;
      });
    }
  }

  toggleLiquescent(): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      if (f.isLatent) {
        delete f.isLatent;
      }
      f.liquescent = !f.liquescent;
    });
  }

  toggleNoteType(t: VM.NoteType): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      if (f.isLatent) {
        delete f.isLatent;
      }
      if (f.noteType === t) {
        f.noteType = VM.NoteType.Normal;
      } else {
        f.noteType = t;
      }
    });
  }



  changePitch(producer: (n: VM.Note) => VM.Note): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      if (f.isLatent) {
        delete f.isLatent;
      }
      const newNote = producer(f);
      f.octave = newNote.octave;
      f.base = newNote.base;
    });
  }

  focusOther(selector: (s: VM.Spaced, f: VM.Note) => VM.Note | undefined, notFoundAction: () => void): void {
    this.withOther(f => selector(this.getVoices()[this.focusedVoiceIndex], f), (focused, other) => {
      focused.focus = false;
      other.focus = true;
    }, notFoundAction);
  }


  withOther(selector: (f: VM.Note) => VM.Note | undefined, action: (f: VM.Note, o: VM.Note) => void, notFoundAction?: () => void): void {
    this.withFocus(focused => {
      const other = selector(focused);
      if (other === undefined) {
        if (notFoundAction) {
          notFoundAction();
        }
      } else {
        action(focused, other);
      }
    });
  }

  withPath<A>(f: (s: VM.Spaced, ns: VM.NonSpaced, gr: VM.Grouped, no: VM.Note) => A): A | undefined {
    const path = VM.getFocusedPath(this.getVoices()[this.focusedVoiceIndex]);
    if (path !== undefined) {
      const [s, ns, gr, no] = path;
      return f(s, ns, gr, no);
    }
  }

  withFocus(f: (focused: VM.Note) => void): void {
    const focused = VM.getFocused(this.getVoices()[this.focusedVoiceIndex]);
    if (focused) {
      if (!focused.isLatent) {
        this.focusService.lastPitch = { base: focused.base, octave: focused.octave };
      }
      f(focused);
    }
  }

  getDrawables(voiceIndex: number): Drawable[] {
    const newModelString = JSON.stringify([this.model, this.comments]);
    if (this.lastModelString === newModelString) {
      return this.drawablesCache[voiceIndex] || [];
    } else {
      this.lastModelString = newModelString;
      this.drawablesCache = fromSpaceds(this.getVoices(), this.comments);
      return this.drawablesCache[voiceIndex] || [];
    }
  }

  textToNotes(voiceIndex: number): void {
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    const text = el.textContent || '';
    const voices = this.getVoices();
    try {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      this.lastModelString = '';
      const newNotes = musicLanguage.Spaced.tryParse(text);
      const uuidInfo = VM.copyUuids(voices[voiceIndex], newNotes);
      const commentsToUpdate = this.comments.filter(c => uuidInfo.lostUUIDs.find(u => c.startUUID === u || c.endUUID === u));

      if (commentsToUpdate.length > 0 && uuidInfo.fallbackUUID === undefined) {
        window.alert('You cannot delete this note because a comment would be lost. Please remove the comment first.');
        this.notesToText();
        return;
      } else if (uuidInfo.fallbackUUID) {
        for (let c of commentsToUpdate) {
          if (uuidInfo.lostUUIDs.find(u => c.startUUID === u)) {
            c.startUUID = uuidInfo.fallbackUUID;
          }
          if (uuidInfo.lostUUIDs.find(u => c.endUUID === u)) {
            c.endUUID = uuidInfo.fallbackUUID;
          }
        }
      }
      
      if (voiceIndex === 0) {
        this.model.notes = newNotes;
      } else {
        if (!this.model.additionalMelodies) this.model.additionalMelodies = [];
        this.model.additionalMelodies[voiceIndex - 1] = newNotes;
      }

    } catch (e) {
      return;
    }
  }

  notesToText(): void {
    if (!this.noteTextElements) return;
    const elements = this.noteTextElements.toArray();
    const voices = this.getVoices();
    for (let i = 0; i < voices.length; i++) {
      if (elements[i]) {
        elements[i].nativeElement.textContent = spacedToString(voices[i]);
      }
    }
  }

  addSyllableTool() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments(true); },
          icon: 'chat-text',
          title: 'Show comments'
        }
      ]
    });
  }

  setSyllFocus(focus: boolean): void {
    if (!focus) {
      if (this.focusService.preferredFocus === Focus.Text) {
        this.timeoutF = setTimeout(() => this.toolsService.remove(this), 100);
      }
    } else {
      this.addSyllableTool();
    }
  }

  setCodeAsPreferredFocus(voiceIndex: number = 0): void {
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredFocus = Focus.Code;
  }

  setTextAsPreferredFocus(): void {
    this.focusService.preferredFocus = Focus.Text;
    this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.Syllable, endUUID: this.model.uuid });
  }

  drawableClicked(d: Drawable, me: MouseEvent, voiceIndex: number): void {
    this.focusedVoiceIndex = voiceIndex;
    this.focusService.preferredVoiceIndex = voiceIndex;
    me.preventDefault();
    me.stopPropagation();
    this.focusService.preferredFocus = Focus.Notes;
    const e = (this.domRoot.nativeElement as HTMLElement);
    if (d instanceof DNote || d instanceof DCommentStart || d instanceof DCommentEnd) {
      this.addNoteTools();
      this.focusService.registerFocus(() => { VM.removeFocusFromLinePart(this.model); this.cdr.markForCheck(); });
      VM.focusOne(this.getVoices()[voiceIndex], d.ref);
      // Track the selected note globally so brackets in *other* syllables
      // can light up in palette colors keyed to the comments touching this
      // note. Cleared only when the user picks a different note or clicks
      // away (see setDivFocus blur).
      this.focusService.focusedNoteUUID = d.ref.uuid;
      setTimeout(() => this.cdr.markForCheck(), 0);
      this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.Note, endUUID: d.ref.uuid });
    }
  }

  findPatternForNote(noteUuid: string): { patternId: string; basePattern: string } | null {
    if (this.model.kind !== 'Syllable') return null;
    const notes = this.model.notes;
    if (!notes || !notes.spaced) return null;

    for (const spacedItem of notes.spaced) {
      if (spacedItem.nonSpaced) {
        for (const ns of spacedItem.nonSpaced) {
          if (ns.grouped) {
            for (const g of ns.grouped) {
              if (g.uuid === noteUuid) {
                const patternId = extractPattern({ nonSpaced: [ns] } as VM.NonSpaced);
                if (patternId) {
                  const basePattern = patternId.replace(/[QOSLAD]/g, '');
                  return { patternId, basePattern };
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  findFirstPatternForSyllable(): { patternId: string; basePattern: string } | null {
    if (this.model.kind !== 'Syllable') return null;
    const notes = this.model.notes;
    if (!notes || !notes.spaced) return null;

    for (const spacedItem of notes.spaced) {
      if (spacedItem.nonSpaced) {
        for (const ns of spacedItem.nonSpaced) {
          if (ns.grouped && ns.grouped.length > 0) {
            const firstNoteUuid = ns.grouped[0].uuid;
            if (firstNoteUuid) {
              return this.findPatternForNote(firstNoteUuid);
            }
          }
        }
      }
    }
    return null;
  }

  onContextMenu(me: MouseEvent, d: Drawable, voiceIndex: number): void {
    if (!(d instanceof DNote)) {
      return;
    }
    
    // First, select the note
    this.drawableClicked(d, me, voiceIndex);

    const items = [
      {
        label: 'Set to Flat (f)',
        action: () => { this.toggleNoteType(VM.NoteType.Flat); }
      },
      {
        label: 'Set to Sharp (s)',
        action: () => { this.toggleNoteType(VM.NoteType.Sharp); }
      },
      {
        label: 'Set to Natural (n)',
        action: () => { this.toggleNoteType(VM.NoteType.Normal); }
      },
      {
        label: 'Toggle Liquescent (l)',
        action: () => { this.toggleLiquescent(); }
      },
      {
        label: 'Split Line After Syllable',
        action: () => { this.request.emit({ kind: 'SplitLineRequested' }); }
      },
      {
        label: 'Add Comment (Ctrl+K)',
        action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); }
      }
    ];

    const patInfo = this.findPatternForNote(d.ref.uuid);
    if (patInfo) {
      items.push({
        label: 'Open in Pattern Overview',
        action: () => { this.router.navigate(['/stats'], { queryParams: { pattern: patInfo.basePattern } }); }
      });
      items.push({
        label: 'Open Pattern Variants',
        action: () => { this.router.navigate(['/stats'], { queryParams: { pattern: patInfo.basePattern, showVariants: 'true' } }); }
      });
    }

    this.contextMenuService.open(me, items, 'transcription', 'entering-notes');
  }

  onSyllableContextMenu(me: MouseEvent): void {
    me.preventDefault();
    me.stopPropagation();
    this.setTextAsPreferredFocus();
    
    const items = [
      {
        label: 'Clear Syllable Text',
        action: () => { 
          this.model.text = ''; 
          (this.syllableTextElement.nativeElement as HTMLElement).textContent = '';
          this.recalculateWidths();
          this.request.emit({ kind: "NoFocusRequested" });
        }
      },
      {
        label: 'Split Line After Syllable',
        action: () => { this.request.emit({ kind: 'SplitLineRequested' }); }
      },
      {
        label: 'Add Comment (Ctrl+K)',
        action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); }
      }
    ];

    const patInfo = this.findFirstPatternForSyllable();
    if (patInfo) {
      items.push({
        label: 'Open in Pattern Overview',
        action: () => { this.router.navigate(['/stats'], { queryParams: { pattern: patInfo.basePattern } }); }
      });
      items.push({
        label: 'Open Pattern Variants',
        action: () => { this.router.navigate(['/stats'], { queryParams: { pattern: patInfo.basePattern, showVariants: 'true' } }); }
      });
    }

    this.contextMenuService.open(me, items, 'transcription', 'entering-syllables');
  }

  addNoteTools() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments(false); },
          icon: 'chat-text',
          title: 'Show comments'
        },
        {
          callback: () => { this.changeType(); this.cdr.markForCheck(); },
          icon: 'music-note-list',
          title: 'Change syllable type'
        },
        {
          callback: () => { this.deleteNote(false); this.cdr.markForCheck(); },
          icon: 'trash',
          title: 'Delete'
        }
      ]
    });
  }

  changeType(): void {
    const t = this.model.syllableType;
    this.undoService.beforeChange('Edit Note');
    this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
    switch (t) {
      case VM.SyllableType.Normal:
        this.model.syllableType = VM.SyllableType.WithoutNotes;
        break;
      case VM.SyllableType.WithoutNotes:
        this.model.syllableType = VM.SyllableType.SourceEllipsis;
        break;
      case VM.SyllableType.SourceEllipsis:
        this.model.syllableType = VM.SyllableType.EditorialEllipsis;
        break;
      case VM.SyllableType.EditorialEllipsis:
        this.model.syllableType = VM.SyllableType.Normal;
        break;
      default: assertNever(t);
    }

    this.refocus();
  }


  refocus(): void {
    if (this.notesDivElements) {
        (this.notesDivElements.toArray()[this.focusedVoiceIndex].nativeElement as HTMLElement).focus();
    }
  }

  calculateWidth(): number {
    let maxNoteTextWidth = 0;
    if (this.noteTextElements) {
        this.noteTextElements.forEach(el => {
            const w = textWidth(el.nativeElement.textContent || '');
            if (w > maxNoteTextWidth) maxNoteTextWidth = w;
        });
    }
    const syllableText = this.syllableTextElement ? (this.syllableTextElement.nativeElement.textContent || '') : '';
    this.noteTextWidth = maxNoteTextWidth;
    this.syllTextWidth = textWidth(syllableText);
    
    let maxSvgWidth = 0;
    const voices = this.getVoices();
    for (let i = 0; i < voices.length; i++) {
        const w = (maxOf(this.getDrawables(i).map(d => d.x)) || 0) + 12;
        if (w > maxSvgWidth) maxSvgWidth = w;
    }
    this.svgWidth = maxSvgWidth;

    const isEdit = !this.readOnly;
    const minW = isEdit ? 40 : (this.hideSyllableText ? 12 : 30);
    const padding = isEdit ? 20 : (this.hideSyllableText ? 6 : 12);
    const activeSyllTextWidth = (this.hideSyllableText && !isEdit) ? 0 : this.syllTextWidth;
    return Math.max(minW, this.noteTextWidth, activeSyllTextWidth, this.svgWidth) + padding;
  }

  recalculateWidths(): void {
    this.syllableWidth = this.calculateWidth();
  }

  isNote: (d: Drawable) => boolean = d => d instanceof DNote;
  isTie: (d: Drawable) => boolean = d => d instanceof DTie;
  isCommentStart: (d: Drawable) => boolean = d => d instanceof DCommentStart;
  isCommentEnd: (d: Drawable) => boolean = d => d instanceof DCommentEnd;
  isHelperLine: (d: Drawable) => boolean = d => d instanceof DHelperLine;

  isHighlighted(d: Drawable): boolean {
    if (!this.highlightNoteUUIDs || !d.ref) return false;
    const ref = d.ref;
    if ('uuid' in ref) {
      return this.highlightNoteUUIDs.has(ref.uuid);
    }
    return false;
  }

  isThisCommentStart(): boolean {
    return this.comments.some(c => c.startUUID === this.model.uuid);
  }

  isThisCommentEnd(): boolean {
    return this.comments.some(c => c.endUUID === this.model.uuid);
  }

  /** Default neutral color when nothing is selected. */
  private static readonly NEUTRAL = '#A5A5A5';

  /** Returns the palette color assigned to a given comment, based on its
   *  position in the document's comment list. Order-stable. */
  commentColor(c: VM.Comment | undefined): string {
    if (!c) return NotesComponent.NEUTRAL;
    const idx = this.comments.indexOf(c);
    if (idx < 0) return NotesComponent.NEUTRAL;
    return commentColor(idx);
  }

  /** True when palette colors should currently be shown — i.e., the user has
   *  selected a note somewhere in the document. */
  get useBracketColors(): boolean {
    return !!this.focusService.focusedNoteUUID;
  }

  /** Color for the syllable-level outer bracket. `role` picks start vs end. */
  syllableBracketColor(role: 'start' | 'end'): string {
    if (!this.useBracketColors) return NotesComponent.NEUTRAL;
    const c = this.comments.find(c => role === 'start'
      ? c.startUUID === this.model.uuid
      : c.endUUID === this.model.uuid);
    return this.commentColor(c);
  }

  /** Color for the per-note bracket drawn by a DCommentStart / DCommentEnd. */
  drawableBracketColor(d: Drawable): string {
    if (!this.useBracketColors) return NotesComponent.NEUTRAL;
    if (d instanceof DCommentStart) {
      return this.commentColor(this.comments.find(c => c.startUUID === d.ref.uuid));
    }
    if (d instanceof DCommentEnd) {
      return this.commentColor(this.comments.find(c => c.endUUID === d.ref.uuid));
    }
    return NotesComponent.NEUTRAL;
  }

  /** True if the document is in step 1 of the comment-creation flow
   *  (waiting for the user to pick the start note). */
  get isPickingCommentStart(): boolean {
    return this.focusService.mode.kind === 'CommentPickStart';
  }

  /** True if the document is in step 2 (waiting for the end note). */
  get isPickingCommentEnd(): boolean {
    return this.focusService.mode.kind === 'CommentCreate';
  }

  /** True if the given drawable's note IS the currently-picked start note. */
  isPickedCommentStart(d: Drawable): boolean {
    if (this.focusService.mode.kind !== 'CommentCreate') return false;
    if (!(d instanceof DNote)) return false;
    return d.ref.uuid === this.focusService.mode.startNoteUUID;
  }

  refOfDrawable(_: number, d: Drawable): any {
    if (d instanceof DNote) {
      return d.ref.uuid;
    } else if (d instanceof DCommentStart) {
      return d.ref.uuid + 'comment-start';
    } else if (d instanceof DCommentEnd) {
      return d.ref.uuid + 'comment-end';
    } else if (d instanceof DHelperLine) {
      return d.ref.uuid + 'helper-line';
    } else {
      return d;
    }
  }

  trackByIndex(index: number, obj: any): any {
    return index;
  }
  isGroupedLayout(): boolean {
    return !!(window as any).groupedLayout;
  }
  isNormal(): boolean { return this.model.syllableType === VM.SyllableType.Normal; }
  isWithoutNotes(): boolean { return this.model.syllableType === VM.SyllableType.WithoutNotes; }
  isSourceEllipsis(): boolean { return this.model.syllableType === VM.SyllableType.SourceEllipsis; }
  isEditorEllipsis(): boolean { return this.model.syllableType === VM.SyllableType.EditorialEllipsis; }

  getWidth(): number {
    const isEdit = !this.readOnly;
    const minW = isEdit ? 40 : (this.hideSyllableText ? 12 : 30);
    const padding = isEdit ? 20 : (this.hideSyllableText ? 6 : 12);
    const activeSyllTextWidth = (this.hideSyllableText && !isEdit) ? 0 : this.syllTextWidth;
    let baseW = padding;
    if (this.isNormal()) {
      baseW += Math.max(minW, this.noteTextWidth, activeSyllTextWidth, this.svgWidth);
    } else {
      baseW += Math.max(minW, activeSyllTextWidth);
    }
    return baseW * this.staffScale;
  }

  getWidth2(): number {
    let t = this.getWidth();
    console.log(t);
    return t;
  }

  getSVGWidth(): number {
    return this.svgWidth;
  }
}

export function spacedToString(spaced: VM.Spaced): string {
    let noteToString = (note: VM.Note) => {
    let baseStr = note.base as string;
    let explicitOctave = note.octave;

    if (note.octave === 3 && (note.base === 'A' || note.base === 'B')) {
        baseStr = note.base;
        explicitOctave = -1;
    } else if (note.octave === 4 && (note.base !== 'A' && note.base !== 'B')) {
        baseStr = note.base;
        explicitOctave = -1;
    } else if (note.octave === 4 && (note.base === 'A' || note.base === 'B')) {
        baseStr = note.base.toLowerCase();
        explicitOctave = -1;
    } else if (note.octave === 5 && (note.base !== 'A' && note.base !== 'B')) {
        baseStr = note.base.toLowerCase();
        explicitOctave = -1;
    }

    let modifierString =
      (explicitOctave !== -1 ? explicitOctave : '') +
      (note.noteType !== VM.NoteType.Normal ? VM.noteTypeToString(note.noteType) : '') +
      (note.liquescent ? 'l' : '');

    return baseStr + (modifierString !== '' ? (`[` + modifierString + `]`) : '');
  }

  return spaced.spaced.map(nonSpaced =>
    nonSpaced.nonSpaced.map(group =>
      group.grouped.map(noteToString).join('')).join(' ')).join('  ')
}

function noteFromTemplate(n: VM.Note): VM.Note {
  const newNote: VM.Note = JSON.parse(JSON.stringify(n));
  newNote.noteType = VM.NoteType.Normal;
  newNote.liquescent = false;
  newNote.uuid = UUID();
  return newNote;
}
