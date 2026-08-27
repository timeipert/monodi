import { AfterViewChecked, ChangeDetectorRef, Component, OnInit, OnDestroy, ChangeDetectionStrategy, ElementRef, ViewChild, Output, Input, EventEmitter } from '@angular/core';
import * as VM from '../types/model';
import { ToolsService } from '../tools.service';
import { assertNever } from '../../utils';
import * as R from '../notes/Request';
import { FocusService } from '../focus.service';
import { Focusable, Focus, FocusChange } from '../types/Focus';
import { UndoService } from '../undoService';

@Component({
  selector: 'app-box',
  templateUrl: './box.component.html',
  styleUrls: ['./box.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BoxComponent implements OnInit, OnDestroy, AfterViewChecked, Focusable {
  @ViewChild('notesDiv', { static: true }) notesDiv!: ElementRef;

  @Input()
  readOnly!: boolean;

  @Output()
  request = new EventEmitter<R.Request>();

  @Input()
  model!: VM.Box;

  getY(): number {
    return 50;
  }

  constructor(
    private focusService: FocusService,
    private cdr: ChangeDetectorRef,
    private toolsService: ToolsService,
    private undoService: UndoService) {
  }

  ngOnInit() {
  }


  ngOnDestroy() {
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  ngAfterViewChecked() {
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

  keyDown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      return;
    }
    if (e.key === 'Escape') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (e.altKey && e.key === 'Enter') { this.splitLine() }
    else if (e.key == "ArrowLeft") { this.requestFocusShift(undefined, true, -1); }
    else if (e.key == "ArrowRight") { this.requestFocusShift(undefined, false, +1); }
    else if (e.key == "Backspace") { this.deleteSelf(true) }
    else if (e.key == "Delete") { this.deleteSelf(false) }
    else if (e.key === "Enter") { this.request.emit({ kind: "NewSegmentRequested", syllableType: VM.SyllableType.Normal, text: "" }); }
    else if (e.key === " ") { this.request.emit({ kind: "NewSegmentRequested", syllableType: VM.SyllableType.Normal, text: "" }); }
    else if (e.key == "j") { this.request.emit({ kind: "LineChangeRequested", after: true }); }
    else if (e.key == "i") { this.request.emit({ kind: "LineChangeRequested", after: false }); }
    else if (e.ctrlKey && e.key === 'z') { this.undoService.undo() }
  }

  splitLine() {
    this.request.emit({ kind: 'SplitLineRequested' })
  }

  deleteSelf(focusLast: boolean) {
    this.request.emit({ kind: "DeletionRequested", focusLast });
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

  clicked(): void {
    this.focusService.preferredFocus = Focus.Notes;
    if (this.focusService.mode.kind == "CommentCreate") {
      window.alert("Comments cannot be attached to boxes.");
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
          callback: () => { this.request.emit({ kind: "DeletionRequested", focusLast: false }); },
          icon: 'delete',
          title: 'Delete'
        }
      ]
    });
  }

  isCommentStart() {
    return false;
  }

  isCommentEnd() {
    return false;
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
