import * as M from '../../../types/model';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-comment-tree-undecided',
    templateUrl: './comment-tree-undecided.component.html',
    styleUrls: ['./comment-tree-undecided.component.scss'],
    standalone: false
})
export class CommentTreeUndecidedComponent {
  @Input() originalCreator?: () => M.ZeileContainer;
  @Input({ required: true }) data!: M.CommentTreeUndecided;
  @Input({ required: true }) path!: M.CommentTreePath;
  @Input() readOnly = false;
  @Output() treeEvent = new EventEmitter<M.CommentTreeEvent>();

  becomeTextLeaf(): void {
    this.treeEvent.emit({ intent: { kind: "BecomeLeaf", content: CommentTreeUndecidedComponent.newTextContent() }, source: this.path });
  }

  becomeNotesLeaf(): void {
    this.treeEvent.emit({ intent: { kind: "BecomeLeaf", content: this.newNotesContent() }, source: this.path });
  }

  becomeBracketLeaf(): void {
    this.treeEvent.emit({ intent: { kind: "BecomeLeaf", content: CommentTreeUndecidedComponent.newBracketContent() }, source: this.path });
  }

  becomeGrid(): void {
    this.treeEvent.emit({ intent: { kind: "BecomeGrid" }, source: this.path });
  }


  private newNotesContent(): M.CommentTreeLeafContentNotes {
    const z = this.originalCreator?.() ?? M.emptyZeileContainer();
    return { kind: "Notes", content: z };
  }

  static newTextContent(): M.CommentTreeLeafContentText {
    return { kind: "Text", content: "" };
  }

  static newBracketContent(): M.CommentTreeLeafBracket {
    return { kind: "Bracket" };
  }
}
