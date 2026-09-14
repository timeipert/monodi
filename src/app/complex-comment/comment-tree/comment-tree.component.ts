import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as M from './../../types/model';

@Component({
    selector: 'app-comment-tree',
    templateUrl: './comment-tree.component.html',
    styleUrls: ['./comment-tree.component.css'],
    standalone: false
})
export class CommentTreeComponent {
  @Input() originalCreator?: () => M.ZeileContainer;
  @Input() tree!: M.CommentTree;
  @Input() readOnly = false;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();
}
