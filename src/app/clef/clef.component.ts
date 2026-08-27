import { AfterViewChecked, ChangeDetectorRef, Component, OnInit, OnDestroy, ChangeDetectionStrategy, ViewRef, ElementRef, ViewChild, Output, Input, EventEmitter } from '@angular/core';
import * as VM from '../types/model';
import { ToolsService, Tool } from '../tools.service';
import { assertNever, maxOf, textWidth, focusContentEditable } from '../../utils';
import { ToastrService } from 'ngx-toastr';
import * as R from '../notes/Request';
import { v4 as UUID } from "uuid";
import { FocusService } from '../focus.service';
import { Subscription } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Focusable, Focus, FocusChange } from '../types/Focus';
import { UndoService } from '../undoService';
import { ContextMenuService } from '../context-menu/context-menu.service';

declare const $: any;

@Component({
  selector: 'app-clef',
  templateUrl: './clef.component.html',
  styleUrls: ['./clef.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ClefComponent implements OnInit, OnDestroy, AfterViewChecked, Focusable {
  @ViewChild('notesDiv', { static: true }) notesDiv!: ElementRef;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;

  @Input()
  readOnly!: boolean;

  @Input()
  comments!: VM.Comment[];

  @Output()
  request = new EventEmitter<R.Request>();

  @Input()
  model!: VM.Clef;

  @Input()
  staffScale = 1.0;

  getActiveComments(): VM.Comment[] {
    if (this.model.focus) {
      return this.comments.filter(c => c.endUUID === this.model.uuid || c.startUUID === this.model.uuid);
    }

    return [];
  }

  getY(): number {
    return 90 - ((this.model.octave - 4) * 35) - VM.baseNotes.indexOf(this.model.base) * 5;
  }

  constructor(
    private focusService: FocusService,
    private cdr: ChangeDetectorRef,
    private toastr: ToastrService,
    private domRoot: ElementRef,
    private toolsService: ToolsService,
    private undoService: UndoService,
    private modalService: NgbModal,
    private contextMenuService: ContextMenuService) {
  }

  ngOnInit() {
  }


  ngOnDestroy() {
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  ngAfterViewChecked() {
  }

  requestDeleteComment(c: VM.Comment): void {
    this.request.emit({ kind: 'CommentDeletionRequested', comment: c });
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    switch (level) {
      case Focus.Code:
      case Focus.Text:
      case Focus.Notes:
        this.model.focus = true;
        (this.notesDiv.nativeElement as HTMLElement).focus();
        break;
      default: assertNever(level);
    }
  }

  getData(): any {
    return this.model;
  }

  showComments() {
    this.modalService.open(this.commentModal);
  }

  keyDown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      return;
    }
    if (e.key === 'Escape') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (e.key == "ArrowUp") { this.changePitch(VM.nextNotePart); }
    else if (e.altKey && e.key === 'Enter') { this.splitLine(e) }
    else if (e.key == "ArrowDown") { this.changePitch(VM.previousNotePart); }
    else if (e.key == "ArrowLeft") { this.requestFocusShift(undefined, true, -1); }
    else if (e.key == "ArrowRight") { this.requestFocusShift(undefined, false, +1); }
    else if (e.key == "f") { this.model.shape = this.model.shape === 'F' ? 'C' : 'F'; }
    else if (e.key == "Backspace") { this.deleteClef(true) }
    else if (e.key == "Delete") { this.deleteClef(false) }
    else if (e.key === "Enter") { this.request.emit({ kind: "NewSegmentRequested", syllableType: VM.SyllableType.Normal, text: "" }); }
    else if (e.key === " ") { this.request.emit({ kind: "NewSegmentRequested", syllableType: VM.SyllableType.Normal, text: "" }); }
    else if (e.key == "k") { this.startComment(); }
    else if (e.key == "j") { this.request.emit({ kind: "LineChangeRequested", after: true }); }
    else if (e.key == "i") { this.request.emit({ kind: "LineChangeRequested", after: false }); }
    else if (e.ctrlKey && e.key === 'z') { this.undoService.undo() }
  }

  splitLine(event: Event) {
    this.request.emit({ kind: 'SplitLineRequested' })
  }

  deleteClef(focusLast: boolean) {
    if (this.getActiveComments().length > 0) {
      this.toastr.info("Please delete the comment before deleting the symbol.");
    } else {
      this.request.emit({ kind: "DeletionRequested", focusLast });
    }
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
    this.model.focus = false;
  }

  startComment(): void {
    if (this.focusService.mode.kind === "Normal") {
      this.focusService.mode = { kind: "CommentCreate", startNoteUUID: this.model.uuid };
      this.toastr.info("Now click the note where the comment should end.", "Pick the end note");
    }
  }

  changePitch(producer: (octave: number, base: VM.BaseNote) => [number, VM.BaseNote]): void {
    const [octave, base] = producer(this.model.octave, this.model.base);
    this.model.octave = octave;
    this.model.base = base;
  }

  onContextMenu(me: MouseEvent): void {
    this.clicked(); // Focus the clef
    const items = [
      {
        label: 'Toggle Clef Shape (f)',
        action: () => { 
          this.model.shape = this.model.shape === 'F' ? 'C' : 'F'; 
          this.cdr.markForCheck();
        }
      },
      {
        label: 'Split Line After Clef',
        action: () => { this.request.emit({ kind: 'SplitLineRequested' }); }
      },
      {
        label: 'Add Comment (Ctrl+K)',
        action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); }
      }
    ];
    this.contextMenuService.open(me, items, 'transcription', 'basic-layout');
  }

  clicked(): void {
    this.focusService.preferredFocus = Focus.Notes;
    if (this.focusService.mode.kind == "CommentCreate") {
      // Pass endKind so the root section can swap start/end correctly when
      // the user picked an earlier element as their second click. Clef is
      // treated like Note for ordering purposes (non-Syllable).
      this.request.emit({
        startUUID: this.focusService.mode.startNoteUUID,
        endUUID: this.model.uuid,
        text: "",
        kind: "NewCommentRequested",
        endKind: VM.CommentPartKind.Note,
      });
      this.focusService.mode = { kind: "Normal" };
    } else {
      this.addNoteTools();
      this.model.focus = true;
      setTimeout(() => this.cdr.markForCheck(), 0);
    }
  }

  addNoteTools() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments() },
          icon: 'comment',
          title: 'Show comments'
        },
        {
          callback: () => { this.request.emit({ kind: "DeletionRequested", focusLast: false }); },
          icon: 'delete',
          title: 'Delete'
        }
      ]
    });
  }

  isCommentStart() {
    return this.comments.filter(c => c.startUUID === this.model.uuid).length > 0;
  }

  isCommentEnd() {
    return this.comments.filter(c => c.endUUID === this.model.uuid).length > 0;
  }

  hasFocus = false;
  timeoutF: any = undefined;
  setDivFocus(focus: boolean) {
    this.hasFocus = focus;
    if (focus && this.model.focus) {
      this.addNoteTools();
    } else {
      this.timeoutF = setTimeout(() => this.toolsService.remove(this), 200);
    }
  }

  hasCurrentFocus() {
    return this.hasFocus && this.model.focus;
  }
}
