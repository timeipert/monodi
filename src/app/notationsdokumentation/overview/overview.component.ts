import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { AnalyzedPattern } from '../../transcription-analyzer.service';
import { Source } from '../../api.service';

export interface LocationGroup {
  label: string;      // e.g. "f3r/L5"
  count: number;      // how many occurrences share this exact folio+line
  sample: AnalyzedPattern; // first occurrence — used for click-through navigation
}

interface PatternGroup {
  patternId: string;
  count: number;
  occurrences: AnalyzedPattern[];
  locationGroups: LocationGroup[];
  refId: string;
}

@Component({
    selector: 'app-overview',
    templateUrl: './overview.component.html',
    styleUrls: ['./overview.component.css'],
    standalone: false
})
export class OverviewComponent implements OnChanges {
  @Input() manuscriptPatterns: AnalyzedPattern[] = [];
  @Input() source: Source | null = null;
  @Output() openInGallery = new EventEmitter<{ patternId: string; folio: string }>();

  patternGroups: PatternGroup[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (this.manuscriptPatterns && this.source) {
      this.analyze();
    }
  }

  analyze() {
    if (!this.manuscriptPatterns || !this.source) return;

    const groupsMap = new Map<string, PatternGroup>();

    for (const res of this.manuscriptPatterns) {
      if (!groupsMap.has(res.patternId)) {
        const existingRefId = this.source.equivalents?.find((e: any) => e.pattern === res.patternId)?.refId || '';
        groupsMap.set(res.patternId, {
          patternId: res.patternId,
          count: 0,
          occurrences: [],
          locationGroups: [],
          refId: existingRefId
        });
      }
      const g = groupsMap.get(res.patternId)!;
      g.count++;
      g.occurrences.push(res);
    }

    // Build compact location groups: deduplicate identical folio+line entries
    for (const g of groupsMap.values()) {
      const locMap = new Map<string, LocationGroup>();
      for (const occ of g.occurrences) {
        const key = `${occ.folio}/L${occ.line}`;
        if (!locMap.has(key)) {
          locMap.set(key, { label: key, count: 0, sample: occ });
        }
        locMap.get(key)!.count++;
      }
      g.locationGroups = Array.from(locMap.values())
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }

    this.patternGroups = Array.from(groupsMap.values());
    this.sortPatternGroups();
  }

  updateRefId(group: PatternGroup, newRefId: string) {
    if (!this.source) return;
    if (!this.source.equivalents) this.source.equivalents = [];

    const existing = this.source.equivalents.find((e: any) => e.pattern === group.patternId);
    if (existing) {
      existing.refId = newRefId;
    } else {
      this.source.equivalents.push({ pattern: group.patternId, refId: newRefId });
    }
    group.refId = newRefId;
    this.sortPatternGroups();
  }

  private sortPatternGroups() {
    this.patternGroups.sort((a, b) => {
      const aHas = !!a.refId?.trim();
      const bHas = !!b.refId?.trim();
      // Groups without a refId go last, sorted by count desc
      if (!aHas && !bHas) return b.count - a.count;
      if (!aHas) return 1;
      if (!bHas) return -1;
      // Both have refIds: sort numerically if both look like numbers, else alphabetically
      const aNum = parseFloat(a.refId);
      const bNum = parseFloat(b.refId);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.refId.localeCompare(b.refId, undefined, { numeric: true });
    });
  }

  openOccurrenceInGallery(occ: AnalyzedPattern) {
    this.openInGallery.emit({ patternId: occ.patternId, folio: occ.folio });
  }
}
