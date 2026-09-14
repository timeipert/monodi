import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManualHighlightService } from '../../services/manual-highlight.service';
import * as Model from '../../../types/model';

@Component({
    selector: 'app-manual-comments',
    templateUrl: './comments.component.html',
    standalone: false
})
export class CommentsComponent implements OnInit, OnDestroy {
  activeHighlightId: string | null = null;
  private sub?: Subscription;

  demoTree = Model.emptyCommentTree();

  constructor(private highlightService: ManualHighlightService) {}

  ngOnInit() {
    this.sub = this.highlightService.activeHighlight$.subscribe(id => {
      this.activeHighlightId = id;
    });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  treeEvent(event: Model.CommentTreeEvent) {
    this.demoTree = Model.applyCommentTreeEvent(this.demoTree, event);
  }
}
