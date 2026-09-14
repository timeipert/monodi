import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManualHighlightService } from '../../services/manual-highlight.service';

@Component({
    selector: 'app-metadata',
    templateUrl: './metadata.component.html',
    standalone: false
})
export class MetadataComponent implements OnInit, OnDestroy {
  activeHighlightId: string | null = null;
  private sub?: Subscription;

  // Mock metadata fields
  docId = 'doc-124';
  initium = 'Crux fidelis';
  genre1 = 'Antiphon';
  genre2 = 'Verse';
  feast = 'In Nativitate Domini';
  customFieldName = 'Cantus ID';
  customFieldValue = '001234';

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
}

