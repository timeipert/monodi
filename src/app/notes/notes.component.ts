import { G_CLEF_PATH } from '../clef-glyph';
import { GLYPH_PATHS } from './glyph-paths';
import {
  ChangeDetectorRef, Component, OnInit, OnChanges, QueryList, ViewChildren,
  OnDestroy, ChangeDetectionStrategy, ElementRef, ViewChild, TemplateRef, Output, Input, EventEmitter, AfterViewInit, HostListener,
  SimpleChanges
} from '@angular/core';
import * as VM from '../types/model';
import { fromSpaceds, adiastematicFromSpaceds, Drawable, DNote, DTie, DCommentStart, DCommentEnd, DHelperLine } from './Drawables';
import { spacedToParsons, parsonsToSpaced } from './parsons';
import { EditorShortcutsService, ShortcutConfig, DEFAULT_SHORTCUTS } from './editor-shortcuts.service';
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
import { NoteFlagDef, flagDefsOf, flagForShortcutKey, flagShortcutKey, getNoteFlagDefs } from './note-flags';
import { ContextMenuItem, ContextMenuService } from '../context-menu/context-menu.service';
import { Router } from '@angular/router';
import { SearchExecService } from '../search/search-exec.service';
import { extractPattern } from '../transcription-analyzer-core';
import { ManuscriptViewService } from '../manuscript-view.service';

declare const $: any;

