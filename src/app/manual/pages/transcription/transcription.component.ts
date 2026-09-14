import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManualHighlightService } from '../../services/manual-highlight.service';
import * as Model from '../../../types/model';

@Component({
    selector: 'app-manual-transcription',
    templateUrl: './transcription.component.html',
    styleUrls: ['./transcription.component.css'],
    standalone: false
})
export class TranscriptionComponent implements OnInit, OnDestroy {
  activeHighlightId: string | null = null;
  private sub?: Subscription;

  demoFolio = Model.emptyFolioChange();
  demoClef = Model.emptyClef();
  demoLine = Model.emptyLineChange();

  constructor(private highlightService: ManualHighlightService) {
    this.demoFolio.text = "1r";
  }

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

