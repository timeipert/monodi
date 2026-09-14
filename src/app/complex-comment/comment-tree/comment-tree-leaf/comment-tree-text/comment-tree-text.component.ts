import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as M from '../../../../types/model';

@Component({
    selector: 'app-comment-tree-text',
    templateUrl: './comment-tree-text.component.html',
    styleUrls: ['./comment-tree-text.component.scss'],
    standalone: false
})
export class CommentTreeTextComponent {
  @Input({ required: true }) data!: M.CommentTreeLeafContentText;
  @Input({ required: true }) path!: M.CommentTreePath;
  @Input() readOnly = false;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();

  updateText(text: string): void {
    this.treeEvent.emit({
      source: this.path, intent: { kind: "UpdateContent", content: { kind: "Text", content: text } }
    });
  }
}
