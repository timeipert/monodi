import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ManuscriptViewService, ManuscriptViewState } from '../../manuscript-view.service';
import { Hit } from '../../manuscript-lookup';
import { backgroundStyle, boundsOf, cropAspect, imageCropUrl, padRect, Rect, toCropSpace } from '../../iiif-crop';
import { pageImageOf, pageLabelOf } from '../region-page';

/** One picture: a piece of a page, with outlines laid over it. */
export interface CropView {
  /** IIIF crop, when the page has an image service. */
  url?: string;
  /** Otherwise the whole page image, shown through a background of the crop's own shape. */
  fallback?: { imageUrl: string; size: string; position: string; aspect: number };
  overlays: { points: string; strong: boolean }[];
}

/** A hit, ready to display. */
export interface HitView {
  caption: string;
  page: string;
  label: string;
  /** The line the sign stands in, with the sign outlined. */
  line?: CropView;
  /** The sign itself, close up. */
  closeUp?: CropView;
  problem?: string;
}

/**
 * "Show in manuscript": how the sign that was right-clicked in the transcription
 * looks on the page. The best link wins as the main picture (that very sign, or at
 * least its line); other snippets of the same pattern are always shown beside it.
 */
@Component({
  selector: 'app-manuscript-view',
  templateUrl: './manuscript-view.component.html',
  styleUrls: ['./manuscript-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ManuscriptViewComponent implements OnInit, OnDestroy {
  state: ManuscriptViewState | null = null;
  primary: HitView[] = [];
  examples: HitView[] = [];
  private sub?: Subscription;

  constructor(private service: ManuscriptViewService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub = this.service.state$.subscribe(s => {
      this.state = s.open ? s : null;
      this.primary = [];
      this.examples = [];
      if (s.open && !s.loading && s.lookup) {
        const kind = s.lookup.primary?.kind;
        this.primary = (s.lookup.primary?.hits ?? []).map(h => this.view(h, s, kind === 'exact' ? 'exact' : 'line'));
        this.examples = s.lookup.examples.map(h => this.view(h, s, 'example'));
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  @HostListener('document:keydown.escape')
  close(): void { this.service.close(); }

  get title(): string {
    const l = this.state?.lookup;
    return l ? l.pattern : '';
  }

  get heading(): string {
    const p = this.state?.lookup?.primary;
    if (!p) return '';
    return p.kind === 'exact' ? 'This sign' : 'This line';
  }

  get totalExamplesNote(): string {
    const l = this.state?.lookup;
    if (!l || l.totalExamples <= l.examples.length) return '';
    return `Showing ${l.examples.length} of ${l.totalExamples}.`;
  }

  private view(hit: Hit, s: ManuscriptViewState, mode: 'exact' | 'line' | 'example'): HitView {
    const region = hit.region;
    const out: HitView = {
      caption: region.name,
      page: pageLabelOf(region, s.canvases),
      label: hit.item ? hit.label : ''
    };
    const regionRect = boundsOf(region.points);
    const image = pageImageOf(region, s.canvases);
    if (!regionRect || !image) {
      out.problem = !regionRect
        ? 'This line has no outline.'
        : s.manifestError || (s.source?.iiifManifestUrl ? 'The page of this line is not in the manifest.' : 'This source has no IIIF manifest, and the line carries no image address.');
      return out;
    }

    const crop = (rect: Rect, maxW: number, maxH: number, polygons: { points: string; strong: boolean }[]): CropView => {
      const overlays = polygons.filter(p => p.points).map(p => ({ points: toCropSpace(p.points, rect), strong: p.strong }));
      if (image.base) return { url: imageCropUrl(image.base, rect, maxW, maxH), overlays };
      return {
        fallback: { imageUrl: image.url!, ...backgroundStyle(rect), aspect: cropAspect(rect, image.w, image.h) },
        overlays
      };
    };

    const item = hit.item;
    if (mode === 'example' && item) {
      const r = boundsOf(item.points);
      if (r) out.closeUp = crop(padRect(r, 1.6, 0.8, 16, 8), 640, 480, [{ points: item.points, strong: true }]);
      else out.problem = 'This snippet has no outline.';
      return out;
    }

    const siblings = (s.source?.annotationItems ?? []).filter(i => i.regionId === region.id);
    const lineRect = padRect(regionRect, 0.03, 0.35, 0, 5);
    out.line = crop(lineRect, 1000, 420, [
      { points: region.points, strong: false },
      ...siblings.filter(i => i.id !== item?.id).map(i => ({ points: i.points, strong: false })),
      ...(item ? [{ points: item.points, strong: true }] : [])
    ]);
    if (item && mode === 'exact') {
      const r = boundsOf(item.points);
      if (r) out.closeUp = crop(padRect(r, 2.5, 0.7, 22, 9), 840, 480, [{ points: item.points, strong: true }]);
    }
    return out;
  }

  trackHit = (_: number, h: HitView) => h.caption + h.label + h.page;
}
