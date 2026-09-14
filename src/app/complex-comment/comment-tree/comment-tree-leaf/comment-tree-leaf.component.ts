import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as M from '../../../types/model';

@Component({
    selector: 'app-comment-tree-leaf',
    templateUrl: './comment-tree-leaf.component.html',
    styleUrls: ['./comment-tree-leaf.component.scss'],
    standalone: false
})
export class CommentTreeLeafComponent {
  @Input({ required: true }) data!: M.CommentTreeLeaf;
  @Input({ required: true }) path!: M.CommentTreePath;
  @Input() readOnly = false;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();

  doDelete() {
    console.log("requting delete of " + JSON.stringify(this.path));
    this.treeEvent.emit({ source: this.path, intent: { kind: 'Delete' } });
  }

  supportsSettingContext(): boolean {
    return this.data.content.kind === 'Notes';
  }
}
