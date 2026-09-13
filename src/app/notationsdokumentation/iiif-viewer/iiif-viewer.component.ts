import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ViewChild, ElementRef, NgZone, OnDestroy, OnInit, HostListener
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Source } from '../../api.service';
import * as VM from '../../types/model';
import { v4 as UUID } from 'uuid';
import { NavigationService } from '../navigation.service';
import { AnalyzedPattern } from '../../transcription-analyzer.service';
import { LayoutAnalysisService } from '../layout-analysis.service';

const MAX_MANIFEST_CACHE_SIZE = 20;
const manifestCache = new Map<string, any>();

/** Width (px) requested for IIIF Image API renditions. Big enough to annotate
 *  comfortably, small enough to load an order of magnitude faster than the
 *  raw full-resolution scan. */
const IIIF_IMAGE_WIDTH = 2500;

export interface GalleryItem {
  item: VM.AnnotationItem;
  region: VM.AnnotationRegion | undefined;
  canvasIdx: number;
  imageUrl: string;
  rect: { x: number; y: number; w: number; h: number };   // padded viewBox rect
  rawRect: { x: number; y: number; w: number; h: number }; // tight annotation rect
  linked: AnalyzedPattern | undefined;
}

@Component({
  selector: 'app-iiif-viewer',
  templateUrl: './iiif-viewer.component.html',
  styleUrls: ['./iiif-viewer.component.css']
})
export class IiifViewerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() source: Source | null = null;
  @Input() documentPatterns: string[] = [];
  @Input() allPatterns: AnalyzedPattern[] = [];
  @Input() jumpToPattern = '';
  @Input() simpleMode = false;

  /** An array of folio strings (e.g. ['3r', '3v']) that exist within the current document. 
   *  Used in simpleMode to filter the canvas sidebar down to just the document's folios. */
  @Input() documentFolios: string[] = [];

  @Input() initialCanvasIndex?: number;
  @Input() activeRegionName?: string;
  /** UUID of the line-change that was last clicked in the transcription. The IIIF viewer
   *  navigates to the canvas containing the region linked to this UUID and highlights it. */
  @Input() highlightedLineUUID = '';
  @Output() sourceChanged = new EventEmitter<void>();
  @Output() regionClicked = new EventEmitter<{ name: string, folio: string, lineUUID?: string }>();
  /** Emitted when the user presses the "Link to line" button for a region.
   *  The document component should enter link-mode so the next line-change click links the line. */
  @Output() requestLineLink = new EventEmitter<{ regionId: string; regionName: string }>();

  @Output() beforeChange = new EventEmitter<void>();

  private save() { this.sourceChanged.emit(); }
  private triggerBeforeChange() { this.beforeChange.emit(); }

  // ViewChild via setter — attaches wheel listener the moment *ngIf renders the element
  private _viewportRef?: ElementRef<HTMLDivElement>;
  @ViewChild('viewportRef')
  set viewportRef(el: ElementRef<HTMLDivElement> | undefined) {
    if (this._viewportRef?.nativeElement)
      this._viewportRef.nativeElement.removeEventListener('wheel', this.wheelFn);
    this._viewportRef = el;
    if (el?.nativeElement)
      this.zone.runOutsideAngular(() =>
        el.nativeElement.addEventListener('wheel', this.wheelFn, { passive: false }));
  }
  get viewportRef(): ElementRef<HTMLDivElement> { return this._viewportRef!; }
  @ViewChild('contentRef') contentRef!: ElementRef<HTMLDivElement>;

  // ── manifest / canvas ─────────────────────────────────────────────────────
  manifest: any = null;
  canvases: any[] = [];
  currentCanvasIndex = 0;
  imageError = false;
  imageLoading = false;

  // ── zoom / pan ────────────────────────────────────────────────────────────
  scale = 1;
  leftSidebarCollapsed = false;
  translateX = 0;
  translateY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private readonly wheelFn = (e: WheelEvent) => {
    e.preventDefault();
    this.zone.run(() => this.onWheel(e));
  };

  // ── box drawing ───────────────────────────────────────────────────────────
  isDraggingBox = false;
  dragStartPct: { x: number; y: number } | null = null;
  dragCurrentPct: { x: number; y: number } | null = null;

  // ── annotation mode ───────────────────────────────────────────────────────
  viewMode: 'regions' | 'items' = 'regions';
  activeRegion: VM.AnnotationRegion | null = null;

  // Pending region (drawn, waiting for a name)
  pendingRegionPoints: string | null = null;
  pendingRegionName = '';

  // Rename region
  renamingRegionId: string | null = null;
  renamingValue = '';

  // Item annotation
  activePattern = '';
  activeVariant = '';
  patternSearch = '';
  readonly VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  // Linker — null means closed; a string is the item ID being linked
  linkingItemId: string | null = null;
  linkCandidates: AnalyzedPattern[] = [];

  // Region↔Line linking
  /** ID of the region that is currently highlighted (driven by highlightedLineUUID input) */
  highlightedRegionId = '';
  /** ID of the region currently awaiting a line-link assignment (link mode) */
  linkModeRegionId: string | null = null;

  // Gallery
  showGallery = false;
  galleryFilterPattern = '';

  // Transcription Annotation Layers
  activeLayer: 'notation' | 'transcription' | 'none' = 'notation';
  activeTranscriptionTool: VM.TranscriptionAnnotationType | null = 'line';
  pendingTranscriptionPoints: string[] = []; // array of "x,y" coordinates for ongoing polyline
  selectedTranscriptionAnnotationId: string | null = null;
  
  // Layer visibility toggles
  showRegions: boolean = true;
  showLines: boolean = true;
  showNotes: boolean = true;
  
  setTranscriptionTool(tool: VM.TranscriptionAnnotationType) {
    if (this.activeTranscriptionTool === 'line' && tool !== 'line') {
      if (this.pendingTranscriptionPoints.length > 1) {
        // Automatically finish line if they had placed multiple points
        this.finishTranscriptionLine();
      } else {
        // Discard if only 1 point
        this.pendingTranscriptionPoints = [];
      }
    }
    this.activeTranscriptionTool = tool;
  }
  
  // Dragging state for transcription annotations
  draggingAnnotationId: string | null = null;
  dragStartX: number = 0;
  dragStartY: number = 0;
  dragOriginalPoints: string = '';

  // Folio filter — setter snaps to first visible entry when toggled
  private _onlyDocumentFolios = true;
  get onlyDocumentFolios() { return this._onlyDocumentFolios; }
  set onlyDocumentFolios(v: boolean) {
    this._onlyDocumentFolios = v;
    // Snap to first visible canvas in the new filter state
    if (!this.userHasNavigated) this.selectFirstVisibleCanvas();
  }

  // True once the user explicitly clicks a canvas — prevents auto-snap from overriding
  private userHasNavigated = false;

  isAnalyzingLayout = false;

  constructor(
    private http: HttpClient,
    private navService: NavigationService,
    private zone: NgZone,
    private layoutAnalysisService: LayoutAnalysisService
  ) {}

  async runAutoLayoutAnalysis() {
    const imageUrl = this.currentCanvasImage;
    if (!imageUrl || !this.source) return;

    this.isAnalyzingLayout = true;
    try {
      const blocks = await this.layoutAnalysisService.analyzeImage(imageUrl, this.currentCanvasIndex);
      if (blocks && blocks.length > 0) {
        this.triggerBeforeChange();
        if (!this.source.annotationRegions) this.source.annotationRegions = [];

        const newRegions = this.layoutAnalysisService.blocksToAnnotationRegions(blocks, this.currentCanvasIndex);
        this.source.annotationRegions.push(...newRegions);
        this.save();
      }
    } catch (err) {
      console.error('Layout analysis failed:', err);
    } finally {
      this.isAnalyzingLayout = false;
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const isInput = target instanceof HTMLInputElement ||
                    target instanceof HTMLTextAreaElement ||
                    target?.isContentEditable ||
                    target?.tagName === 'INPUT' ||
                    target?.tagName === 'TEXTAREA';
    if (isInput) return;

    if (event.key === 'Enter') {
      if (this.activeLayer === 'transcription' && this.activeTranscriptionTool === 'line' && this.pendingTranscriptionPoints.length > 0) {
        this.finishTranscriptionLine();
      }
    } else if (event.key === 'Escape') {
      if (this.pendingTranscriptionPoints.length > 0) {
        this.pendingTranscriptionPoints = [];
      }
      this.selectedTranscriptionAnnotationId = null;
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !isInput) {
      if (this.selectedTranscriptionAnnotationId && !event.defaultPrevented) {
        event.preventDefault();
        const toDeleteId = this.selectedTranscriptionAnnotationId;
        // Roll selection to the right (next symbol) BEFORE deleting
        this.rollSymbolSelection(1);
        
        // If the selection didn't change (because it was the last symbol on the line), 
        // we'll just clear the selection after deleting.
        const selectionChanged = this.selectedTranscriptionAnnotationId !== toDeleteId;
        
        this.deleteTranscriptionAnnotation(toDeleteId);
        
        if (!selectionChanged) {
          this.selectedTranscriptionAnnotationId = null;
        }
      }
    }

    if (!isInput && this.activeLayer === 'transcription') {
      const toolKeys: Record<string, VM.TranscriptionAnnotationType | 'region'> = {
        '1': 'note', '2': 'clef_c', '3': 'clef_f', '4': 'accidental_flat', '5': 'accidental_sharp', 'R': 'region', 'r': 'region'
      };
      if (toolKeys[event.key]) {
        this.setTranscriptionTool(toolKeys[event.key]);
        return;
      }

      const selTa = this.source?.transcriptionAnnotations?.find(t => t.id === this.selectedTranscriptionAnnotationId);
      if (selTa && selTa.type !== 'line') {
        let changed = false;
        const s = event.key.toUpperCase();
        if (s === 'S') {
          selTa.graphicalConnection = selTa.graphicalConnection === 'looped' ? 'gaped' : 'looped';
          changed = true;
        } else if (s === 'N') {
          selTa.isNeumeStart = !selTa.isNeumeStart;
          changed = true;
        } else if (s === 'Q') {
          selTa.isNeumeStart = true;
          changed = true;
        } else if (s === 'W') {
          selTa.isNeumeStart = false;
          selTa.graphicalConnection = 'gaped';
          changed = true;
        } else if (s === 'E') {
          selTa.isNeumeStart = false;
          selTa.graphicalConnection = 'looped';
          changed = true;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          this.rollSymbolSelection(event.key === 'ArrowLeft' ? -1 : 1);
        }
        
        if (changed) {
          this.triggerBeforeChange();
          this.save();
        }
      }
    }
  }

  rollSymbolSelection(dir: number) {
    const selTa = this.source?.transcriptionAnnotations?.find(t => t.id === this.selectedTranscriptionAnnotationId);
    if (!selTa) return;
    const lineId = this.getClosestLineIdForSymbol(selTa);
    if (!lineId) return;
    const symbolsOnThisLine = this.currentCanvasTranscriptionAnnotations
      .filter(x => x.type !== 'line' && this.getClosestLineIdForSymbol(x) === lineId)
      .sort((a, b) => Number(a.points.split(',')[0]) - Number(b.points.split(',')[0]));
      
    const idx = symbolsOnThisLine.findIndex(x => x.id === selTa.id);
    if (idx !== -1) {
      const nextIdx = idx + dir;
      if (nextIdx >= 0 && nextIdx < symbolsOnThisLine.length) {
        this.selectedTranscriptionAnnotationId = symbolsOnThisLine[nextIdx].id;
      }
    }
  }

  deleteTranscriptionAnnotation(id: string) {
    if (!this.source || !this.source.transcriptionAnnotations) return;
    this.triggerBeforeChange();
    this.source.transcriptionAnnotations = this.source.transcriptionAnnotations.filter(ta => ta.id !== id);
    this.save();
  }

  ngOnInit(): void {
    // In simpleMode (document split-screen), keep the sidebar open so the user can navigate pages.
    // In full annotation mode (source view), start collapsed to give more space.
    this.leftSidebarCollapsed = false;
    this.navService.focusFolio$.subscribe(f => this.selectFolio(f));
  }

  ngOnChanges(c: SimpleChanges) {
    if (c['source'] && this.source?.iiifManifestUrl) {
      this.userHasNavigated = false;
      this.loadManifest(this.source.iiifManifestUrl);
    }
    // Patterns may arrive after the manifest — re-snap to first visible folio.
    // Skip in simpleMode: allPatterns is always [] there and we don't want to override the user's navigation.
    if (c['allPatterns'] && !this.simpleMode && this.canvases.length && !this.userHasNavigated) {
      this.selectFirstVisibleCanvas();
    }
    // Jump to gallery filtered to a pattern when requested from the notation overview
    if (c['jumpToPattern'] && this.jumpToPattern) {
      this.galleryFilterPattern = this.jumpToPattern;
      this.showGallery = true;
    }
    // Navigate to and highlight the region linked to the given line UUID
    if (c['highlightedLineUUID']) {
      if (this.highlightedLineUUID) {
        this.jumpToRegionByLineUUID(this.highlightedLineUUID);
      } else {
        this.highlightedRegionId = '';
      }
    }
    // Snap to folio index if passed programmatically (e.g. from document view line click)
    if (c['initialCanvasIndex'] && this.initialCanvasIndex !== undefined) {
      if (!this.userHasNavigated) {
        this.selectCanvas(this.initialCanvasIndex);
        this.userHasNavigated = false; // keep it false so it tracks programmatic changes
      }
    }
  }

  ngOnDestroy() {
    if (this._viewportRef?.nativeElement)
      this._viewportRef.nativeElement.removeEventListener('wheel', this.wheelFn);
  }

  // ── manifest ──────────────────────────────────────────────────────────────
  manifestLoading = false;

  loadManifest(url: string) {
    if (manifestCache.has(url)) { this.manifest = manifestCache.get(url); this.parseCanvases(); return; }
    this.manifestLoading = true;
    this.http.get<any>(url).subscribe(
      m => {
        if (manifestCache.size >= MAX_MANIFEST_CACHE_SIZE) {
          const firstKey = manifestCache.keys().next().value;
          if (firstKey) manifestCache.delete(firstKey);
        }
        manifestCache.set(url, m);
        this.manifest = m;
        this.manifestLoading = false;
        this.parseCanvases();
      },
      err => { this.manifestLoading = false; console.error('Failed to load IIIF manifest', err); }
    );
  }

  parseCanvases() {
    if (this.manifest?.sequences?.length > 0) this.canvases = this.manifest.sequences[0].canvases || [];
    else if (this.manifest?.items) this.canvases = this.manifest.items;
    else this.canvases = [];
    this.imageError = false;
    
    if (this.initialCanvasIndex !== undefined && this.initialCanvasIndex >= 0 && this.initialCanvasIndex < this.canvases.length) {
      this.currentCanvasIndex = this.initialCanvasIndex;
      this.imageLoading = true;
    } else {
      this.selectFirstVisibleCanvas();
    }
    this.resetView();
    this.backToRegions();
  }

  /** Jump to the first canvas in the current filtered list, or 0 if none. */
  private selectFirstVisibleCanvas() {
    const first = this.visibleCanvases[0];
    const idx = first ? first.originalIndex : 0;
    if (this.currentCanvasIndex !== idx) {
      this.currentCanvasIndex = idx;
      this.imageError = false;
      this.imageLoading = this.canvases.length > 0;
    } else if (this.canvases.length > 0) {
      this.imageLoading = true;
    }
  }

  selectFolio(s: string) {
    if (!this.canvases.length) return;
    const clean = s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const i = this.canvases.findIndex(c => c.label?.toLowerCase().replace(/[^a-zA-Z0-9]/g,'') === clean);
    if (i !== -1) { this.currentCanvasIndex = i; this.resetView(); }
  }

  selectCanvas(i: number) {
    this.userHasNavigated = true;
    if (this.currentCanvasIndex !== i) {
      this.currentCanvasIndex = i; 
      this.imageError = false; 
      this.imageLoading = true;
    }
    this.resetView(); 
    this.cancelBoxDraw(); 
    this.backToRegions();
  }

  private preloadedImageUrls = new Set<string>();

  private preloadAdjacentImages() {
    if (!this.canvases || !this.canvases.length) return;
    const targets = [this.currentCanvasIndex + 1, this.currentCanvasIndex - 1];
    for (const idx of targets) {
      if (idx >= 0 && idx < this.canvases.length) {
        const url = this.canvasImageAt(idx);
        if (url && !this.preloadedImageUrls.has(url)) {
          this.preloadedImageUrls.add(url);
          const img = new Image();
          img.src = url;
        }
      }
    }
  }

  get currentCanvasImage(): string | null { return this.canvasImageAt(this.currentCanvasIndex); }

  canvasImageAt(i: number): string | null {
    const c = this.canvases[i]; if (!c) return null;
    let url: string | null = null;
    if (c.images?.length > 0) url = c.images[0].resource?.['@id'] || c.images[0].resource?.id || null;
    else if (c.items?.length > 0) url = c.items[0]?.items?.[0]?.body?.id || null;
    if (!url) return null;
    url = url.replace(/\/native\.(jpg|png|webp)$/i, '/default.$1');
    // Request a bounded-width rendition so full manuscript scans (often
    // 5000-7000px, several MB) load fast. Only rewrites genuine IIIF Image API
    // URLs (region=full, size=full|max); anything else is left untouched.
    url = url.replace(
      /\/full\/(?:full|max)\/(\d+)\/(default|native)\.(jpg|png|webp)/i,
      `/full/${IIIF_IMAGE_WIDTH},/$1/$2.$3`
    );
    return url;
  }

  onImageError() { this.imageLoading = false; this.imageError = true; }
  onImageLoad()  {
    this.imageLoading = false;
    this.imageError = false;
    this.preloadAdjacentImages();
  }
  retryImage()   { this.imageError = false; this.imageLoading = true; }

  // ── zoom / pan ────────────────────────────────────────────────────────────
  private resetView() { this.scale = 1; this.translateX = 0; this.translateY = 0; }

  get contentTransform() { return `translate(${this.translateX}px,${this.translateY}px) scale(${this.scale})`; }

  /** Push the current transform straight to the DOM so pan/zoom feel instant,
   *  without waiting for a change-detection pass to update the style binding. */
  private applyTransformDirect(): void {
    const el = this.contentRef?.nativeElement;
    if (el) el.style.transform = this.contentTransform;
  }

  onWheel(e: WheelEvent) {
    const vp = this._viewportRef?.nativeElement; if (!vp) return;
    const r = vp.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = this.scale;
    const next = Math.min(50, Math.max(0.1, old * (e.deltaY > 0 ? 0.9 : 1.1)));
    this.translateX = mx - (mx - this.translateX) * (next / old);
    this.translateY = my - (my - this.translateY) * (next / old);
    this.scale = next;
    this.applyTransformDirect();
  }


  private startPan(e: MouseEvent) {
    this.isPanning = true; this.panStartX = e.clientX - this.translateX; this.panStartY = e.clientY - this.translateY; e.preventDefault();
  }
  private doPan(e: MouseEvent) { this.translateX = e.clientX - this.panStartX; this.translateY = e.clientY - this.panStartY; }
  private endPan() { this.isPanning = false; }

  private zoomToRegion(region: VM.AnnotationRegion) {
    const vp = this._viewportRef?.nativeElement, ct = this.contentRef?.nativeElement;
    if (!vp || !ct) return;
    const rect = this.rectFromPoints(region.points);
    if (!rect || rect.w < 0.1 || rect.h < 0.1) return;
    const vpW = vp.clientWidth, vpH = vp.clientHeight;
    const imgW = ct.clientWidth, imgH = ct.clientHeight;
    const rW = rect.w / 100 * imgW, rH = rect.h / 100 * imgH;
    const rX = rect.x / 100 * imgW, rY = rect.y / 100 * imgH;
    const ns = Math.min(50, Math.max(0.1, Math.min(vpW * 0.88 / rW, vpH * 0.88 / rH)));
    this.scale = ns;
    this.translateX = vpW / 2 - (rX + rW / 2) * ns;
    this.translateY = vpH / 2 - (rY + rH / 2) * ns;
  }

  // ── box drawing & panning ───────────────────────────────────────────────────────────
  private getPct(e: MouseEvent) {
    const el = this.contentRef?.nativeElement; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)),
      y: Math.max(0, Math.min(100, (e.clientY - r.top)  / r.height * 100))
    };
  }

  onMouseDown(e: MouseEvent) {
    if (e.altKey) {
      this.isPanning = true; this.panStartX = e.clientX; this.panStartY = e.clientY; return;
    }

    if (this.activeLayer === 'transcription' && this.activeTranscriptionTool) {
      if (this.activeTranscriptionTool === 'region') {
        this.startBoxDraw(e);
        return;
      }
      // If holding shift/ctrl/meta, maybe pan? Or just prevent default.
      const p = this.getPct(e);
      if (this.activeTranscriptionTool === 'line') {
        this.pendingTranscriptionPoints.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      } else {
        this.addTranscriptionSymbol(p, e.shiftKey);
      }
      return;
    }

    if (this.viewMode === 'regions' && this.pendingRegionPoints) return;
    if (this.viewMode === 'items' && !this.activePattern) return;
    if (this.simpleMode) {
      this.isPanning = true; this.panStartX = e.clientX; this.panStartY = e.clientY; return;
    }
    this.startBoxDraw(e);
  }

  onDoubleClick(e: MouseEvent) {
    if (this.activeLayer === 'transcription' && this.activeTranscriptionTool === 'line') {
      this.finishTranscriptionLine();
    }
  }

  startAnnotationDrag(e: MouseEvent, ta: VM.TranscriptionAnnotation) {
    if (this.activeLayer !== 'transcription') return;
    if (e.altKey) return; // Allow panning to take over
    e.stopPropagation();
    this.selectedTranscriptionAnnotationId = ta.id;
    this.draggingAnnotationId = ta.id;
    const p = this.getPct(e);
    this.dragStartX = p.x;
    this.dragStartY = p.y;
    this.dragOriginalPoints = ta.points;
  }

  onMouseMove(e: MouseEvent) {
    if (this.isPanning) {
      this.translateX += e.clientX - this.panStartX;
      this.translateY += e.clientY - this.panStartY;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.applyTransformDirect();
      return;
    }
    if (this.draggingAnnotationId && this.source?.transcriptionAnnotations) {
      const ta = this.source.transcriptionAnnotations.find(x => x.id === this.draggingAnnotationId);
      if (ta) {
        const p = this.getPct(e);
        const dx = p.x - this.dragStartX;
        const dy = p.y - this.dragStartY;
        ta.points = this.dragOriginalPoints.split(' ').map(pt => {
          const [px, py] = pt.split(',').map(Number);
          return `${(px + dx).toFixed(2)},${(py + dy).toFixed(2)}`;
        }).join(' ');
      }
      return;
    }
    if (this.isDraggingBox) this.updateBoxDraw(e);
  }

  onMouseUp(e: MouseEvent) {
    if (this.isPanning) { this.isPanning = false; return; }
    if (this.draggingAnnotationId) {
      this.triggerBeforeChange(); // Before saving
      this.save();
      this.draggingAnnotationId = null;
      return;
    }
    if (this.isDraggingBox) this.finishBoxDraw();
  }

  onMouseLeave(e: MouseEvent) {
    if (this.isPanning) this.isPanning = false;
    if (this.draggingAnnotationId) {
      this.triggerBeforeChange();
      this.save();
      this.draggingAnnotationId = null;
    }
    if (this.isDraggingBox) this.cancelBoxDraw();
  }

  get noteSquareSize() {
    return 0.8 / Math.sqrt(this.scale || 1);
  }
  get noteSquareRadius() {
    return 0.2 / Math.sqrt(this.scale || 1);
  }

  private distToSegmentSquared(px: number, py: number, vx: number, vy: number, wx: number, wy: number) {
    const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
    if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (px - (vx + t * (wx - vx))) ** 2 + (py - (vy + t * (wy - vy))) ** 2;
  }

  getClosestLineIdForSymbol(ta: VM.TranscriptionAnnotation): string | null {
    if (ta.type === 'line') return null;
    const [px, py] = ta.points.split(',').map(Number);
    // 1. Check if the point falls inside any region
    const regions = this.currentRegions;
    for (const r of regions) {
      if (r.lineUUID) { // Only consider regions that actually have a linked staff line
        const box = this.rectFromPoints(r.points);
        if (box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
          return r.lineUUID;
        }
      }
    }

    // 2. Fallback: geometric distance to all staff lines
    const lines = this.currentCanvasTranscriptionAnnotations.filter(x => x.type === 'line');
    
    // For grouping into reading order, allow notes to be visually above/below the line
    const GENEROUS_THRESHOLD = this.noteSquareSize * 4; 
    const THRESHOLD_SQ = GENEROUS_THRESHOLD * GENEROUS_THRESHOLD;
    
    let closestId: string | null = null;
    let minD2 = Infinity;

    for (const line of lines) {
      const pts = line.points.split(' ').map(p => p.split(',').map(Number));
      let lineD2 = Infinity;
      if (pts.length === 1) {
        lineD2 = (px - pts[0][0])**2 + (py - pts[0][1])**2;
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const d2 = this.distToSegmentSquared(px, py, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
          if (d2 < lineD2) lineD2 = d2;
        }
      }
      if (lineD2 <= THRESHOLD_SQ && lineD2 < minD2) {
        minD2 = lineD2;
        closestId = line.id;
      }
    }
    return closestId;
  }

  isSymbolOnLine(ta: VM.TranscriptionAnnotation): boolean {
    if (ta.type === 'line') return false;
    const [px, py] = ta.points.split(',').map(Number);
    const lines = this.currentCanvasTranscriptionAnnotations.filter(x => x.type === 'line');
    
    // STRICT threshold: The symbol must truly lay right on the line
    const STRICT_THRESHOLD = this.noteSquareSize / 3;
    const STRICT_THRESHOLD_SQ = STRICT_THRESHOLD * STRICT_THRESHOLD;
    
    for (const line of lines) {
      const pts = line.points.split(' ').map(p => p.split(',').map(Number));
      let lineD2 = Infinity;
      if (pts.length === 1) {
        lineD2 = (px - pts[0][0])**2 + (py - pts[0][1])**2;
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          const d2 = this.distToSegmentSquared(px, py, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
          if (d2 < lineD2) lineD2 = d2;
        }
      }
      if (lineD2 <= STRICT_THRESHOLD_SQ) {
        return true;
      }
    }
    return false;
  }

  get readingOrderLines(): { x1: number, y1: number, x2: number, y2: number }[] {
    const segments: { x1: number, y1: number, x2: number, y2: number }[] = [];
    const staffLines = this.currentCanvasTranscriptionAnnotations.filter(x => x.type === 'line');
    const symbols = this.currentCanvasTranscriptionAnnotations.filter(x => x.type !== 'line');

    for (const line of staffLines) {
      // Find all symbols belonging to this line
      const symbolsOnThisLine = symbols.filter(n => this.getClosestLineIdForSymbol(n) === line.id);
      
      // Sort them horizontally (by X coordinate)
      symbolsOnThisLine.sort((a, b) => {
        const ax = Number(a.points.split(',')[0]);
        const bx = Number(b.points.split(',')[0]);
        return ax - bx;
      });

      // Create segments between ordered symbols
      for (let i = 0; i < symbolsOnThisLine.length - 1; i++) {
        if (!symbolsOnThisLine[i+1].isNeumeStart) {
          const [x1, y1] = symbolsOnThisLine[i].points.split(',').map(Number);
          const [x2, y2] = symbolsOnThisLine[i+1].points.split(',').map(Number);
          segments.push({ x1, y1, x2, y2 });
        }
      }
    }
    return segments;
  }

  get graphicalConnectionLines(): { x1: number, y1: number, x2: number, y2: number }[] {
    const segments: { x1: number, y1: number, x2: number, y2: number }[] = [];
    const staffLines = this.currentCanvasTranscriptionAnnotations.filter(x => x.type === 'line');
    const symbols = this.currentCanvasTranscriptionAnnotations.filter(x => x.type !== 'line');

    for (const line of staffLines) {
      const symbolsOnThisLine = symbols.filter(n => this.getClosestLineIdForSymbol(n) === line.id);
      symbolsOnThisLine.sort((a, b) => {
        const ax = Number(a.points.split(',')[0]);
        const bx = Number(b.points.split(',')[0]);
        return ax - bx;
      });

      for (let i = 0; i < symbolsOnThisLine.length - 1; i++) {
        if (symbolsOnThisLine[i+1].graphicalConnection === 'looped') {
          const [x1, y1] = symbolsOnThisLine[i].points.split(',').map(Number);
          const [x2, y2] = symbolsOnThisLine[i+1].points.split(',').map(Number);
          segments.push({ x1, y1, x2, y2 });
        }
      }
    }
    return segments;
  }

  private addTranscriptionSymbol(p: {x: number, y: number}, isShift: boolean) {
    if (!this.source || !this.activeTranscriptionTool) return;
    if (!this.source.transcriptionAnnotations) this.source.transcriptionAnnotations = [];
    
    this.triggerBeforeChange();
    const isNeumeStart = isShift ? true : false;
    this.source.transcriptionAnnotations.push({
      id: 'ta_' + UUID(),
      folio: String(this.currentCanvasIndex),
      type: this.activeTranscriptionTool,
      points: `${p.x.toFixed(2)},${p.y.toFixed(2)}`,
      isNeumeStart: isNeumeStart,
      graphicalConnection: 'gaped'
    });
    this.save();
    // Auto-select the newly added symbol
    this.selectedTranscriptionAnnotationId = this.source.transcriptionAnnotations[this.source.transcriptionAnnotations.length - 1].id;
  }

  private finishTranscriptionLine() {
    if (this.pendingTranscriptionPoints.length < 2) {
      this.pendingTranscriptionPoints = [];
      return;
    }
    if (!this.source) return;
    if (!this.source.transcriptionAnnotations) this.source.transcriptionAnnotations = [];
    
    this.triggerBeforeChange();
    const lineId = 'ta_' + UUID();
    this.source.transcriptionAnnotations.push({
      id: lineId,
      folio: String(this.currentCanvasIndex),
      type: 'line',
      points: this.pendingTranscriptionPoints.join(' ')
    });

    // Auto-link line to region if its starting point falls inside one
    const [px, py] = this.pendingTranscriptionPoints[0].split(',').map(Number);
    for (const r of this.currentRegions) {
      const box = this.rectFromPoints(r.points);
      if (box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        r.lineUUID = lineId;
        break; // Link to the first enclosing region
      }
    }

    this.pendingTranscriptionPoints = [];
    this.save();
  }

  private startBoxDraw(e: MouseEvent) { const p = this.getPct(e); this.dragStartPct = p; this.dragCurrentPct = p; this.isDraggingBox = true; }
  private updateBoxDraw(e: MouseEvent) { this.dragCurrentPct = this.getPct(e); }

  private finishBoxDraw() {
    this.isDraggingBox = false;
    if (this.activeLayer === 'transcription' && this.activeTranscriptionTool === 'region') {
      const box = this.currentBoxRect; this.dragStartPct = null; this.dragCurrentPct = null;
      if (!box || box.w < 0.5 || box.h < 0.5) return;
      if (!this.source) return;
      if (!this.source.annotationRegions) this.source.annotationRegions = [];
      this.triggerBeforeChange();
      const r: VM.AnnotationRegion = {
        id: 'r_' + UUID(),
        name: this.suggestNextLineName(),
        points: this.boxToPoints(box),
        folio: String(this.currentCanvasIndex)
      };
      this.source.annotationRegions.push(r);
      this.save();
    } else if (this.viewMode === 'regions') {
      this.savePendingRegion();
    } else {
      this.saveItemAnnotation();
    }
  }

  cancelBoxDraw() { this.isDraggingBox = false; this.dragStartPct = null; this.dragCurrentPct = null; }

  get currentBoxRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.dragStartPct || !this.dragCurrentPct) return null;
    return {
      x: Math.min(this.dragStartPct.x, this.dragCurrentPct.x),
      y: Math.min(this.dragStartPct.y, this.dragCurrentPct.y),
      w: Math.abs(this.dragCurrentPct.x - this.dragStartPct.x),
      h: Math.abs(this.dragCurrentPct.y - this.dragStartPct.y)
    };
  }

  private boxToPoints(r: { x: number; y: number; w: number; h: number }): string {
    const f = (v: number) => v.toFixed(2);
    return `${f(r.x)},${f(r.y)} ${f(r.x+r.w)},${f(r.y)} ${f(r.x+r.w)},${f(r.y+r.h)} ${f(r.x)},${f(r.y+r.h)}`;
  }

  rectFromPoints(pts: string): { x: number; y: number; w: number; h: number } | null {
    if (!pts) return null;
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    for (const p of pts.split(' ')) {
      if (!p.trim()) continue;
      const [x, y] = p.split(',').map(Number);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** SVG path that covers the full image MINUS the active region (for the dim overlay).
   *  Using fill-rule="evenodd", the inner rect cancels the outer one = transparent hole. */
  getDimPath(): string {
    if (!this.activeRegion) return '';
    const r = this.rectFromPoints(this.activeRegion.points);
    if (!r) return '';
    return `M 0,0 L 100,0 L 100,100 L 0,100 Z ` +
           `M ${r.x},${r.y} L ${r.x+r.w},${r.y} L ${r.x+r.w},${r.y+r.h} L ${r.x},${r.y+r.h} Z`;
  }

  // ── level 1: line regions ─────────────────────────────────────────────────
  private savePendingRegion() {
    const box = this.currentBoxRect; this.dragStartPct = null; this.dragCurrentPct = null;
    if (!box || box.w < 0.5 || box.h < 0.5) return;
    this.pendingRegionPoints = this.boxToPoints(box);
    this.pendingRegionName = this.suggestNextLineName();
  }

  private suggestNextLineName(): string {
    const nums = (this.source?.annotationRegions ?? [])
      .filter(r => r.folio === String(this.currentCanvasIndex))
      .map(r => { const m = r.name.match(/\d+/); return m ? +m[0] : 0; }).filter(n => n > 0);
    return `Line ${nums.length ? Math.max(...nums) + 1 : 1}`;
  }

  confirmRegion() {
    const name = this.pendingRegionName.trim();
    if (!name || !this.pendingRegionPoints || !this.source) return;
    if (!this.source.annotationRegions) this.source.annotationRegions = [];
    
    this.triggerBeforeChange();
    const r: VM.AnnotationRegion = { id: 'r_' + UUID(), name, points: this.pendingRegionPoints, folio: String(this.currentCanvasIndex) };
    this.source.annotationRegions.push(r);
    this.pendingRegionPoints = null; this.pendingRegionName = '';
    this.save();
    this.enterItemMode(r);
  }

  cancelPendingRegion() { this.pendingRegionPoints = null; this.pendingRegionName = ''; }

  enterItemMode(region: VM.AnnotationRegion) {
    if (this.simpleMode) {
      // Highlight the region locally as well
      this.highlightedRegionId = region.id;
      // Emit lineUUID so the document component can focus the linked line in the transcription
      this.regionClicked.emit({ name: region.name, folio: region.folio, lineUUID: region.lineUUID });
      return;
    }
    this.activeRegion = region; this.viewMode = 'items';
    this.cancelBoxDraw(); this.closeLinking();
    setTimeout(() => this.zoomToRegion(region), 60);
  }

  backToRegions() {
    this.viewMode = 'regions'; this.activeRegion = null;
    this.pendingRegionPoints = null; this.pendingRegionName = '';
    this.closeLinking(); this.cancelBoxDraw();
  }

  /** Find the region with lineUUID === uuid, navigate to its canvas, and highlight it. */
  jumpToRegionByLineUUID(uuid: string) {
    const region = (this.source?.annotationRegions ?? []).find(r => r.lineUUID === uuid);
    if (!region) { this.highlightedRegionId = ''; return; }
    const canvasIdx = parseInt(region.folio, 10);
    if (!isNaN(canvasIdx) && canvasIdx !== this.currentCanvasIndex) {
      this.currentCanvasIndex = canvasIdx;
      this.imageError = false;
      this.imageLoading = true;
      this.resetView();
    }
    this.highlightedRegionId = region.id;
    this.showGallery = false;
    if (this.viewMode !== 'regions') this.backToRegions();
  }

  /** Start link mode: the next line-UUID assignment from outside will link to this region. */
  startRegionLinkMode(region: VM.AnnotationRegion) {
    this.linkModeRegionId = region.id;
    this.requestLineLink.emit({ regionId: region.id, regionName: region.name });
  }

  /** Called by the document component when the user clicks a line-change while in link mode. */
  linkLineToRegion(lineUUID: string) {
    if (!this.linkModeRegionId || !this.source) { this.linkModeRegionId = null; return; }
    const region = (this.source.annotationRegions ?? []).find(r => r.id === this.linkModeRegionId);
    if (region) { 
      this.triggerBeforeChange();
      region.lineUUID = lineUUID; this.save(); 
    }
    this.linkModeRegionId = null;
  }

  clearRegionLink(region: VM.AnnotationRegion) {
    this.triggerBeforeChange();
    region.lineUUID = undefined;
    this.if_highlighted_clear(region.id);
    this.save();
  }

  private if_highlighted_clear(regionId: string) {
    if (this.highlightedRegionId === regionId) this.highlightedRegionId = '';
  }

  startRename(region: VM.AnnotationRegion) {
    this.renamingRegionId = region.id;
    this.renamingValue = region.name;
  }

  confirmRename() {
    const name = this.renamingValue.trim();
    if (!name || !this.source) return;
    const r = (this.source.annotationRegions ?? []).find(x => x.id === this.renamingRegionId);
    if (r) { 
      this.triggerBeforeChange();
      r.name = name; this.save(); 
    }
    this.renamingRegionId = null; this.renamingValue = '';
  }

  cancelRename() { this.renamingRegionId = null; this.renamingValue = ''; }
  deleteRegion(id: string) {
    if (!this.source) return;
    this.triggerBeforeChange();
    this.source.annotationRegions = (this.source.annotationRegions ?? []).filter(r => r.id !== id);
    this.source.annotationItems   = (this.source.annotationItems   ?? []).filter(i => i.regionId !== id);
    this.save();
    if (this.activeRegion?.id === id) this.backToRegions();
  }

  onDeleteRegionChip(e: MouseEvent, id: string) { e.stopPropagation(); this.deleteRegion(id); }

  regionItemCount(id: string) { return (this.source?.annotationItems ?? []).filter(i => i.regionId === id).length; }

  get currentRegions(): VM.AnnotationRegion[] {
    return (this.source?.annotationRegions ?? []).filter(r => r.folio === String(this.currentCanvasIndex));
  }

  get currentCanvasItems(): VM.AnnotationItem[] {
    const cStr = String(this.currentCanvasIndex);
    const rs = new Set((this.source?.annotationRegions ?? []).filter(r => r.folio === cStr).map(r => r.id));
    return (this.source?.annotationItems ?? []).filter(i => rs.has(i.regionId));
  }

  get currentCanvasTranscriptionAnnotations(): VM.TranscriptionAnnotation[] {
    const cStr = String(this.currentCanvasIndex);
    return (this.source?.transcriptionAnnotations ?? []).filter(ta => ta.folio === cStr);
  }

  /**
   * Normalize a folio string to a canonical form for comparison.
   * Handles:
   *   "fol. 1r", "f. 1r", "Bl. 1r", "folio 1r" → "1r"
   *   "1 recto", "1 Recto"                       → "1r"
   *   "1 verso",  "1v"                            → "1v"
   *   "1" (no suffix)                             → "1" (matches both "1" and "1r")
   */
  private normalizeFolio(raw: string): string {
    return String(raw)
      .toLowerCase()
      .replace(/\b(fol|folio|bl|blatt|page|pg|leaf)\b\.?\s*/g, '')  // strip common prefixes
      .replace(/\brecto\b/g, 'r')
      .replace(/\bverso\b/g, 'v')
      .replace(/[^a-z0-9]/g, '');  // remove remaining spaces / punctuation
  }

  /** True when two folio strings refer to the same leaf side.
   *  A bare number (no r/v) is treated as recto ("1" ~ "1r"). */
  private folioMatches(a: string, b: string): boolean {
    const na = this.normalizeFolio(a);
    const nb = this.normalizeFolio(b);
    if (na === nb) return true;
    // bare number ↔ explicit recto: "1" ~ "1r"
    if (/^\d+$/.test(na) && na + 'r' === nb) return true;
    if (/^\d+$/.test(nb) && nb + 'r' === na) return true;
    return false;
  }

  // Memoized so panning/zooming (which fire change detection on every mouse
  // move) don't re-run the O(canvases × folios) regex matching each time. The
  // cache is keyed on the references these getters actually depend on; none of
  // them change during a pan, so the work runs once per real data change.
  private _dciCache?: Set<number>;
  private _dciKey?: any[];
  private _vcCache?: { canvas: any; originalIndex: number }[];
  private _vcKey?: any[];

  private keyEquals(a: any[] | undefined, b: any[]): boolean {
    return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  /** Set of canvas indices that have at least one document folio match */
  get documentCanvasIndices(): Set<number> {
    const key = [this.canvases, this.documentFolios, this.allPatterns, this.simpleMode];
    if (this._dciCache && this.keyEquals(this._dciKey, key)) return this._dciCache;

    // Collect target folios either from pattern occurrences (global view) or explicit documentFolios (simpleMode)
    let targetFolios: string[] = [];
    if (this.documentFolios && this.documentFolios.length > 0) {
      targetFolios = this.documentFolios;
    } else {
      targetFolios = this.allPatterns.map(p => String(p.folio));
    }

    const s = new Set<number>();
    this.canvases.forEach((c, i) => {
      const label = String(c.label || '');
      if (targetFolios.some(f => this.folioMatches(f, label))) {
        s.add(i);
        // In simpleMode, text before a Folio marker belongs to the previous canvas.
        if (this.simpleMode && i > 0) s.add(i - 1);
      }
    });

    this._dciCache = s;
    this._dciKey = key;
    return s;
  }

  /** Canvases list, optionally filtered to document folios */
  get visibleCanvases(): { canvas: any; originalIndex: number }[] {
    const dci = this.documentCanvasIndices;
    const key = [this.canvases, this.onlyDocumentFolios, dci];
    if (this._vcCache && this.keyEquals(this._vcKey, key)) return this._vcCache;

    const result = this.canvases
      .map((canvas, i) => ({ canvas, originalIndex: i }))
      .filter(entry => !this.onlyDocumentFolios || dci.size === 0 || dci.has(entry.originalIndex));

    this._vcCache = result;
    this._vcKey = key;
    return result;
  }

  trackByOriginalIndex(index: number, entry: { canvas: any; originalIndex: number }): number {
    return entry.originalIndex;
  }

  // ── level 2: item annotation ──────────────────────────────────────────────
  private saveItemAnnotation() {
    const box = this.currentBoxRect; this.dragStartPct = null; this.dragCurrentPct = null;
    if (!box || box.w < 0.5 || box.h < 0.5 || !this.activePattern || !this.source || !this.activeRegion) return;
    if (!this.source.annotationItems) this.source.annotationItems = [];
    this.triggerBeforeChange();
    const newItem: VM.AnnotationItem = {
      id: 'item_' + UUID(),
      regionId: this.activeRegion.id,
      pattern: this.activePattern,
      variant: this.activeVariant || undefined,
      points: this.boxToPoints(box)
    };
    this.source.annotationItems.push(newItem);
    this.save();
    // Auto-open linker if there are candidates on this page
    this.openLinking(newItem.id);
  }

  openLinking(itemId: string) {
    this.linkingItemId = itemId;
    const item = (this.source?.annotationItems ?? []).find(i => i.id === itemId);
    if (!item) return;
    // Show ALL occurrences of this pattern across the whole source,
    // sorted by folio then line — let the user pick the right one.
    this.linkCandidates = this.allPatterns
      .filter(p => p.patternId === item.pattern)
      .sort((a, b) => a.folio.localeCompare(b.folio) || String(a.line).localeCompare(String(b.line)));
    if (this.linkCandidates.length === 0) this.linkingItemId = null;
  }

  doLink(cand: AnalyzedPattern) {
    const item = (this.source?.annotationItems ?? []).find(i => i.id === this.linkingItemId);
    if (item) {
      this.triggerBeforeChange();
      item.uuid = cand.uuid;
      this.save();
    }
    this.closeLinking();
  }

  clearLink(itemId: string) {
    const item = (this.source?.annotationItems ?? []).find(i => i.id === itemId);
    if (item) {
      this.triggerBeforeChange();
      item.uuid = undefined;
      this.save();
    }
  }

  closeLinking() { this.linkingItemId = null; this.linkCandidates = []; }

  deleteItem(id: string) {
    if (!this.source) return;
    this.triggerBeforeChange();
    this.source.annotationItems = (this.source.annotationItems ?? []).filter(i => i.id !== id);
    if (this.linkingItemId === id) this.closeLinking();
    this.save();
  }

  itemDisplayId(item: VM.AnnotationItem): string { return item.variant ? `${item.pattern} ${item.variant}` : item.pattern; }

  linkingItemDisplayId(): string {
    if (!this.linkingItemId || !this.source?.annotationItems) return '';
    const item = this.source.annotationItems.find(i => i.id === this.linkingItemId);
    return item ? this.itemDisplayId(item) : '';
  }

  getItemById(id: string): VM.AnnotationItem | undefined {
    return (this.source?.annotationItems ?? []).find(i => i.id === id);
  }

  get activeRegionItems(): VM.AnnotationItem[] {
    if (!this.activeRegion) return [];
    return (this.source?.annotationItems ?? []).filter(i => i.regionId === this.activeRegion!.id);
  }

  // ── pattern picker ────────────────────────────────────────────────────────
  get filteredPatterns(): string[] {
    const base = this.documentPatterns.length > 0
      ? this.documentPatterns
      : Array.from(new Set((this.source?.annotationItems ?? []).map(i => i.pattern)));
    const q = this.patternSearch.toLowerCase().trim();
    return q ? base.filter(p => p.toLowerCase().includes(q)) : base;
  }

  setVariant(v: string) { this.activeVariant = this.activeVariant === v ? '' : v; }

  // ── gallery ───────────────────────────────────────────────────────────────

  /** Expand a rect with padding (0–1 factor), clamped to 0–100 */
  private paddedRect(r: { x: number; y: number; w: number; h: number }, pad = 0.35) {
    const px = Math.max(r.w * pad, 1.5);
    const py = Math.max(r.h * pad, 1.5);
    const x = Math.max(0, r.x - px);
    const y = Math.max(0, r.y - py);
    const w = Math.min(100 - x, r.w + px * 2);
    const h = Math.min(100 - y, r.h + py * 2);
    return { x, y, w, h };
  }

  get galleryItems(): GalleryItem[] {
    if (!this.source) return [];
    const regions = this.source.annotationRegions ?? [];
    const uuidMap = new Map(this.allPatterns.map(p => [p.uuid, p]));
    return (this.source.annotationItems ?? [])
      .filter(item => !this.galleryFilterPattern ||
        item.pattern.toLowerCase().includes(this.galleryFilterPattern.toLowerCase()))
      .map(item => {
        const region = regions.find(r => r.id === item.regionId);
        const canvasIdx = parseInt(region?.folio ?? '0', 10);
        const imageUrl = this.canvasImageAt(canvasIdx);
        const raw = this.rectFromPoints(item.points) ?? { x: 0, y: 0, w: 10, h: 10 };
        const rect = this.paddedRect(raw);
        return { item, region, canvasIdx, imageUrl: imageUrl!, rect,
                 rawRect: raw,
                 linked: item.uuid ? uuidMap.get(item.uuid) : undefined };
      }).filter(g => !!g.imageUrl);
  }

  navigateToItem(g: GalleryItem) {
    this.showGallery = false;
    this.selectCanvas(g.canvasIdx);
    if (g.region) setTimeout(() => this.enterItemMode(g.region!), 80);
  }
}
