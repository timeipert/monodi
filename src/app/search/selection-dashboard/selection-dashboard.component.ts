import { Component, Input, OnChanges } from '@angular/core';
import { Document, Source } from '../../api.service';
import * as VM from '../../types/model';
import {
  analyzeSelection,
  pitchByField,
  SelectionAnalysis,
  SelectionAnalysisInput,
  GroupPitch,
  Bucket,
} from '../selection-analysis';

@Component({
  selector: 'app-selection-dashboard',
  templateUrl: './selection-dashboard.component.html',
  styleUrls: ['./selection-dashboard.component.css'],
})
export class SelectionDashboardComponent implements OnChanges {
  @Input() documents: Document[] = [];
  @Input() sources: (Source | null)[] = [];
  @Input() roots: (VM.RootContainer | null)[] = [];

  analysis: SelectionAnalysis | null = null;
  groupField = '';
  groupPitch: GroupPitch[] = [];

  ngOnChanges(): void {
    this.analysis = analyzeSelection(this.input());
    this.groupField = '';
    this.groupPitch = [];
  }

  private input(): SelectionAnalysisInput {
    return { documents: this.documents, sources: this.sources, roots: this.roots };
  }

  onGroupChange(): void {
    this.groupPitch = this.groupField ? pitchByField(this.input(), this.groupField) : [];
  }

  /** Max count in a bucket list, for bar scaling (never 0). */
  maxCount(buckets: Bucket[]): number {
    return Math.max(1, ...buckets.map((b) => b.count));
  }

  pct(count: number, max: number): number {
    return max > 0 ? Math.round((count / max) * 100) : 0;
  }
}
