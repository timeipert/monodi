import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as M from '../../../../types/model';

@Component({
    selector: 'app-comment-tree-notes',
    templateUrl: './comment-tree-notes.component.html',
    styleUrls: ['./comment-tree-notes.component.scss'],
    standalone: false
})
export class CommentTreeNotesComponent {
  @Input({ required: true }) data!: M.CommentTreeLeafContentNotes;
  @Input({ required: true }) path!: M.CommentTreePath;
  @Input() readOnly = false;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();
}
