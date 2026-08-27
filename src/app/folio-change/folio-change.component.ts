import { ChangeDetectorRef, ElementRef, ViewChild, OnDestroy, Output, EventEmitter, Input, Component, OnInit } from '@angular/core';
import { assertNever, textWidth, focusContentEditable } from '../../utils';
import { FocusService } from '../focus.service';
import * as Model from '../types/model';
import * as R from '../notes/Request';
import { Focus, FocusChange, handleTextInputMove } from '../types/Focus';
import { ToolsService } from '../tools.service';
import * as VM from '../types/model';
import { CommentComponent } from '../comment/comment.component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ReplaySubject } from 'rxjs';
import { UndoService } from '../undoService';

@Component({
  selector: 'app-folio-change',
  templateUrl: './folio-change.component.html',
  styleUrls: ['./folio-change.component.scss']
})
export class FolioChangeComponent implements OnDestroy, OnInit {
  @ViewChild('changeText', { static: true }) changeText!: ElementRef;
  @ViewChild('svg', { static: true }) svg!: ElementRef;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;

  @Input()
  model!: Model.FolioChange;

  @Input()
  comments!: VM.Comment[];

  @Input()
  readOnly!: boolean;

  @Output()
  request = new EventEmitter<R.Request>();

  syllableWidth = 300;
  svgWidth = 0;
  hasFocus = false;

  constructor(
    private focusService: FocusService,
    private toolsService: ToolsService,
    private modalService: NgbModal,
    private undoService: UndoService,
    private cdr: ChangeDetectorRef) {
  }

  ngOnInit() {
    this.changeText.nativeElement.textContent = this.model.text;
    this.onTextChange();
  }

  ngOnDestroy() {
    setTimeout(() => this.toolsService.remove(this), 0);
  }

  timeoutF: any = undefined;
  setDivFocus(focus: boolean) {
    this.hasFocus = focus;
    if (focus) {
      this.addNoteTools();
    } else {
      this.timeoutF = setTimeout(() => this.toolsService.remove(this), 200);
    }
  }

  isCommentStart(): boolean {
    return this.comments.some(c => c.startUUID === this.model.uuid);
  }

  isCommentEnd(): boolean {
    return this.comments.some(c => c.endUUID === this.model.uuid);
  }

  getActiveComments(): VM.Comment[] {
    if (this.model.focus) {
      return this.comments.filter(c => c.endUUID === this.model.uuid || c.startUUID === this.model.uuid);
    }
    return [];
  }

  focusSvg(): void {
    this.focusService.preferredFocus = Focus.Notes;
    this.focus({
      focusLast: false,
      preferredLevel: Focus.Notes
    });
    this.request.emit({ kind: "EndCommentRequested", endKind: VM.CommentPartKind.FolioChange, endUUID: this.model.uuid });
  }

  focusText(): void {
    this.focusService.preferredFocus = Focus.Text;
  }

  keyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && event.altKey) {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: 'SplitLineRequested' });
    } else if (!event.altKey && (event.key === "Enter" || event.key === " ")) {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: "NewSegmentRequested", syllableType: Model.SyllableType.Normal, text: "" });
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.stopPropagation();
      event.preventDefault();
      this.request.emit({ kind: "DeletionRequested", focusLast: event.key === 'Backspace' });
    } else if (event.key == "ArrowLeft") {
      this.requestFocusShift(undefined, true, -1);
    } else if (event.key == "ArrowRight") {
      this.requestFocusShift(undefined, false, +1);
    } else if (event.key === 'k') {
      this.request.emit({ kind: "StartCommentRequested", startKind: VM.CommentPartKind.FolioChange, startUUID: this.model.uuid });
    }
    else if (event.ctrlKey && event.key === 'z') { this.undoService.undo() }

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

  onTextKeyDownChange(event: KeyboardEvent): void {
    console.log("onTextKeyDownEvent");
    handleTextInputMove(this.changeText.nativeElement, event, e => this.request.emit(e));
  }

  onTextChange(): void {
    const text = this.changeText!.nativeElement.textContent || '';
    this.model.text = text;
    const changeText = textWidth(text);
    const svgWidth = 10 + changeText;
    this.syllableWidth = Math.max(20, changeText) + 20;
    this.svgWidth = svgWidth;
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    switch (level) {
      case Focus.Code:
      case Focus.Notes:
        this.model.focus = true;
        (this.svg.nativeElement as HTMLElement).focus();
        break;
      case Focus.Text:
        focusContentEditable(this.changeText.nativeElement as HTMLElement, change.focusLast);
        break;
      default: assertNever(level);
    }
  }

  getData(): any {
    return this.model;
  }

  private showComments() {
    const rp = new ReplaySubject<VM.ZeileContainer[]>(1);
    const comments = this.getActiveComments();
    rp.subscribe(originals => {
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

  addNoteTools() {
    window.clearTimeout(this.timeoutF);
    this.toolsService.addStack({
      source: this,
      tools: [
        {
          callback: () => { this.showComments(); },
          icon: 'comment',
          title: 'Show comments'
        },
        {
          callback: () => { this.request.emit({ kind: "DeletionRequested", focusLast: false }); },
          icon: 'delete',
          title: 'Delete'
        },
        {
          callback: () => { this.request.emit({ kind: "ViewIiifRequested", folio: this.model.text }); },
          icon: 'image',
          title: 'View IIIF'
        }
      ]
    });
  }
}
