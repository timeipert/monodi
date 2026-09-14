import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManualHighlightService } from '../../services/manual-highlight.service';

interface MockTextResult {
  source: string;
  title: string;
  before: string;
  match: string;
  after: string;
}

interface MockPitchResult {
  source: string;
  title: string;
  pitches: string[];
  highlight: number[];
}

interface MockIntervalResult {
  source: string;
  title: string;
  pitches: string[];
  steps: string;
}

interface MockFuzzyResult {
  match: string;
  distance: number;
  description: string;
}

@Component({
    selector: 'app-manual-search',
    templateUrl: './search.component.html',
    styleUrl: './search.component.css',
    standalone: false
})
export class SearchComponent implements OnInit, OnDestroy {
  activeHighlightId: string | null = null;
  private sub?: Subscription;

  // Mock search states
  mockTab: 'text' | 'pitch' | 'interval' | 'fuzzy' = 'text';
  searchQuery: string = 'fidelis';
  fuzzyDistance: number = 1;

  // Result lists
  textResults: MockTextResult[] = [];
  pitchResults: MockPitchResult[] = [];
  intervalResults: MockIntervalResult[] = [];
  fuzzyResults: MockFuzzyResult[] = [];

  constructor(private highlightService: ManualHighlightService) {
    this.runMockSearch();
  }

  ngOnInit() {
    this.sub = this.highlightService.activeHighlight$.subscribe(id => {
      this.activeHighlightId = id;
      if (id) {
        this.clickTrigger(id);
      }
    });
  }

  clickTrigger(id: string) {
    if (id === 'text-search') {
      this.triggerExample('text', 'fidelis');
    } else if (id === 'pitch-mode') {
      this.triggerExample('pitch', 'F G A');
    } else if (id === 'interval-mode') {
      this.triggerExample('interval', '+2 -2');
    } else if (id === 'fuzzy-mode') {
      this.triggerExample('fuzzy', 'A B C', 1);
    }
  }

  triggerExample(tab: 'text' | 'pitch' | 'interval' | 'fuzzy', query: string, distance: number = 1) {
    this.mockTab = tab;
    this.searchQuery = query;
    this.fuzzyDistance = distance;
    this.runMockSearch();
  }

  runMockSearch() {
    const q = this.searchQuery.trim().toLowerCase();

    if (this.mockTab === 'text') {
      if (q.includes('fid')) {
        this.textResults = [
          { source: 'CH-E 121 (Einsiedeln)', title: 'Crux fidelis', before: '...Crux ', match: 'fidelis', after: ' inter omnes...' },
          { source: 'CH-SGs 390 (St. Gallen)', title: 'Pange lingua', before: '...Crucem ', match: 'fidelem', after: ' veneremur...' }
        ];
      } else if (q.includes('et') || q === '') {
        this.textResults = [
          { source: 'CH-E 121 (Einsiedeln)', title: 'Kyrie eleison', before: '...Kyrie ', match: 'et', after: ' Christe eleison...' },
          { source: 'CH-SGs 390 (St. Gallen)', title: 'Gloria', before: '...Et in terra pax hominibus bonae voluntatis. Laudamus ', match: 'te', after: '...' }
        ];
      } else {
        this.textResults = [
          { source: 'Mock Source', title: 'Custom Chant Search', before: 'Found match for "', match: this.searchQuery, after: '" inside lyrics.' }
        ];
      }
    }

    else if (this.mockTab === 'pitch') {
      if (q.includes('f') || q.includes('g') || q.includes('a')) {
        this.pitchResults = [
          { source: 'CH-SGs 390 (St. Gallen)', title: 'Alleluia. V. Pascha nostrum', pitches: ['D', 'F', 'G', 'A', 'G', 'F'], highlight: [1, 2, 3] },
          { source: 'CH-E 121 (Einsiedeln)', title: 'Introitus: Resurrexi', pitches: ['F', 'G', 'A', 'C', 'A', 'G'], highlight: [0, 1, 2] }
        ];
      } else {
        this.pitchResults = [
          { source: 'CH-E 121 (Einsiedeln)', title: 'Chant Fragment', pitches: ['C', 'D', 'E', 'F', 'G', 'A'], highlight: [0, 1, 2] }
        ];
      }
    }

    else if (this.mockTab === 'interval') {
      if (q.includes('2') || q === '') {
        this.intervalResults = [
          { source: 'CH-E 121 (Einsiedeln)', title: 'Ad te levavi (Base - F Major context)', pitches: ['F', 'G', 'F'], steps: 'F → G → F (+2, -2 steps)' },
          { source: 'CH-SGs 390 (St. Gallen)', title: 'Ad te levavi (Transposed - C Major context)', pitches: ['C', 'D', 'C'], steps: 'C → D → C (+2, -2 steps)' }
        ];
      } else {
        this.intervalResults = [
          { source: 'Source Codex', title: 'Matching Interval Sequence', pitches: ['D', 'E', 'D'], steps: 'D → E → D (+2, -2 steps)' }
        ];
      }
    }

    else if (this.mockTab === 'fuzzy') {
      if (this.fuzzyDistance === 0) {
        this.fuzzyResults = [
          { match: 'A B C', distance: 0, description: 'Exact Match' }
        ];
      } else {
        this.fuzzyResults = [
          { match: 'A B C', distance: 0, description: 'Exact Match' },
          { match: 'A D C', distance: 1, description: 'Substitution (B → D)' },
          { match: 'A B', distance: 1, description: 'Deletion (C missing)' },
          { match: 'A B C D', distance: 1, description: 'Insertion (D appended)' }
        ];
      }
    }
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}

