import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Source } from '../../api.service';
import * as VM from '../../types/model';

@Component({
  selector: 'app-manuscript-line-popup',
  templateUrl: './manuscript-line-popup.component.html',
  styleUrls: ['./manuscript-line-popup.component.css']
})
export class ManuscriptLinePopupComponent implements OnChanges {
  @Input() source: Source | null = null;
  @Input() lineUUID: string | null = null;
  @Input() manifestUrl?: string;

  region: VM.AnnotationRegion | null = null;
  cropImageUrl: string | null = null;
  cropRect: { x: number; y: number; w: number; h: number } | null = null;
  isLoading = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['lineUUID'] || changes['source']) {
      this.updateRegionCrop();
    }
  }

  updateRegionCrop(): void {
    if (!this.source || !this.lineUUID) {
      this.region = null;
      this.cropImageUrl = null;
      return;
    }

    const regions = this.source.annotationRegions ?? [];
    this.region = regions.find(r => r.lineUUID === this.lineUUID) ?? null;

    if (!this.region || !this.region.points) {
      this.cropImageUrl = null;
      return;
    }

    // Parse bounding box rect (0..100 percentages)
    this.cropRect = this.rectFromPoints(this.region.points);
    if (!this.cropRect) {
      this.cropImageUrl = null;
      return;
    }

    const canvasIdx = parseInt(this.region.folio ?? '0', 10);
    this.cropImageUrl = this.getIIIFImageUrl(canvasIdx);
  }

  private getIIIFImageUrl(canvasIdx: number): string | null {
    if (!this.source || !this.source.iiifManifestUrl) return null;
    return this.source.iiifManifestUrl.replace(/\/manifest\.json$/i, '') + `/canvas/${canvasIdx}/image`;
  }

  private rectFromPoints(pts: string): { x: number; y: number; w: number; h: number } | null {
    if (!pts) return null;
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    for (const p of pts.split(' ')) {
      if (!p.trim()) continue;
      const [x, y] = p.split(',').map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (minX >= maxX || minY >= maxY) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}
