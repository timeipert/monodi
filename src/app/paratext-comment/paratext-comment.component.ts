import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import * as M from '../types/model';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { UndoService } from '../undoService';

@Component({
    selector: 'app-paratext-comment',
    templateUrl: './paratext-comment.component.html',
    styleUrls: ['./paratext-comment.component.scss'],
    standalone: false
})
export class ParatextCommentComponent implements OnInit {
  @Input() comment!: M.ParatextComment;
  @Output() updateParaTextComment: EventEmitter<M.ParatextComment> = new EventEmitter();

  constructor(
    public activeModal: NgbActiveModal,
    private undoService: UndoService
  ) { }

  ngOnInit() {
  }

  onSave() {
    this.undoService.beforeChange('Save Paratext Comment');
    this.updateParaTextComment.emit(this.comment);
    this.activeModal.close();
  }

  addTree(): void {
    this.comment.tree = M.emptyCommentTree();
  }

  handleCommentTreeEvent(e: M.CommentTreeEvent) {
    this.comment.tree = M.applyCommentTreeEvent(this.comment.tree!, e);
  }


  originalCreator(): M.ZeileContainer {
    return M.emptyZeileContainer();
  }

}
