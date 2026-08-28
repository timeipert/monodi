import { Component, Input, OnChanges } from '@angular/core';
import { Document, Source } from '../../api.service';
import * as VM from '../../types/model';
import {
  analyzeSelection,
  pitchGroups,
  documentEmbedding,
  SelectionAnalysis,
  SelectionAnalysisInput,
  PitchGroups,
  EmbeddingPoint,
  Bucket,
} from '../selection-analysis';
import { BarItem } from '../charts/chart-bars.component';
import { ScatterPoint } from '../charts/chart-scatter.component';

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

  // Precomputed bar data
  pitchBars: BarItem[] = [];
  npsBars: BarItem[] = [];
  intervalBars: BarItem[] = [];
  ngramBars: BarItem[] = [];
  lengthBars: BarItem[] = [];
  phraseBars: BarItem[] = [];

  // Grouped pitch (shared scale)
  groupField = '';
  grouped: { axis: string[]; maxPercent: number; groups: { group: string; total: number; bars: BarItem[] }[] } | null = null;

  // Similarity map
  embedMode: 'melody' | 'text' = 'melody';
  embedGroupField = '';
  embedding: ScatterPoint[] = [];

  ngOnChanges(): void {
    const a = analyzeSelection(this.input());
    this.analysis = a;
    this.pitchBars = toBars(a.pitchDistribution);
    this.npsBars = toBars(a.notesPerSyllable);
    this.intervalBars = toBars(a.intervals);
    this.ngramBars = toBars(a.melodicNGrams);
    this.lengthBars = toBars(a.lengthDistribution);
    this.phraseBars = toBars(a.topPhrases);
    this.groupField = '';
    this.grouped = null;
    this.computeEmbedding();
  }

  private input(): SelectionAnalysisInput {
    return { documents: this.documents, sources: this.sources, roots: this.roots };
  }

  onGroupChange(): void {
    if (!this.groupField) {
      this.grouped = null;
      return;
    }
    const g: PitchGroups = pitchGroups(this.input(), this.groupField);
    this.grouped = {
      axis: g.axis,
      maxPercent: g.maxPercent,
      groups: g.groups.map((gr) => ({
        group: gr.group,
        total: gr.total,
        bars: g.axis.map((label, i) => ({ label, value: gr.percent[i] })),
      })),
    };
  }

  setEmbedMode(mode: 'melody' | 'text'): void {
    this.embedMode = mode;
    this.computeEmbedding();
  }

  onEmbedGroupChange(): void {
    this.computeEmbedding();
  }

  private computeEmbedding(): void {
    const pts: EmbeddingPoint[] = documentEmbedding(this.input(), this.embedMode, this.embedGroupField || undefined);
    this.embedding = pts.map((p) => ({ x: p.x, y: p.y, label: p.label, group: p.group }));
  }
}

function toBars(buckets: Bucket[]): BarItem[] {
  return buckets.map((b) => ({ label: b.label, value: b.count }));
}
