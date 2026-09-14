import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Source } from '../../api.service';
import { AnalyzedPattern } from '../../transcription-analyzer.service';
import { HttpClient } from '@angular/common/http';

interface LineGalleryItem {
  regionId: string;
  folio: string;
  lineName: string;
  points: string;
  imageUrl: string;
  items: any[];
}

const manifestCache = new Map<string, any>();

@Component({
    selector: 'app-notation-viewer',
    templateUrl: './notation-viewer.component.html',
    styleUrls: ['./notation-viewer.component.css'],
    standalone: false
})
export class NotationViewerComponent implements OnChanges {
  @Input() source: Source | null = null;
  @Input() allPatterns: AnalyzedPattern[] = [];

  manifest: any = null;
  canvases: any[] = [];
  
  manuscriptLines: LineGalleryItem[] = [];
  patternOccurrences = new Map<string, any[]>();
  tableRows: { patternId: string, baseId: string }[] = [];

  highlightedPattern: string | null = null;
  highlightedLineId: string | null = null;
  
  selectedPatterns: Set<string> = new Set<string>();

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['source'] && this.source?.iiifManifestUrl) {
      this.loadManifest(this.source.iiifManifestUrl);
    } else if (changes['source'] || changes['allPatterns']) {
      this.buildData();
    }
  }

  loadManifest(url: string) {
    if (manifestCache.has(url)) {
      this.manifest = manifestCache.get(url);
      this.parseCanvases();
      return;
    }
    this.http.get<any>(url).subscribe(
      m => { manifestCache.set(url, m); this.manifest = m; this.parseCanvases(); },
      err => console.error('Failed to load IIIF manifest', err)
    );
  }

  parseCanvases() {
    if (this.manifest?.sequences?.length > 0) this.canvases = this.manifest.sequences[0].canvases || [];
    else if (this.manifest?.items) this.canvases = this.manifest.items;
    else this.canvases = [];
    
    this.buildData();
  }

  canvasImageAt(idx: number): string | undefined {
    const c = this.canvases[idx];
    if (!c) return undefined;
    if (c.images?.length > 0) return c.images[0].resource?.['@id'];
    if (c.items?.length > 0) return c.items[0].items?.[0]?.body?.id;
    return undefined;
  }

  buildData() {
    if (!this.source) return;

    const items = this.source.annotationItems || [];

    // Build pattern occurrences based strictly on annotated items in IIIF
    this.patternOccurrences.clear();
    const pSet = new Set<string>();

    items.forEach(i => {
      if (!i.pattern) return;
      const patternId = i.variant ? `${i.pattern} ${i.variant}` : i.pattern;
      pSet.add(patternId);

      const locs = this.patternOccurrences.get(patternId) || [];
      locs.push(i);
      this.patternOccurrences.set(patternId, locs);
    });

    this.tableRows = Array.from(pSet).sort().map(patternId => {
      const baseId = patternId.split(' ')[0];
      return { patternId, baseId };
    });

    // Build line gallery from source.annotationRegions
    const regions = this.source.annotationRegions || [];
    
    this.manuscriptLines = regions.map(r => {
      const canvasIdx = parseInt(r.folio || '0', 10);
      const imgUrl = this.canvasImageAt(canvasIdx);
      
      const regionItems = items.filter(i => i.regionId === r.id).map(i => {
        return {
          id: i.id,
          points: i.points,
          pattern: i.pattern,
          displayId: i.variant ? `${i.pattern} ${i.variant}` : i.pattern
        };
      });

      return {
        regionId: r.id,
        folio: r.folio || '0',
        lineName: r.name,
        points: r.points,
        imageUrl: imgUrl || '',
        items: regionItems
      };
    }).filter(l => l.imageUrl && l.items.length > 0); // Only lines with an image and items
  }

  scrollToPattern(pattern: string) {
    this.highlightedPattern = pattern;
    const el = document.getElementById(`nv-pat-${pattern}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => this.highlightedPattern = null, 2000);
  }

  scrollToLine(regionId: string) {
    this.highlightedLineId = regionId;
    const el = document.getElementById(`nv-line-${regionId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => this.highlightedLineId = null, 3000);
  }

  togglePatternSelection(patternId: string) {
    if (this.selectedPatterns.has(patternId)) {
      this.selectedPatterns.delete(patternId);
    } else {
      this.selectedPatterns.add(patternId);
    }
  }

  get filteredManuscriptLines(): LineGalleryItem[] {
    if (this.selectedPatterns.size === 0) {
      return this.manuscriptLines;
    }
    return this.manuscriptLines.filter(line => 
      line.items.some(item => this.selectedPatterns.has(item.pattern))
    );
  }
}