@Component({
    selector: 'app-notes',
    templateUrl: './notes.component.html',
    styleUrls: ['./notes.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class NotesComponent implements OnDestroy, OnInit, OnChanges, Focusable, AfterViewInit {
  /** Top padding actually used: the configured one, or more if the document has very high notes. */
  get padTopEff(): number { return Math.max(this.readOnlyPadTop, this.focusService.docPadTop); }

  /** Colour of all notation graphics (project setting `notationColor`). */
  get color(): string { return this.focusService.notationColor; }
  readonly gClefPath = G_CLEF_PATH;

  getGlyphDataUri(noteType: string, focused: boolean): string {
    const d = GLYPH_PATHS[noteType] || GLYPH_PATHS['Normal'];
    const fill = focused ? '#5bf186' : this.color;
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

  /** Draw a leading G-clef on this element because it is the first element of
   *  its staff line (set per-line from the template). OR-ed into `showClef`. */
  @Input()
  showGClef = false;

  /** When true, render contour-only neume heads with no staff lines and no
   *  clef (adiastematic notation). The melody model/text is unchanged. */
  @Input()
  adiastematic = false;

  /** Extra vertical room (internal units) above/below the staff in read-only
   *  renders, so very high/low notes are not clipped (used by the synopsis). */
  @Input()
  readOnlyPadTop = 0;
  @Input()
  readOnlyPadBottom = 0;

  syllableWidth = 0;
  noteTextWidth = 0;
  syllTextWidth = 0;
  svgWidth = 0;
  hasFocus: boolean[] = [];
  focusedVoiceIndex = 0;
  timeoutF: any = undefined;
  drawablesCache: Drawable[][] = [];
  /** Drawables are rebuilt only when the model/comments change (input change via
   *  ngOnChanges, or an in-place edit via recalculateWidths) — never per CD tick. */
  private drawablesDirty = true;

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

  @Input()
  docId?: string;

  @ViewChild('shortcutsConfigModal') shortcutsConfigModal!: TemplateRef<any>;
  editingShortcuts: ShortcutConfig = { ...DEFAULT_SHORTCUTS };

  constructor(
    private focusService: FocusService,
    private cdr: ChangeDetectorRef,
    private toastr: ToastrService,
    private toolsService: ToolsService,
    private undoService: UndoService,
    private modalService: NgbModal,
    private contextMenuService: ContextMenuService,
    private router: Router,
    private searchExecSvc: SearchExecService,
    private manuscriptView: ManuscriptViewService,
    public shortcutsService: EditorShortcutsService) {
  }

  openShortcutsModal(): void {
    this.editingShortcuts = { ...this.shortcutsService.getShortcuts() };
    if (this.shortcutsConfigModal) {
      this.modalService.open(this.shortcutsConfigModal, { centered: true });
    }
  }

  updateShortcutKey(key: keyof ShortcutConfig, event: any): void {
    const val = event.target.value;
    if (val !== undefined) {
      this.editingShortcuts[key] = val;
    }
  }

  saveShortcutsModal(): void {
    this.shortcutsService.saveShortcuts(this.editingShortcuts);
    this.toastr.success('Keyboard shortcuts updated.');
  }

  resetShortcutsModal(): void {
    this.shortcutsService.resetToDefaults();
    this.editingShortcuts = { ...this.shortcutsService.getShortcuts() };
    this.toastr.info('Keyboard shortcuts reset to defaults.');
  }

  refresh() {
    this.drawablesDirty = true;
    if (this.syllableTextElement?.nativeElement) {
      (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model?.text || '';
    }
    this.notesToText();
    this.recalculateWidths();
    this.cdr.detectChanges();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.drawablesDirty = true;
    if (this.syllableTextElement?.nativeElement) {
      const currentDomText = (this.syllableTextElement.nativeElement as HTMLElement).textContent || '';
      const modelText = this.model?.text || '';
      if (currentDomText !== modelText) {
        (this.syllableTextElement.nativeElement as HTMLElement).textContent = modelText;
      }
    }
    this.notesToText();
    this.recalculateWidths();
    this.cdr.markForCheck();
  }

  ngOnInit() {
    this.notesToText();
    if (this.syllableTextElement?.nativeElement) {
      (this.syllableTextElement.nativeElement as HTMLElement).textContent = this.model?.text || '';
    }
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
    // Only needed for editable syllables (comment-bracket colouring). In the
    // read-only synopsis there can be hundreds of these components, so skip the
    // per-instance subscription there.
    if (!this.readOnly) {
      this.focusedNoteSub = this.focusService.focusedNoteUUID$.subscribe(() => {
        this.cdr.markForCheck();
      });
    }
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
    const oldNoteText = this.voiceToCode(voices[voiceIndex]);
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

  isShortcutMatch(e: KeyboardEvent, configuredKey: string, defaultKey: string): boolean {
    if (!configuredKey) return false;
    const parts = configuredKey.trim().toLowerCase().split('+').map(p => p.trim());
    if (parts.length === 0) return false;

    const mainKey = parts[parts.length - 1];
    const requiredCtrl = parts.includes('ctrl') || parts.includes('control');
    const requiredAlt = parts.includes('alt') || parts.includes('option');
    // 'shift' is required whenever it appears — including a lone "Shift" shortcut
    // (e.g. insert-connected-note). The previous `&& parts.length > 1` guard made
    // requiredShift=false for a lone Shift, so line below then rejected the event
    // (e.shiftKey is true) and the `mainKey === 'shift'` case was never reached.
    const requiredShift = parts.includes('shift');
    const requiredMeta = parts.includes('cmd') || parts.includes('meta');

    if (requiredCtrl !== (e.ctrlKey || (requiredCtrl && e.metaKey))) return false;
    if (requiredAlt !== e.altKey) return false;
    if (requiredShift !== e.shiftKey) return false;
    if (requiredMeta && !e.metaKey) return false;

    if (mainKey === 'shift') {
      return e.key === 'Shift' || e.key === 'shift' || (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey);
    }
    if (mainKey === 'space' || mainKey === ' ' || mainKey === 'spacebar') {
      return e.key === ' ' || e.code === 'Space';
    }
    if (mainKey === 'enter' || mainKey === 'return') {
      return e.key === 'Enter';
    }
    if (mainKey === 'tab') {
      return e.key === 'Tab';
    }
    if (mainKey === 'alt' || mainKey === 'option') {
      return e.key === 'Alt' || e.altKey;
    }
    if (mainKey === 'control' || mainKey === 'ctrl') {
      return e.key === 'Control' || e.ctrlKey;
    }
    return e.key.toLowerCase() === mainKey;
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
    else if (e.key === 'ArrowUp') { this.adiastematic ? this.changeAdiaDirection(+1) : this.changePitch(VM.nextNote); }
    else if (e.altKey && e.key === 't') { this.request.emit({ kind: 'EditSyllableTextReqested' }); }
    else if (e.altKey && e.key === 'n') { this.request.emit({ kind: 'EditNotesTextReqested' }); }
    else if (e.altKey && e.key === 'ArrowRight') { this.insertOrShiftRight(); }
    else if (e.altKey && e.key === 'ArrowLeft') { } //do nothing
    else if (e.altKey && e.key === 'Enter') { this.splitLine(); }
    else if (e.ctrlKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.altKey && e.key === '.') { this.request.emit({ kind: 'ChangeToBoxRequested' }); }
    else if (e.key === 'ArrowDown') { this.adiastematic ? this.changeAdiaDirection(-1) : this.changePitch(VM.previousNote); }
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
    else {
      const sc = this.shortcutsService.getShortcuts();
      const k = e.key.toLowerCase();

      const flagDef = this.flagForKeyEvent(e);
      if (flagDef) { this.toggleFlag(flagDef.key); }
      else if (k === sc.setSharp.toLowerCase()) { this.toggleNoteType(VM.NoteType.Sharp); }
      else if (k === sc.setNatural.toLowerCase()) { this.toggleNoteType(VM.NoteType.Natural); }
      else if (k === sc.setFlat.toLowerCase()) { this.toggleNoteType(VM.NoteType.Flat); }
      else if (k === sc.setOriscus.toLowerCase()) { this.toggleNoteType(VM.NoteType.Oriscus); }
      else if (k === sc.setAscending.toLowerCase()) { this.toggleNoteType(VM.NoteType.Ascending); }
      else if (k === sc.setDescending.toLowerCase()) { this.toggleNoteType(VM.NoteType.Descending); }
      else if (k === sc.setStrophicus.toLowerCase()) { this.toggleNoteType(VM.NoteType.Strophicus); }
      else if (k === sc.setQuilisma.toLowerCase()) { this.toggleNoteType(VM.NoteType.Quilisma); }
      else if (k === sc.toggleLiquescent.toLowerCase()) { this.toggleLiquescent(); }
      else if (this.isShortcutMatch(e, sc.insertConnectedNote, 'Shift')) { this.insertNoteSlur(); }
      else if (this.isShortcutMatch(e, sc.insertNearNote, 'Space')) { this.insertNear(); }
      else if (this.isShortcutMatch(e, sc.insertFarNote, 'Enter')) { this.insertFar(); }
      else if (k === sc.newClef.toLowerCase()) { this.request.emit({ kind: 'NewClefRequested' }); }
      else if (k === sc.newSegment.toLowerCase()) { this.request.emit({ kind: 'NewSegmentRequested', syllableType: this.model.syllableType, text: '' }); }
      else if (this.isShortcutMatch(e, sc.splitLine, 'Alt+Enter')) { this.splitLine(); }
      else if (this.isShortcutMatch(e, sc.mergeWithNextLine, 'Alt+m')) {
        document.dispatchEvent(new CustomEvent('monodi-shortcut', { detail: { action: 'mergeWithNextLine' } }));
      }
      else if (this.isShortcutMatch(e, sc.mergeSection, 'Alt+Shift+m')) {
        document.dispatchEvent(new CustomEvent('monodi-shortcut', { detail: { action: 'mergeSection' } }));
      }
      else if (this.isShortcutMatch(e, sc.mergeAllLines, 'Ctrl+Alt+m')) {
        document.dispatchEvent(new CustomEvent('monodi-shortcut', { detail: { action: 'mergeAllLines' } }));
      }
      else if (e.key === 'j') { this.request.emit({ kind: 'LineChangeRequested', after: true }); }
      else if (e.key === 'i') { this.request.emit({ kind: 'LineChangeRequested', after: false }); }
      else if (e.key === 'Delete') { this.deleteNote(false); }
      else if (e.key === 'Backspace') { this.deleteNote(true); }
      else if (e.ctrlKey && e.key === 'z') {
        this.undoService.undo();
      }
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
      this.withPath((s, ns, gr, no) => {
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

  toggleFlag(key: string): void {
    this.withFocus(f => {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
      if (f.isLatent) {
        delete f.isLatent;
      }
      const flags = (f.flags ?? []).filter(k => k !== key);
      if (flags.length === (f.flags ?? []).length) flags.push(key);
      if (flags.length > 0) f.flags = flags; else delete f.flags;
    });
  }

  /** Keyboard edits end with this; menu actions have to call it themselves. */
  private refreshNoteText(): void {
    this.notesToText();
    this.recalculateWidths();
  }

  /** Digit key (1-9, 0) that toggles the flag; null beyond the tenth flag. */
  flagShortcut(key: string): string | null {
    return flagShortcutKey(getNoteFlagDefs(), key);
  }

  /** The flag a plain digit key press stands for, if any. */
  private flagForKeyEvent(e: KeyboardEvent): NoteFlagDef | undefined {
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return undefined;
    return flagForShortcutKey(getNoteFlagDefs(), e.key);
  }

  /** Context-menu entries for the flags: a few are listed directly, many fold into one item. */
  private flagMenuItems(note: VM.Note): ContextMenuItem[] {
    const defs = getNoteFlagDefs();
    if (defs.length === 0) return [];
    const items: ContextMenuItem[] = defs.map(fd => {
      const sc = this.flagShortcut(fd.key);
      return {
        label: sc ? `${fd.label}  (${sc})` : fd.label,
        checked: (note.flags ?? []).includes(fd.key),
        action: () => { this.toggleFlag(fd.key); this.refreshNoteText(); }
      };
    });
    if (defs.length <= 4) {
      return [{ label: 'Flags', header: true, action: () => {} }, ...items];
    }
    const set = items.filter(i => i.checked).map(i => i.label.split('  (')[0]);
    return [{ label: set.length ? `Flags: ${set.join(', ')}` : `Flags (${defs.length})`, action: () => {}, children: items }];
  }

  /** Flag markers drawn above a note head (abbreviation or SVG outline). */
  flagMarkers(n: VM.Note): NoteFlagDef[] {
    return flagDefsOf(n.flags);
  }

  flagViewBox(d: NoteFlagDef): string { return d.viewBox || '0 0 10 10'; }

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



  /**
   * Adiastematic pitch change: a note's only meaningful states are up / level /
   * down relative to the previous note of its neume. Arrow up/down moves the
   * focused note by one such step, clamped to [-1, +1] — so once it can't go
   * any further in that direction it makes NO change (no silent runaway that
   * you'd have to undo step by step). The focused note and everything after it
   * shift together, keeping every other relationship intact.
   */
  changeAdiaDirection(dir: number): void {
    const voice = this.getVoices()[this.focusedVoiceIndex];
    const path = VM.getFocusedPath(voice);
    if (!path) return;
    const [, ns, , no] = path;
    const neumeNotes: VM.Note[] = [];
    for (const g of ns.nonSpaced) for (const n of g.grouped) neumeNotes.push(n);
    const idx = neumeNotes.indexOf(no);
    if (idx <= 0) return; // first note of the neume is the baseline — nothing relative to change
    const prev = neumeNotes[idx - 1];
    const rel = (no.octave * 7 + VM.baseNoteIndexes[no.base]) - (prev.octave * 7 + VM.baseNoteIndexes[prev.base]);
    const clamped = Math.max(-1, Math.min(1, rel));
    const target = Math.max(-1, Math.min(1, clamped + dir));
    const delta = target - rel;
    if (delta === 0) return; // already at the limit → don't change state
    this.undoService.beforeChange('Edit Note');
    this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback);
    // Shift the focused note and everything after it within this voice so all
    // downstream directions are preserved.
    let reached = false;
    for (const sp of voice.spaced) {
      for (const g2 of sp.nonSpaced) {
        for (const n of g2.grouped) {
          if (n === no) reached = true;
          if (reached) VM.transposeNote(n, delta);
        }
      }
    }
    this.focusService.lastPitch = { base: no.base, octave: no.octave };
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

  /**
   * Bottom padding of the read-only SVG (units). Notes and ledger lines far below the
   * staff (A3 and lower) used to be cut at the fixed edge; the SVG now grows as far as
   * the lowest drawable needs. (The visible area ends at y = 85 + padBottom.)
   */
  readOnlyPadBottomFor(voiceIndex: number): number {
    let lowest = 0;
    for (const d of this.getDrawables(voiceIndex)) {
      if (d instanceof DNote) lowest = Math.max(lowest, d.y + (d.ref.noteType === VM.NoteType.Descending ? 43 : 36));
      else if (d instanceof DHelperLine) lowest = Math.max(lowest, d.y + 1);
    }
    return Math.max(this.readOnlyPadBottom, this.focusService.docPadBottom, Math.ceil(lowest + 2 - 85));
  }

  getDrawables(voiceIndex: number): Drawable[] {
    if (this.drawablesDirty) {
      this.drawablesCache = this.adiastematic
        ? adiastematicFromSpaceds(this.getVoices(), this.comments)
        : fromSpaceds(this.getVoices(), this.comments);
      this.drawablesDirty = false;
    }
    return this.drawablesCache[voiceIndex] || [];
  }

  textToNotes(voiceIndex: number): void {
    const el = this.noteTextElements.toArray()[voiceIndex].nativeElement as HTMLElement;
    const text = el.textContent || '';
    const voices = this.getVoices();
    try {
      this.undoService.beforeChange('Edit Note');
      this.undoService.registerNotesCallbacks(this.model.uuid, this.undoCallback)
      this.drawablesDirty = true;
      const newNotes = this.adiastematic ? parsonsToSpaced(text) : musicLanguage.Spaced.tryParse(text);
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
        elements[i].nativeElement.textContent = this.voiceToCode(voices[i]);
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

    // The pattern of a note is that of its whole neume (all ligature groups written without a gap).
    for (const spacedItem of notes.spaced) {
      if (spacedItem.nonSpaced) {
        for (const ns of spacedItem.nonSpaced) {
          if (ns.grouped) {
            for (const g of ns.grouped) {
              if (g.uuid === noteUuid) {
                const patternId = extractPattern(spacedItem);
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

    const sc = this.shortcutsService.getShortcuts();
    const items: ContextMenuItem[] = [
      {
        label: `Set to Flat (${sc.setFlat})`,
        action: () => { this.toggleNoteType(VM.NoteType.Flat); this.refreshNoteText(); }
      },
      {
        label: `Set to Sharp (${sc.setSharp})`,
        action: () => { this.toggleNoteType(VM.NoteType.Sharp); this.refreshNoteText(); }
      },
      {
        label: `Set to Natural (${sc.setNatural})`,
        action: () => { this.toggleNoteType(VM.NoteType.Normal); this.refreshNoteText(); }
      },
      {
        label: `Toggle Liquescent (${sc.toggleLiquescent})`,
        action: () => { this.toggleLiquescent(); this.refreshNoteText(); }
      },
      ...this.flagMenuItems(d.ref),
      {
        label: 'Split Line After Syllable',
        action: () => { this.request.emit({ kind: 'SplitLineRequested' }); }
      },
      {
        label: `Add Comment (Ctrl+${sc.addComment.toUpperCase()})`,
        action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: sc.addComment, ctrlKey: true })); }
      },
      {
        label: '⚙️ Keyboard Shortcuts Settings...',
        action: () => { this.openShortcutsModal(); }
      }
    ];

    if (this.manuscriptView.canShow()) {
      const noteUuid = d.ref.uuid;
      items.push({
        label: 'Show in manuscript',
        action: () => { void this.manuscriptView.show(noteUuid); }
      });
    }

    const patInfo = this.findPatternForNote(d.ref.uuid);
    if (patInfo) {
      if (getNoteFlagDefs().length > 0) {
        items.push({
          label: 'Flag neumes like this…',
          action: () => { this.request.emit({ kind: 'FlagPatternsRequested', pattern: patInfo.patternId.replace(/[A-Z]/g, '') }); }
        });
      }
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
    
    const sc = this.shortcutsService.getShortcuts();
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
        label: `Add Comment (Ctrl+${sc.addComment.toUpperCase()})`,
        action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: sc.addComment, ctrlKey: true })); }
      },
      {
        label: '⚙️ Keyboard Shortcuts Settings...',
        action: () => { this.openShortcutsModal(); }
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
    // An in-place edit changed the model — rebuild drawables on next read.
    this.drawablesDirty = true;
    this.syllableWidth = this.calculateWidth();
  }

  isNote: (d: Drawable) => boolean = d => d instanceof DNote;
  isTie: (d: Drawable) => boolean = d => d instanceof DTie;
  isCommentStart: (d: Drawable) => boolean = d => d instanceof DCommentStart;
  isCommentEnd: (d: Drawable) => boolean = d => d instanceof DCommentEnd;
  isHelperLine: (d: Drawable) => boolean = d => d instanceof DHelperLine;

  /** Text representation of a voice in the note-code field: Parsons for
   *  adiastematic lines, the normal pitch code otherwise. */
  private voiceToCode(voice: VM.Spaced): string {
    return this.adiastematic ? spacedToParsons(voice) : spacedToString(voice);
  }

  isHighlighted(d: Drawable): boolean {
    if (!d.ref) return false;
    const ref: any = d.ref;
    if (!('uuid' in ref)) return false;
    if (this.highlightNoteUUIDs && this.highlightNoteUUIDs.has(ref.uuid)) return true;
    const targetDocId = this.docId || this.searchExecSvc.activeDocumentHighlight?.documentId;
    return !!this.searchExecSvc.getNoteHighlightColor(targetDocId, ref.uuid);
  }

  getHighlightFill(d: Drawable): string {
    if (d.ref && 'uuid' in d.ref) {
      const targetDocId = this.docId || this.searchExecSvc.activeDocumentHighlight?.documentId;
      const custom = this.searchExecSvc.getNoteHighlightColor(targetDocId, (d.ref as any).uuid);
      if (custom) return custom.fill;
    }
    return '#fde047';
  }

  getHighlightStroke(d: Drawable): string {
    if (d.ref && 'uuid' in d.ref) {
      const targetDocId = this.docId || this.searchExecSvc.activeDocumentHighlight?.documentId;
      const custom = this.searchExecSvc.getNoteHighlightColor(targetDocId, (d.ref as any).uuid);
      if (custom) return custom.stroke;
    }
    return '#eab308';
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

  /** Internal-unit width reserved for the G-clef at the chant start. */
  static readonly CLEF_WIDTH = 32;

  /** Draw a leading G-clef when this is the first element of its staff line
   *  (`showGClef`, set per-line by the template) or the first syllable of the
   *  whole document. Never on adiastematic lines (no staff). */
  get showClef(): boolean {
    if (this.adiastematic) return false;
    if (this.showGClef) return true;
    return !!this.focusService.firstSyllableUuid && !!this.model && this.model.uuid === this.focusService.firstSyllableUuid;
  }

  getWidth(): number {
    const isEdit = !this.readOnly;
    const minW = isEdit ? 40 : (this.hideSyllableText ? 12 : 30);
    const padding = (isEdit ? 20 : (this.hideSyllableText ? 6 : 12)) + (this.showGClef ? 22 : 0);
    const activeSyllTextWidth = (this.hideSyllableText && !isEdit) ? 0 : this.syllTextWidth;
    let baseW = padding;
    if (this.isNormal()) {
      baseW += Math.max(minW, this.noteTextWidth, activeSyllTextWidth, this.svgWidth);
    } else {
      baseW += Math.max(minW, activeSyllTextWidth);
    }
    if (this.showClef) baseW += NotesComponent.CLEF_WIDTH;
    return baseW * this.staffScale;
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
      (note.liquescent ? 'l' : '') +
      (note.flags ? note.flags.join('') : '');

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
