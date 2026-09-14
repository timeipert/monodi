import { Component } from "@angular/core";
import * as M from "../types/model";

@Component({
    selector: 'app-complex-comment',
    templateUrl: './complex-comment.component.html',
    styleUrls: ['./complex-comment.component.scss'],
    standalone: false
})
export class ComplexCommentComponent {
  tree: M.CommentTree = M.emptyCommentTree();

  treeEvent(event: M.CommentTreeEvent) {
    this.tree = M.applyCommentTreeEvent(this.tree, event);
    console.log("hi")
  }
}
