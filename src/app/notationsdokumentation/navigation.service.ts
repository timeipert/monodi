import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private focusFolioSource = new Subject<string>();
  focusFolio$ = this.focusFolioSource.asObservable();

  private focusPatternSource = new Subject<{documentId: string, uuid?: string}>();
  focusPattern$ = this.focusPatternSource.asObservable();

  /** A folio asked for before the viewer that shows it exists (or has loaded its pages). */
  private pending: { sourceId: string; folio: string; at: number } | null = null;
  private static readonly PENDING_MS = 15000;

  constructor(private router: Router) { }

  /** Opens the manuscript's scans on that folio: the source page, Notation → Annotate. */
  openIiifViewerForFolio(sourceId: string, folio: string) {
    this.pending = { sourceId, folio, at: Date.now() };
    this.router.navigate(['/source', sourceId], { queryParams: { tab: 'notation', ntab: 'annotate' } });
    this.focusFolioSource.next(folio);   // a viewer that is already open can jump right away
  }

  /**
   * The folio a viewer of this manuscript was asked to show, once. The viewer asks after its pages are loaded,
   * however long the route took to open; a request nobody picked up expires, so it cannot jump a later visit.
   */
  takePendingFolio(sourceId: string | undefined): string | null {
    const p = this.pending;
    if (!p || p.sourceId !== sourceId) return null;
    this.pending = null;
    return Date.now() - p.at <= NavigationService.PENDING_MS ? p.folio : null;
  }

  openEditorForPattern(sourceId: string, documentId: string, uuid?: string) {
    this.router.navigate(['/document', sourceId, documentId], { queryParams: { focus: uuid } });
  }
}
