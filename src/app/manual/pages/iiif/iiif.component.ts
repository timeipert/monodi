import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManualHighlightService } from '../../services/manual-highlight.service';

@Component({
    selector: 'app-iiif',
    templateUrl: './iiif.component.html',
    standalone: false
})
export class IiifComponent implements OnInit, OnDestroy {
  activeHighlightId: string | null = null;
  private sub?: Subscription;

  // Simulator states
  isSplitScreen = true;
  isLinked = true;
  activeFolio = '1r';
  showFlash = false;

  constructor(private highlightService: ManualHighlightService) {}

  ngOnInit() {
    this.sub = this.highlightService.activeHighlight$.subscribe(id => {
      this.activeHighlightId = id;
    });
  }

  simulateLinkClick() {
    this.showFlash = true;
    setTimeout(() => {
      this.showFlash = false;
    }, 1000);
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

