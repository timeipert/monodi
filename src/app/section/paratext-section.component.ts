import { ViewChild, ElementRef, Component, OnInit } from '@angular/core';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import * as S from './Section';
import * as Model from '../types/model';
import { Focusable, FocusChange, Focus, handleTextInputMove } from '../types/Focus';
import { assertNever, focusContentEditable } from '../../utils';
import { ParatextCommentComponent } from '../paratext-comment/paratext-comment.component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { UndoService } from '../undoService';

@Component({
    selector: 'app-paratext-section',
    templateUrl: './section.component.html',
    styleUrls: ['./section.component.scss'],
    standalone: false
})
export class ParatextSectionComponent extends S.Section<Model.ParatextContainer> implements OnInit, Focusable {
  @ViewChild('paratextInput', { static: false }) paratext!: ElementRef;
  @ViewChild('commentModal', { static: true }) commentModal!: ElementRef;
  types = Object.keys(Model.ParatextType);
  subscription!: Observable<Model.ParatextComment>;

  constructor(
    private focusService: FocusService,
    private toolsService: ToolsService,
    private modalService: NgbModal,
    private undoService: UndoService) {
    super('Paratext', {}, undoService);
  }
  ngOnInit(): void {
    this.actionHandlers = {
      '+ Line': () => this.onEvent.emit({ 'kind': 'NewNoteLineRequsted', container: Model.emptyZeileContainer() }),
      ['+ L' + this.zipper.length]: () => this.onEvent.emit({ 'kind': 'NewFormteilRequested' }),
      '+ Text': () => this.onEvent.emit({ 'kind': 'NewParatextRequested' })
    };
  }

  setParatextTextArea(e: string) {
    this.undoService.beforeChange('Edit Paratext');
    this.data.text = e;
  }

  setParaDetail(e: boolean) {
    this.undoService.beforeChange('Toggle Detail');
    this.data.retro = e;
  }

  setParaType(e: Model.ParatextType) {
    this.undoService.beforeChange('Change Type');
    this.data.paratextType = e;
  }

  focus(change: FocusChange): void {
    const level = change.preferredLevel || this.focusService.preferredFocus;
    switch (level) {
      case Focus.Notes:
      case Focus.Code:
      case Focus.Text:
        focusContentEditable((this.paratext.nativeElement as HTMLElement), change.focusLast);
        break;
      default: assertNever(level);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    console.log(event);
    if (event.ctrlKey && event.key === 'z') {
      this.undoService.undo();
    } else {
      this.undoService.beforeChange('Typing');
      handleTextInputMove(this.paratext.nativeElement, event, e => this.onEvent.emit(e));
    }

  }

  showParaTextComment() {
    const modalRef = this.modalService.open(ParatextCommentComponent);
    modalRef.componentInstance.comment = this.data.comment || { alternativeText: this.data.text, certain: false, comment: '' };
    this.subscription = modalRef.componentInstance.updateParaTextComment;
    this.subscription.pipe(take(1)).subscribe((newComment: Model.ParatextComment) => this.data.comment = newComment);
  }

  isFocused(): boolean {
    return this.focusService.focusedContainerUUID === this.data.uuid;
  }

  selectContainer(event: MouseEvent): void {
    event.stopPropagation();
    this.focusService.focusedContainerUUID = this.data.uuid;
    const tools: any[] = [];

    // Delete Text Element
    tools.push({
      callback: () => {
        if (confirm('Are you sure you want to delete this text element?')) {
          this.onEvent.emit({ kind: 'DeletionRequested', focusLast: true });
        }
      },
      icon: 'trash text-danger',
      title: 'Delete Text Element'
    });

    // Clear selection
    tools.push({
      callback: () => {
        this.focusService.focusedContainerUUID = undefined;
        this.toolsService.remove(this);
      },
      icon: 'x-circle text-secondary',
      title: 'Clear Selection'
    });

    this.toolsService.remove(this);
    this.toolsService.addStack({
      source: this,
      tools: tools
    });
  }

  ngOnDestroy(): void {
    this.toolsService.remove(this);
  }

  getData(): any {
    return this.data;
  }
}

