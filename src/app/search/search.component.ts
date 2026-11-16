import { FocusService } from '../focus.service';
import { PdfDialogLauncher } from '../pdf-export-dialog.component';
import { sanitizeNotationColor } from '../notation-color';
import { sanitizeClefDisplayMode } from '../clef-policy';
import { Component, OnInit, OnDestroy, AfterViewChecked, ChangeDetectorRef, ViewChild, ElementRef, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { StatusLineService } from '../status-line.service';
import { APIService, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { Subscription } from 'rxjs';
import { PageTitleService } from '../page-title.service';
import { PatternAnalysisService } from './pattern-analysis.service';
import { SynopsisService, AlignedNode, AlignedLineElement } from './synopsis.service';
import { SearchExecService, TextSnippet, QuickResult, MelodyResult } from './search-exec.service';
import * as VM from '../types/model';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import 'svg2pdf.js';
import { FileSystemService } from '../file-system.service';
import {
  PatternOccurrence,
  PatternGroup,
  computePatternGroups
} from './pattern-algo';
import { safeStorage } from '../safe-storage';
import { SelectionService } from '../selection/selection.service';
import { IdSelection, uniqueIds } from '../selection/selection-set';

// ─── Column config ────────────────────────────────────────────────────────────

export interface ColDef<T> {
  key: keyof T | string;
  label: string;
  visible: boolean;
}

const SYNOPSIS_COLS_KEY = 'monodi_synopsis_cols';
const DEFAULT_SYNOPSIS_COLS: ColDef<Document>[] = [
  { key: 'dokumenten_id',            label: 'Document ID / Siglum', visible: true  },
  { key: 'textinitium',              label: 'Text Incipit',         visible: true  },
  { key: 'festtag',                  label: 'Feast Day',            visible: true  },
  { key: 'feier',                    label: 'Celebration',          visible: true  },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.',   visible: true  },
  { key: 'druckausgabe',             label: 'Print Edition',        visible: false },
  { key: 'gattung1',                 label: 'Genre 1',              visible: false },
  { key: 'gattung2',                 label: 'Genre 2',              visible: false },
  { key: 'foliostart',               label: 'Folio Start',          visible: false },
  { key: 'zeilenstart',              label: 'Line Start',           visible: false },
  { key: 'kommentar',                label: 'Commentary',           visible: false },
];

/** The most selected documents whose ids are written into the address bar (`compare=`). */
const SELECTION_URL_MAX = 50;
/** A synopsis of more witnesses than this is hard to read and slow to align; the user is asked first. */
const SYNOPSIS_MAX_WITNESSES = 20;
/** Printing or analysing more documents than this asks for a confirmation first. */
const BIG_SELECTION = 200;


// ─── Quick-search result ──────────────────────────────────────────────────────



// PatternOccurrence and PatternGroup interfaces are imported from pattern-algo.ts

export interface TimelineDocOccurrence {
  groupId: number;
  occurrence: PatternOccurrence;
  color: string;
  startPct: number;
  endPct: number;
  widthPct: number;
  length: number;
}

export interface TimelineDoc {
  doc: Document;
  sourceSigle: string;
  totalNotes: number;
  occurrences: TimelineDocOccurrence[];
}

export { arrayLevenshtein } from './pattern-algo';

// ─── Melody SVG renderer ──────────────────────────────────────────────────────



// ─── Component ────────────────────────────────────────────────────────────────

/** The two kinds of search: words (in transcriptions and metadata) and melody. */
export type SearchTab = 'quick' | 'melody';

@Component({
    selector: 'app-search',
    templateUrl: './search.component.html',
    styleUrls: ['./search.component.css'],
    standalone: false
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewChecked {
  activeTab: SearchTab = 'quick';
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  // ── Selection ─────────────────────────────────────────────────────────────
  /** The picks of the user live in a service, so they survive leaving the page and the Analysis page can use them. */
  readonly selSvc = inject(SelectionService);
  get selection(): IdSelection { return this.selSvc.selection; }
  /** The selected documents: real documents of the workspace index, the same array until the selection changes. */
  get selectedDocs(): Document[] { return this.selSvc.selectedDocs(); }
  set selectedDocs(docs: Document[]) { this.selSvc.replaceWith(docs); }

  // ── Synoptic Comparison ───────────────────────────────────────────────────
  /** The witnesses shown in the synopsis: the selection, or its first `SYNOPSIS_MAX_WITNESSES` documents. */
  synopsisDocs: Document[] = [];
  showSynopsis = false;
  private readonly focusSvc = inject(FocusService);
  private readonly pdfDialog = inject(PdfDialogLauncher);
  synopsisLoading = false;
  synopsisPdfExporting = false;


  get alignedTree(): AlignedNode[] { return this.synopsisSvc.alignedTree; }
  set alignedTree(v: AlignedNode[]) { this.synopsisSvc.alignedTree = v; }

  private _flatSegCache: { tree: AlignedNode[]; segs: AlignedNode[] } | null = null;
  /** Flat, in-order list of the staff-bearing segments across the aligned tree
   *  (used by the one-line structural layout). Memoised by tree reference. */
  get flatSegments(): AlignedNode[] {
    const tree = this.alignedTree;
    if (this._flatSegCache && this._flatSegCache.tree === tree) return this._flatSegCache.segs;
    const out: AlignedNode[] = [];
    const walk = (nodes: AlignedNode[]) => {
      for (const n of nodes) {
        if (n.alignedLineElements) out.push(n);
        if (n.children && n.children.length) walk(n.children);
      }
    };
    walk(tree);
    this._flatSegCache = { tree, segs: out };
    return out;
  }

  /** Total rendered width of a segment (sum of its column widths). */
  segmentWidth(node: AlignedNode): number {
    if (!node.alignedLineElements) return 0;
    return node.alignedLineElements.reduce((sum, col) => sum + this.getColumnWidth(col), 0);
  }

  get isStructuralMode(): boolean {
    return this.alignmentMode === 'signature' || this.alignmentMode === 'structure' || this.alignmentMode === 'sequential';
  }

  // ── One-line synopsis virtualisation (only render segments near the viewport) ──
  @ViewChild('synScroll') synScrollRef?: ElementRef<HTMLElement>;
  synVisibleSegments: AlignedNode[] = [];
  synLeadWidth = 0;
  synTailWidth = 0;
  private _synWindowFor: AlignedNode[] | null = null;
  private _synWindowKey = '';
  private _synOffsets: number[] = [];
  private _synOffsetsFor: AlignedNode[] | null = null;
  private _synRaf = 0;

  trackBySegment = (_: number, seg: AlignedNode) => seg;

  /** Cumulative left offsets of each segment (length = segments + 1). */
  private synOffsets(segs: AlignedNode[]): number[] {
    if (this._synOffsetsFor === segs) return this._synOffsets;
    const offs = [0];
    for (const s of segs) offs.push(offs[offs.length - 1] + this.segmentWidth(s));
    this._synOffsets = offs;
    this._synOffsetsFor = segs;
    return offs;
  }

  /** Recompute which segments to render for the current scroll position. */
  private updateSynWindow(scrollLeft: number, viewport: number): void {
    const segs = this.flatSegments;
    if (segs.length === 0) { this.synVisibleSegments = []; this.synLeadWidth = 0; this.synTailWidth = 0; return; }
    const offs = this.synOffsets(segs);
    const total = offs[segs.length];
    const buffer = Math.max(1000, viewport);
    const min = scrollLeft - buffer;
    const max = scrollLeft + viewport + buffer;
    let start = 0;
    while (start < segs.length && offs[start + 1] <= min) start++;
    let end = start;
    while (end < segs.length && offs[end] < max) end++;
    if (end <= start) end = Math.min(segs.length, start + 1);
    this.synVisibleSegments = segs.slice(start, end);
    this.synLeadWidth = offs[start];
    this.synTailWidth = Math.max(0, total - offs[end]);
  }

  onSynScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    if (this._synRaf) return;
    this._synRaf = requestAnimationFrame(() => {
      this._synRaf = 0;
      this.updateSynWindow(el.scrollLeft, el.clientWidth);
      this.cdRef.markForCheck();
    });
  }

  get docSigles(): { [docId: string]: string } { return this.synopsisSvc.docSigles; }
  set docSigles(v: { [docId: string]: string }) { this.synopsisSvc.docSigles = v; }

  get alignmentMode(): 'signature' | 'structure' | 'sequential' | 'melody' | 'text' { return this.synopsisSvc.alignmentMode; }
  set alignmentMode(v: 'signature' | 'structure' | 'sequential' | 'melody' | 'text') { this.synopsisSvc.alignmentMode = v; }

  get showConsensusText(): boolean { return this.synopsisSvc.showConsensusText; }
  set showConsensusText(v: boolean) { this.synopsisSvc.showConsensusText = v; }

  get showSingleLineSynopsis(): boolean { return this.synopsisSvc.showSingleLineSynopsis; }
  set showSingleLineSynopsis(v: boolean) { this.synopsisSvc.showSingleLineSynopsis = v; }

  get chunkedMelodyRows(): AlignedLineElement[][][] { return this.synopsisSvc.chunkedMelodyRows; }
  set chunkedMelodyRows(v: AlignedLineElement[][][]) { this.synopsisSvc.chunkedMelodyRows = v; }

  get cachedRootContainers(): VM.RootContainer[] { return this.synopsisSvc.cachedRootContainers; }
  set cachedRootContainers(v: VM.RootContainer[]) { this.synopsisSvc.cachedRootContainers = v; }

  get cachedDocIds(): string[] { return this.synopsisSvc.cachedDocIds; }
  set cachedDocIds(v: string[]) { this.synopsisSvc.cachedDocIds = v; }

  // ── Quick / Full-text search delegation ────────────────────────────────────
  get searchProgress() { return this.searchExecSvc.searchProgress; }
  set searchProgress(v) { this.searchExecSvc.searchProgress = v; }

  get searchCancelled() { return this.searchExecSvc.searchCancelled; }
  set searchCancelled(v) { this.searchExecSvc.searchCancelled = v; }

  get quickText() { return this.searchExecSvc.quickText; }
  set quickText(v) { this.searchExecSvc.quickText = v; }

  get quickResults() { return this.searchExecSvc.quickResults; }
  set quickResults(v) { this.searchExecSvc.quickResults = v; }

  get quickSearched() { return this.searchExecSvc.quickSearched; }
  set quickSearched(v) { this.searchExecSvc.quickSearched = v; }

  get quickSearching() { return this.searchExecSvc.quickSearching; }
  set quickSearching(v) { this.searchExecSvc.quickSearching = v; }

  get quickSearchMode() { return this.searchExecSvc.quickSearchMode; }
  set quickSearchMode(v) { this.searchExecSvc.quickSearchMode = v; }

  get quickMedievalTolerance() { return this.searchExecSvc.quickMedievalTolerance; }
  set quickMedievalTolerance(v) { this.searchExecSvc.quickMedievalTolerance = v; }

  get quickFuzzyDistance() { return this.searchExecSvc.quickFuzzyDistance; }
  set quickFuzzyDistance(v) { this.searchExecSvc.quickFuzzyDistance = v; }

  get quickPage() { return this.searchExecSvc.quickPage; }
  set quickPage(v) { this.searchExecSvc.quickPage = v; }

  // ── Source search delegation ───────────────────────────────────────────────





  // ── Document search delegation ─────────────────────────────────────────────





  // ── Melody search delegation ───────────────────────────────────────────────
  get melodyPattern() { return this.searchExecSvc.melodyPattern; }
  set melodyPattern(v) { this.searchExecSvc.melodyPattern = v; }

  get melodySearchType() { return this.searchExecSvc.melodySearchType; }
  set melodySearchType(v) { this.searchExecSvc.melodySearchType = v; }

  get melodyWithOctave() { return this.searchExecSvc.melodyWithOctave; }
  set melodyWithOctave(v) { this.searchExecSvc.melodyWithOctave = v; }

  get melodyIncludeTransposed() { return this.searchExecSvc.melodyIncludeTransposed; }
  set melodyIncludeTransposed(v) { this.searchExecSvc.melodyIncludeTransposed = v; }

  get melodyWindow() { return this.searchExecSvc.melodyWindow; }
  set melodyWindow(v) { this.searchExecSvc.melodyWindow = Math.max(0, Math.min(200, Math.floor(Number(v) || 0))); }

  /** Where the quick and the melody search look: every document, or only the documents of the selection. */
  searchScope: 'all' | 'selection' = 'all';

  private applySearchScope(): void {
    const sel = this.searchScope === 'selection' && this.selection.size > 0;
    this.searchExecSvc.scopeIds = sel ? new Set(this.selection.ids()) : null;
    this.searchExecSvc.scopeKey = sel ? `sel:${this.selection.version}` : '';
  }

  get melodyOnlyWithinSyllables() { return this.searchExecSvc.melodyOnlyWithinSyllables; }
  set melodyOnlyWithinSyllables(v) { this.searchExecSvc.melodyOnlyWithinSyllables = v; }

  showAdvancedOptions = false;

  get melodyRangeStartPct() { return this.searchExecSvc.melodyRangeStartPct; }
  set melodyRangeStartPct(v) { this.searchExecSvc.melodyRangeStartPct = Math.max(0, Math.min(100, v ?? 0)); }

  get melodyRangeEndPct() { return this.searchExecSvc.melodyRangeEndPct; }
  set melodyRangeEndPct(v) { this.searchExecSvc.melodyRangeEndPct = Math.max(0, Math.min(100, v ?? 100)); }

  wildcardViewMode: 'pitch' | 'interval' = 'pitch';
  get wildcardStats() { return this.searchExecSvc.wildcardStats; }
  Math = Math;

  onRangeStartChange(val: any): void {
    const v = Math.max(0, Math.min(100, Number(val) || 0));
    if (v > this.melodyRangeEndPct) {
      this.searchExecSvc.melodyRangeEndPct = v;
    }
    this.searchExecSvc.melodyRangeStartPct = v;
  }

  onRangeEndChange(val: any): void {
    const v = Math.max(0, Math.min(100, Number(val) || 100));
    if (v < this.melodyRangeStartPct) {
      this.searchExecSvc.melodyRangeStartPct = v;
    }
    this.searchExecSvc.melodyRangeEndPct = v;
  }

  get melodyResults() { return this.searchExecSvc.melodyResults; }
  set melodyResults(v) { this.searchExecSvc.melodyResults = v; }

  get melodySearched() { return this.searchExecSvc.melodySearched; }
  set melodySearched(v) { this.searchExecSvc.melodySearched = v; }

  get melodySearching() { return this.searchExecSvc.melodySearching; }
  set melodySearching(v) { this.searchExecSvc.melodySearching = v; }

  get melodyScanned() { return this.searchExecSvc.melodyScanned; }
  set melodyScanned(v) { this.searchExecSvc.melodyScanned = v; }

  get melodyWithNotes() { return this.searchExecSvc.melodyWithNotes; }
  set melodyWithNotes(v) { this.searchExecSvc.melodyWithNotes = v; }

  get melodyMaxDistance() { return this.searchExecSvc.melodyMaxDistance; }
  set melodyMaxDistance(v) { this.searchExecSvc.melodyMaxDistance = v; }

  get melodyPage() { return this.searchExecSvc.melodyPage; }
  set melodyPage(v) { this.searchExecSvc.melodyPage = v; }


  synopsisMetadataCols: ColDef<Document>[] = [];
  showSynopsisColPicker = false;

  quickPageSize = 25;
  melodyPageSize = 10;

  // ── Recent searches ───────────────────────────────────────────────────────

  // ── Pattern analysis state delegation ──────────────────────────────────────
  get showPatternAnalysis() { return this.patternSvc.showPatternAnalysis; }
  set showPatternAnalysis(v) { this.patternSvc.showPatternAnalysis = v; }

  get patternLength() { return this.patternSvc.patternLength; }
  set patternLength(v) { this.patternSvc.patternLength = v; }

  get patternType() { return this.patternSvc.patternType; }
  set patternType(v) { this.patternSvc.patternType = v; }

  get patternWithOctave() { return this.patternSvc.patternWithOctave; }
  set patternWithOctave(v) { this.patternSvc.patternWithOctave = v; }

  get patternStrictness() { return this.patternSvc.patternStrictness; }
  set patternStrictness(v) { this.patternSvc.patternStrictness = v; }

  get patternProgress() { return this.patternSvc.patternProgress; }
  set patternProgress(v) { this.patternSvc.patternProgress = v; }

  get patternSearching() { return this.patternSvc.patternSearching; }
  set patternSearching(v) { this.patternSvc.patternSearching = v; }

  get patternCancelled() { return this.patternSvc.patternCancelled; }
  set patternCancelled(v) { this.patternSvc.patternCancelled = v; }

  get patternGroups() { return this.patternSvc.patternGroups; }
  set patternGroups(v) { this.patternSvc.patternGroups = v; }

  get patternPage() { return this.patternSvc.patternPage; }
  set patternPage(v) { this.patternSvc.patternPage = v; }

  get patternViewMode() { return this.patternSvc.patternViewMode; }
  set patternViewMode(v) { this.patternSvc.patternViewMode = v; }

  get patternTimelineDocs() { return this.patternSvc.patternTimelineDocs; }
  set patternTimelineDocs(v) { this.patternSvc.patternTimelineDocs = v; }

  get patternDocTotalNotes() { return this.patternSvc.patternDocTotalNotes; }
  set patternDocTotalNotes(v) { this.patternSvc.patternDocTotalNotes = v; }

  get patternMergeEnabled() { return this.patternSvc.patternMergeEnabled; }
  set patternMergeEnabled(v) { this.patternSvc.patternMergeEnabled = v; }

  get patternMinMergeOverlap() { return this.patternSvc.patternMinMergeOverlap; }
  set patternMinMergeOverlap(v) { this.patternSvc.patternMinMergeOverlap = v; }

  get patternDeduplicateEnabled() { return this.patternSvc.patternDeduplicateEnabled; }
  set patternDeduplicateEnabled(v) { this.patternSvc.patternDeduplicateEnabled = v; }

  get detectedDuplicates() { return this.patternSvc.detectedDuplicates; }
  set detectedDuplicates(v) { this.patternSvc.detectedDuplicates = v; }

  get patternWorker() { return this.patternSvc.patternWorker; }
  set patternWorker(v) { this.patternSvc.patternWorker = v; }

  get savedPatternSessions() { return this.patternSvc.savedPatternSessions; }
  set savedPatternSessions(v) { this.patternSvc.savedPatternSessions = v; }

  patternPageSize = 20;
  private pendingPatternScrollId: number | null = null;
  hoveredGroupId: number | null = null;
  hoveredOccurrence: any = null;
  tooltipX = 0;
  tooltipY = 0;
  showSavedSessionsPopover = false;
  showSaveSessionForm = false;
  newSessionName = '';


  // ── Performance knobs ─────────────────────────────────────────────────────








  // ── Cached sort results (avoid recomputing per CD pass) ──────────────────

  // ── Post-search filter ───────────────────────────────────────────────────




  constructor(
    private api: APIService,
    private router: Router,
    private route: ActivatedRoute,
    private userService: UserService,
    private pageTitle: PageTitleService,
    private cdRef: ChangeDetectorRef,
    private statusLine: StatusLineService,
    private patternSvc: PatternAnalysisService,
    private synopsisSvc: SynopsisService,
    private searchExecSvc: SearchExecService,
    private fsService: FileSystemService,
  ) {
    this.synopsisMetadataCols = this.loadFromStorage<Document>(SYNOPSIS_COLS_KEY, DEFAULT_SYNOPSIS_COLS);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.pageTitle.set('Search');

    this.subs.push(
      this.searchExecSvc.stateChanged$.subscribe(() => {
        this.cdRef.markForCheck();
      })
    );

    this.subs.push(this.selSvc.changed$.subscribe(() => this.cdRef.markForCheck()));


    this.subs.push(this.userService.user.subscribe(async user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
            this.focusSvc.notationColor = sanitizeNotationColor(res.settings?.notationColor);
            this.focusSvc.clefDisplayMode = sanitizeClefDisplayMode(res.settings?.clefDisplayMode);
          }
        });
        await this.loadFromIndexedDB();
        this.selSvc.ensureIndex(this.user.token).then(() => this.cdRef.markForCheck());
        this.restoreStateFromUrl();
        // If the page was opened with a URL fragment like
        // `#pattern-group-7`, jump directly to that pattern. We do this
        // after restoring state so the patternGroups list is populated.
        this.honourPatternHashIfPresent();
      }
    }));
  }

  /** If `location.hash` looks like `#pattern-group-<id>`, navigate to that
   *  pattern in the list view. Idempotent — safe to call multiple times. */
  private honourPatternHashIfPresent(): void {
    if (typeof location === 'undefined') return;
    const m = /^#pattern-group-(\d+)$/.exec(location.hash);
    if (!m) return;
    const id = parseInt(m[1], 10);
    if (!isFinite(id)) return;
    if (!this.showPatternAnalysis) this.showPatternAnalysis = true;
    this.openPatternGroupById(id);
  }

  /**
   * Honour any pending "scroll to pattern N" request once Angular has
   * actually flushed the DOM for the page change. Doing this in a setTimeout
   * inside the click handler raced with the page swap; AfterViewChecked
   * guarantees the target card is mounted.
   */
  ngAfterViewChecked(): void {
    // Initialise the one-line synopsis virtualisation window once the segments
    // (and the scroll container) are available; refresh it when segments change.
    if (this.isStructuralMode && this.showSingleLineSynopsis) {
      const segs = this.flatSegments;
      const key = (this.showConsensusText ? 'C' : 'N') + (this.settings?.pdfSynopsisScale || 1.0);
      if (this._synWindowFor !== segs || this._synWindowKey !== key) {
        this._synWindowFor = segs;
        this._synWindowKey = key;
        this._synOffsetsFor = null; // column widths (hence offsets) may have changed
        // Defer to a fresh CD cycle — mutating bindings during ngAfterViewChecked
        // would raise ExpressionChangedAfterItHasBeenCheckedError.
        requestAnimationFrame(() => {
          const el = this.synScrollRef?.nativeElement;
          this.updateSynWindow(el ? el.scrollLeft : 0, el ? el.clientWidth : 1400);
          this.cdRef.markForCheck();
        });
      }
    }

    if (this.pendingPatternScrollId === null) return;
    const id = this.pendingPatternScrollId;
    const el = document.getElementById('pattern-group-' + id);
    if (!el) return; // not yet — try again on the next CD cycle
    this.pendingPatternScrollId = null;
    // Defer the actual scroll to the next animation frame so the
    // post-render layout has settled (otherwise scrollIntoView can
    // sometimes calculate offsets against the pre-mount layout on
    // Chromium).
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-pulse');
      setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
    });
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    if (this.patternSvc.patternWorker) {
      this.patternSvc.patternWorker.terminate();
      this.patternSvc.patternWorker = null;
    }
    const styleEl = document.getElementById('dynamic-hover-styles');
    if (styleEl) {
      styleEl.remove();
    }
  }

  matchText(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
    return this.searchExecSvc.matchText(text, query, mode, spellingTolerance, maxDistance);
  }

  async searchQuick() {
    this.updateUrl();
    this.applySearchScope();
    await this.searchExecSvc.searchQuick();
  }

  cancelSearch(): void {
    this.searchExecSvc.cancelSearch();
  }





  async searchMelody() {
    if (this.melodyPatternError) return;
    this.updateUrl();
    this.applySearchScope();
    await this.searchExecSvc.searchMelody();
  }

  /** Why the melody pattern cannot be searched (a letter the chosen kind does not know), or '' if it can. A silently
   *  ignored letter would search for something else than what was typed (contour "CDCDC" became "dd"). */
  get melodyPatternError(): string {
    const p = this.melodyPattern.trim();
    if (!p) return '';
    if (this.melodySearchType === 'contour') {
      return /[^udr.?\s]/i.test(p) ? 'Contour knows only u (up), d (down), r (repeat), . and .?. For note names choose Pitches.' : '';
    }
    if (this.melodySearchType === 'pitch') {
      return /[^a-h#♭♯0-9.?\s]/i.test(p) ? 'Pitches are the letters A–H, with # or b, and an octave number if wanted.' : '';
    }
    return '';
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'contour') return 'uudrud';
    return this.melodyWithOctave ? 'C4D4E4F4' : 'CDEFG';
  }

  // ── Sorting ───────────────────────────────────────────────────────────────



  // ── Post-search filtering ──────────────────────────────────────────────



  // ── Search pagination helper and getters ──────────────────────────────────


  async saveSearchStateToIndexedDB() {
    await this.searchExecSvc.saveSearchStateToIndexedDB(this.activeTab);
  }

  async loadFromIndexedDB() {
    await this.searchExecSvc.loadFromIndexedDB(
      (tab) => { this.activeTab = tab; }
    );
    this.cdRef.markForCheck();
  }


  trackQuick   = (_: number, r: QuickResult)  => r.id;
  trackMelody  = (_: number, r: MelodyResult) => r.document.id;

  // Quick Search Pagination
  get quickTotalPages(): number {
    return Math.max(1, Math.ceil(this.quickResults.length / this.quickPageSize));
  }
  get pagedQuickResults(): QuickResult[] {
    const start = (this.quickPage - 1) * this.quickPageSize;
    return this.quickResults.slice(start, start + this.quickPageSize);
  }

  /** One pager for both tabs (template `#pager`). */
  goToPage(kind: SearchTab, p: number): void {
    if (kind === 'quick') this.goToQuickPage(p); else this.goToMelodyPage(p);
  }

  goToQuickPage(p: number): void {
    if (this.quickResults.length === 0) return;
    this.quickPage = Math.max(1, Math.min(this.quickTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }



  // Melody Search Pagination
  get melodyTotalPages(): number {
    return Math.max(1, Math.ceil(this.melodyResults.length / this.melodyPageSize));
  }
  get pagedMelodyResults(): MelodyResult[] {
    const start = (this.melodyPage - 1) * this.melodyPageSize;
    return this.melodyResults.slice(start, start + this.melodyPageSize);
  }
  goToMelodyPage(p: number): void {
    if (this.melodyResults.length === 0) return;
    this.melodyPage = Math.max(1, Math.min(this.melodyTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }






  // ── CSV export ────────────────────────────────────────────────────────────




  // ── Navigation ────────────────────────────────────────────────────────────

  goToSource(id: string)                         { this.router.navigate(['/source', id]); }
  goToDocument(sourceId: string, docId: string)  { this.router.navigate(['/document', sourceId, docId]); }
  goToMelodyDocument(r: MelodyResult): void {
    const allNoteUUIDMap = new Map<string, { fill: string; stroke: string }>();
    if (r.occurrences && r.occurrences.length > 0) {
      for (const occ of r.occurrences) {
        if (occ.noteUUIDs && occ.noteUUIDs.length > 0) {
          for (const noteUuid of occ.noteUUIDs) {
            allNoteUUIDMap.set(noteUuid, { fill: occ.color, stroke: occ.border });
          }
        } else {
          for (const noteUuid of r.matchNoteSet) {
            allNoteUUIDMap.set(noteUuid, { fill: occ.color, stroke: occ.border });
          }
        }
      }
    } else {
      for (const noteUuid of r.matchNoteSet) {
        allNoteUUIDMap.set(noteUuid, { fill: '#ef4444', stroke: '#dc2626' });
      }
    }

    this.searchExecSvc.setDocumentHighlight({
      documentId: r.document.id,
      patternLabel: r.noteSequenceLabel || this.melodyPattern,
      occurrences: r.occurrences || [],
      allNoteUUIDMap,
    });

    this.goToDocument(r.document.quelle_id, r.document.id);
  }
  goToQuickResult(r: QuickResult) {
    if (r.kind === 'source') this.goToSource(r.id);
    else this.goToDocument(r.sourceId!, r.id);
  }

  // ── Column persistence (synopsis metadata) ────────────────────────────────

  private loadFromStorage<T>(key: string, defaults: ColDef<T>[]): ColDef<T>[] {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: ColDef<T>[] = JSON.parse(saved);
        return defaults.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      }
    } catch {}
    return defaults.map(c => ({ ...c }));
  }

  saveSynopsisCols() { safeStorage.setJson(SYNOPSIS_COLS_KEY, this.synopsisMetadataCols); }

  get visibleSynopsisCols() {
    return this.synopsisMetadataCols.filter(c => c.visible);
  }

  getDocFieldValue(doc: Document, key: string): string {
    const val = (doc as any)[key];
    if (val === undefined || val === null || val === '') return '—';
    return val;
  }

  // ── Recent searches ───────────────────────────────────────────────────────




  // ── Settings helpers ──────────────────────────────────────────────────────


  // ── Synoptic Comparison methods ───────────────────────────────────────────

  toggleDocSelection(doc: Document, event: Event) {
    event.stopPropagation();
    this.selSvc.toggle(doc);
    this.onSelectionChanged();
  }

  /** A document hit of the quick search: toggled by id; the real document comes from the workspace index. */
  toggleQuickResultSelection(r: QuickResult, event: Event) {
    event.stopPropagation();
    this.selection.toggle(r.id);
    this.onSelectionChanged();
  }

  isDocSelected(id: string): boolean {
    return this.selection.has(id);
  }

  /** Select or deselect every document of a source (a checkbox on a source row). */
  toggleSourceSelection(sourceId: string | undefined, event: Event) {
    event.stopPropagation();
    if (!sourceId) return;
    this.selSvc.toggleSource(sourceId);
    this.onSelectionChanged();
  }

  /** `none`, `some` or `all` of the documents of a source are selected (drives a tri-state checkbox). */
  sourceSelectState(sourceId: string | undefined): 'none' | 'some' | 'all' {
    return sourceId ? this.selSvc.sourceState(sourceId) : 'none';
  }

  clearDocSelection() {
    this.selSvc.clear();
    this.synopsisSvc.exitSynopsis();
    this.synopsisDocs = [];
    this.onSelectionChanged();
  }

  /** Opens the Analysis page with the documents behind the hits of this tab (and keeps them for its "hits" choice). */
  openInAnalysis(): void {
    const ids = this.currentHitDocIds();
    const what = this.activeTab === 'quick' ? `text search "${this.quickText}"` : `melody search "${this.melodyPattern}"`;
    this.selSvc.lastHits = { ids, label: `hits of the ${what}, ${ids.length} documents` };
    this.router.navigate(['/analysis']);
  }

  /** Called after every change of the selection by a checkbox or by the selection bar. */
  onSelectionChanged(): void {
    this.updateUrl();
    this.cdRef.markForCheck();
  }

  // ── The "all" of the selection bar: every hit of a tab, not only the page that is shown ──────────

  private hitMemo = new Map<string, { a: unknown; b: unknown; ids: string[] }>();

  private memoHits(name: string, a: unknown, b: unknown, build: () => string[]): string[] {
    const hit = this.hitMemo.get(name);
    if (hit && hit.a === a && hit.b === b) return hit.ids;
    const ids = uniqueIds(build());
    this.hitMemo.set(name, { a, b, ids });
    return ids;
  }

  /** Quick search: the documents among the hits plus all documents of the source hits. */
  get quickHitDocIds(): string[] {
    return this.memoHits('quick', this.quickResults, this.selSvc.indexRevision, () =>
      this.quickResults.flatMap(r => (r.kind === 'document' ? [r.id] : this.selSvc.docIdsOfSource(r.id))));
  }
  /** Melody tab: a document appears once per realisation in the results, here once in all. */
  get melodyHitDocIds(): string[] {
    return this.memoHits('melody', this.melodyResults, null, () => this.melodyResults.map(r => r.document.id));
  }

  /** The documents behind the hits of the active tab, without repeats. The single place that answers "which documents are these hits?". */
  currentHitDocIds(tab: SearchTab = this.activeTab): string[] {
    return tab === 'quick' ? this.quickHitDocIds : this.melodyHitDocIds;
  }


  selectTab(tab: SearchTab) {
    this.activeTab = tab;
    this.updateUrl();
    this.saveSearchStateToIndexedDB();
  }

  /** Ids of the documents a print would contain: the selection, or else all results of the current tab. */
  private printIds(): string[] {
    return this.selection.size ? this.selection.ids() : this.currentHitDocIds();
  }

  /** Number shown on the print button: the selection if there is one, else all results. */
  printCount(): number { return this.selection.size || this.currentHitDocIds().length; }

  /** Opens the print dialog for the selection — or, with none, for all results of the tab. */
  printResults(): void {
    const ids = this.printIds();
    if (!ids.length) return;
    if (ids.length > BIG_SELECTION && !confirm(`Print ${ids.length} documents as one PDF? This can take a long time.`)) return;
    this.pdfDialog.open({
      ids,
      docs: this.selectedDocs.length ? [...this.selectedDocs] : undefined,
      title: '',
    });
  }


  exitSynopsis() {
    this.showSynopsis = false;
    this.updateUrl();
  }

  updateUrl() {
    const queryParams: any = {
      tab: this.activeTab,
      // Up to SELECTION_URL_MAX ids go into the address (a shareable link); a larger selection stays in the session.
      compare: this.selection.size > 0 && this.selection.size <= SELECTION_URL_MAX ? this.selection.ids().join(',') : null,
      synopsis: this.showSynopsis ? 'true' : null,
      align: this.synopsisSvc.alignmentMode || null
    };

    Object.keys(queryParams).forEach(key => {
      if (queryParams[key] === null || queryParams[key] === undefined) {
        delete queryParams[key];
      }
    });

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true
    });
  }

  restoreStateFromUrl() {
    const params = this.route.snapshot.queryParams;
    if (!params) return;

    if (params.tab) this.activeTab = params.tab === 'melody' ? 'melody' : 'quick';
    if (params.align) this.synopsisSvc.alignmentMode = params.align;
    if (params.q) {
      this.quickText = params.q;
      this.searchQuick();
    }

    if (params.compare) {
      const docIds: string[] = uniqueIds(String(params.compare).split(','));
      // The workspace index holds every document, so the picks are restored without one request per id.
      this.selSvc.ensureIndex(this.user!.token).then(() => {
        this.selection.replace(docIds.filter(id => !!this.selSvc.docOf(id)));
        this.cdRef.markForCheck();
        if (params.synopsis === 'true' && this.selectedDocs.length >= 2) {
          this.enterSynopsis();
        }
      }).catch(err => console.error('Error restoring compared documents:', err));
    }
  }

  getElementWidth(item: AlignedLineElement): number {
    return this.synopsisSvc.getElementWidth(item);
  }

  // Column widths need canvas text measurement; memoise by column identity so the
  // many width bindings don't re-measure every cell on every change-detection tick.
  private _colWidthCache = new WeakMap<AlignedLineElement[], { key: string; w: number }>();
  getColumnWidth(col: AlignedLineElement[]): number {
    const key = (this.showConsensusText ? 'C' : 'N') + (this.settings?.pdfSynopsisScale || 1.0);
    const hit = this._colWidthCache.get(col);
    if (hit && hit.key === key) return hit.w;
    const w = this.synopsisSvc.getColumnWidth(col, this.settings);
    this._colWidthCache.set(col, { key, w });
    return w;
  }

  hasParatext(items: any[]): boolean {
    return this.synopsisSvc.hasParatext(items);
  }

  getParatextColumnWidth(node: AlignedNode): number {
    return this.synopsisSvc.getParatextColumnWidth(node, this.settings);
  }

  getPrintDate(): string {
    return this.synopsisSvc.getPrintDate();
  }

  getProjectTitle(): string {
    return this.synopsisSvc.getProjectTitle(this.settings);
  }

  hasLineElements(node: AlignedNode, docIdx: number): boolean {
    return this.synopsisSvc.hasLineElements(node, docIdx);
  }

  /** How many of the selected witnesses actually contain this aligned section. */
  getMatchedCount(node: AlignedNode): number {
    const total = this.synopsisDocs.length;
    let count = 0;
    for (let i = 0; i < total; i++) {
      const hasContainer = !!(node.containers && node.containers[i]);
      const hasItem = !!(node.items && node.items[i]);
      const hasLeaf = !!node.alignedLineElements && this.synopsisSvc.hasLineElements(node, i);
      if (hasContainer || hasItem || hasLeaf) count++;
    }
    return count;
  }

  private _consensusCache = new WeakMap<AlignedLineElement[], string[]>();
  getConsensusSyllableTexts(col: AlignedLineElement[]): string[] {
    let c = this._consensusCache.get(col);
    if (c === undefined) {
      c = this.synopsisSvc.getConsensusSyllableTexts(col);
      this._consensusCache.set(col, c);
    }
    return c;
  }

  onSingleLineToggle() {
    this.synopsisSvc.onSingleLineToggle();
  }

  async exportSynopsisPDF() {
    if (this.synopsisPdfExporting) return;
    this.synopsisPdfExporting = true;
    // The one-line view is virtualised, so temporarily render EVERY segment
    // (the PDF reads the DOM) — the window is restored afterwards.
    this.synVisibleSegments = this.flatSegments;
    this.synLeadWidth = 0;
    this.synTailWidth = 0;
    this._synWindowFor = this.flatSegments; // keep ngAfterViewChecked from re-windowing mid-export
    this.cdRef.markForCheck();
    // Yield so the spinner paints and all segments render before the PDF build.
    await new Promise(resolve => setTimeout(resolve, 60));
    try {
      await this.synopsisSvc.exportSynopsisPDF(
        this.synopsisDocs,
        this.settings,
        this.visibleSynopsisCols
      );
    } finally {
      this.synopsisPdfExporting = false;
      this._synWindowFor = null; // force the virtualisation window to re-init
      this.cdRef.markForCheck();
    }
  }

  onAlignmentModeChange(mode: 'signature' | 'structure' | 'sequential' | 'melody' | 'text') {
    this.synopsisSvc.alignmentMode = mode;
    this.enterSynopsis();
  }

  get segmentAlignBy(): 'melody' | 'text' { return this.synopsisSvc.segmentAlignBy; }
  set segmentAlignBy(v: 'melody' | 'text') { this.synopsisSvc.segmentAlignBy = v; }

  /** Change the within-segment alignment basis (structure/sequential modes) and re-align. */
  onSegmentAlignByChange(mode: 'melody' | 'text') {
    this.synopsisSvc.segmentAlignBy = mode;
    this.enterSynopsis();
  }

  enterSynopsis() {
    if (!this.user || this.selectedDocs.length < 2) return;
    let witnesses = this.selectedDocs;
    if (witnesses.length > SYNOPSIS_MAX_WITNESSES) {
      const ok = confirm(`${witnesses.length} documents are selected. A synopsis of more than ${SYNOPSIS_MAX_WITNESSES} witnesses is slow and hard to read.\n\nCompare the first ${SYNOPSIS_MAX_WITNESSES} selected documents?`);
      if (!ok) return;
      witnesses = witnesses.slice(0, SYNOPSIS_MAX_WITNESSES);
    }
    this.synopsisDocs = witnesses;
    this.synopsisLoading = true;
    this.showSynopsis = false;
    this.synopsisSvc.enterSynopsis(
      witnesses,
      (show) => { this.showSynopsis = show; this.cdRef.markForCheck(); },
      (loading) => { this.synopsisLoading = loading; this.cdRef.markForCheck(); },
      () => { this.updateUrl(); this.cdRef.markForCheck(); }
    );
  }

  // ── Selection analysis dashboard ──────────────────────────────────────────



  // ── Pattern Analysis Methods ──────────────────────────────────────────────

  get patternTargetDocsCount(): number { return this.currentHitDocIds().length; }

  // Expanded pattern group IDs to paginate/collapse occurrences inside cards
  expandedGroupIds = new Set<number>();

  toggleGroupExpand(groupId: number) {
    if (this.expandedGroupIds.has(groupId)) {
      this.expandedGroupIds.delete(groupId);
    } else {
      this.expandedGroupIds.add(groupId);
    }
    this.cdRef.markForCheck();
  }

  visibleOccurrences(g: PatternGroup): PatternOccurrence[] {
    if (this.expandedGroupIds.has(g.id)) {
      return g.occurrences;
    }
    return g.occurrences.slice(0, 3);
  }

  /** The documents the pattern finder works on: the hits of the active tab (with the documents of source hits). */
  async getCurrentSearchDocIds(): Promise<string[]> { return this.currentHitDocIds(); }

  async openPatternAnalysis() {
    this.showPatternAnalysis = true;
    this.patternSearching = false;
    this.patternCancelled = false;
    this.patternPage = 1;
    this.expandedGroupIds.clear();

    const currentDocIds = await this.getCurrentSearchDocIds();
    const analyzedDocIds = Array.from(this.patternDocTotalNotes.keys());

    currentDocIds.sort();
    analyzedDocIds.sort();

    const isSame = currentDocIds.length === analyzedDocIds.length &&
                   currentDocIds.every((id, idx) => id === analyzedDocIds[idx]);

    if (!isSame) {
      this.patternGroups = [];
      this.patternTimelineDocs = [];
      this.patternDocTotalNotes.clear();
      this.detectedDuplicates = [];
      this.patternProgress = { phase: '', current: 0, total: 0, percent: 0 };
      this.updatePatternCache();
    } else {
      this.updatePatternCache();
    }
    
    this.cdRef.markForCheck();
  }

  exitPatternAnalysis() {
    this.showPatternAnalysis = false;
    this.patternCancelled = true;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  cancelPatternGrouping() {
    this.patternCancelled = true;
    this.patternSearching = false;
    this.patternProgress.phase = 'Cancelled';
    if (this.patternWorker) {
      this.patternWorker.terminate();
      this.patternWorker = null;
    }
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  // ── Pattern-list pagination ─────────────────────────────────────────────

  /** Total number of pages for the current pattern result set. */
  get patternTotalPages(): number {
    return Math.max(1, Math.ceil(this.patternGroups.length / this.patternPageSize));
  }

  /** The slice of pattern groups visible on the current page. The template
   *  iterates this rather than slicing inline so that page changes update
   *  cleanly with a single recompute. */
  get pagedPatternGroups(): PatternGroup[] {
    const start = (this.patternPage - 1) * this.patternPageSize;
    return this.patternGroups.slice(start, start + this.patternPageSize);
  }

  /** 1-based index of the first pattern shown on the current page. */
  get patternPageFromIndex(): number {
    if (this.patternGroups.length === 0) return 0;
    return (this.patternPage - 1) * this.patternPageSize + 1;
  }

  /** 1-based index of the last pattern shown on the current page. */
  get patternPageToIndex(): number {
    return Math.min(this.patternGroups.length, this.patternPage * this.patternPageSize);
  }

  /**
   * A compact list of page numbers to render in the pager. Always shows
   * the first and last page; in between we surround the current page with
   * a small window. Gaps are represented by `-1` so the template can
   * render an ellipsis. Yields something like
   *   1 … 4 5 [6] 7 8 … 42
   * for total=42, current=6.
   */
  get patternPagerWindow(): number[] {
    const total = this.patternTotalPages;
    const cur = this.patternPage;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const out: number[] = [1];
    const winStart = Math.max(2, cur - 2);
    const winEnd   = Math.min(total - 1, cur + 2);
    if (winStart > 2) out.push(-1);
    for (let p = winStart; p <= winEnd; p++) out.push(p);
    if (winEnd < total - 1) out.push(-1);
    out.push(total);
    return out;
  }

  /** Jump to a specific page; clamps to valid range. */
  goToPatternPage(p: number): void {
    if (this.patternGroups.length === 0) return;
    const clamped = Math.max(1, Math.min(this.patternTotalPages, p));
    if (clamped === this.patternPage) return;
    this.patternPage = clamped;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }
  goToFirstPatternPage(): void { this.goToPatternPage(1); }
  goToLastPatternPage():  void { this.goToPatternPage(this.patternTotalPages); }
  goToPrevPatternPage():  void { this.goToPatternPage(this.patternPage - 1); }
  goToNextPatternPage():  void { this.goToPatternPage(this.patternPage + 1); }

  static computePatternGroups = computePatternGroups;

  updatePatternCache() {
    this.patternSvc.updatePatternCache();
  }

  setPatternViewMode(mode: 'list' | 'overview') {
    this.patternViewMode = mode;
    this.updatePatternCache();
    this.cdRef.markForCheck();
  }

  getPatternColor(groupId: number): string {
    const colors = [
      '#3b82f6', // blue-500
      '#10b981', // emerald-500
      '#f59e0b', // amber-500
      '#8b5cf6', // violet-500
      '#ec4899', // pink-500
      '#06b6d4', // cyan-500
      '#ef4444', // red-500
      '#84cc16', // lime-500
      '#14b8a6', // teal-500
      '#f97316', // orange-500
      '#a855f7', // purple-500
      '#6366f1'  // indigo-500
    ];
    return colors[(groupId - 1) % colors.length];
  }

  getPatternGroupKey(groupId: number): string {
    const group = this.patternGroups.find(g => g.id === groupId);
    return group ? group.representativeKey : '';
  }

  updateHoverStyles(groupId: number | null) {
    let styleEl = document.getElementById('dynamic-hover-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamic-hover-styles';
      document.head.appendChild(styleEl);
    }
    if (groupId === null) {
      styleEl.innerHTML = '';
    } else {
      styleEl.innerHTML = `
        .pattern-marker {
          fill-opacity: 0.15 !important;
        }
        .group-marker-${groupId} {
          fill-opacity: 1.0 !important;
          stroke: #000000 !important;
          stroke-width: 1px !important;
        }
      `;
    }
  }

  onPatternFamilyHover(groupId: number | null) {
    this.hoveredGroupId = groupId;
    this.updateHoverStyles(groupId);
  }

  showTooltip(event: MouseEvent, occ: any, doc: any, groupId: number, repKey: string) {
    this.hoveredGroupId = groupId;
    this.updateHoverStyles(groupId);
    
    // Get matching syllables text
    const sylText = occ.matchingSyllables.map((s: any) => s.text).join(' ');
    
    // Calculate page coordinates
    this.hoveredOccurrence = {
      docTitle: doc.doc.textinitium || doc.doc.dokumenten_id,
      sourceSigle: doc.sourceSigle,
      groupId,
      repKey,
      start: occ.startNoteIdx,
      end: occ.endNoteIdx,
      syllables: sylText,
      pitches: occ.notes.map((n: any) => n.base + (n.octave !== undefined ? n.octave : '')).join(' - ')
    };
    this.updateTooltipPosition(event);
  }

  updateTooltipPosition(event: MouseEvent) {
    this.tooltipX = event.clientX + 15;
    this.tooltipY = event.clientY + 15;
  }

  hideTooltip() {
    this.hoveredGroupId = null;
    this.updateHoverStyles(null);
    this.hoveredOccurrence = null;
  }

  private hexToRgb(hex: string): { r: number, g: number, b: number } {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
  }

  async exportPatternAnalysisPDF() {
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 40;
      let y = margin;

      // 1. Title
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(37, 99, 235);
      doc.text("Melodic Pattern Analysis Report", margin, y);
      y += 24;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin, y);
      y += 20;

      // 2. Settings & Stats Table
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Analysis Parameters & Statistics", margin, y);
      y += 10;

      const strictnessText = this.patternStrictness === 'exact' ? 'Exact Match' : 'Fuzzy Match (edit distance <= 1)';
      const mergeText = this.patternMergeEnabled ? `Enabled (min overlap ${this.patternMinMergeOverlap})` : 'Disabled';
      const dedupText = this.patternDeduplicateEnabled ? 'Enabled' : 'Disabled';
      
      const statsRows = [
        ['Parameter', 'Value', 'Metric', 'Value'],
        ['Pattern Type', this.patternType.toUpperCase(), 'Total Documents', this.patternTimelineDocs.length.toString()],
        ['Pattern Length', this.patternLength.toString(), 'Patterns Identified', this.patternGroups.length.toString()],
        ['Match Strictness', strictnessText, 'Total Occurrences', this.patternGroups.reduce((acc, g) => acc + g.occurrences.length, 0).toString()],
        ['Merge Overlaps', mergeText, 'Excluded Duplicates', this.detectedDuplicates.length.toString()],
        ['Deduplication', dedupText, '', '']
      ];

      autoTable(doc, {
        startY: y,
        head: [statsRows[0]],
        body: statsRows.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        margin: { left: margin, right: margin },
        styles: { fontSize: 8 },
        didDrawPage: (data) => {
          y = data.cursor ? data.cursor.y : y;
        }
      });
      y += 35;

      // 3. Timeline Overview
      if (this.patternTimelineDocs.length > 0) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text("Timeline Overview", margin, y);
        y += 10;

        const timelineBody = this.patternTimelineDocs.map((docRow) => {
          const title = docRow.doc.textinitium || docRow.doc.dokumenten_id || 'Untitled';
          const genre = docRow.doc.gattung1 ? ` (${docRow.doc.gattung1})` : '';
          return [`${docRow.sourceSigle} - ${title}${genre}`, ''];
        });

        autoTable(doc, {
          startY: y,
          head: [['Document Metadata', 'Pattern Timeline']],
          body: timelineBody,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235] },
          margin: { left: margin, right: margin },
          styles: { fontSize: 8, valign: 'middle' },
          columnStyles: {
            0: { cellWidth: 220 },
            1: { cellWidth: 'auto' }
          },
          didDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 1) {
              const docRow = this.patternTimelineDocs[data.row.index];
              const cell = data.cell;
              
              // Draw light background line
              doc.setDrawColor(233, 236, 239);
              doc.setLineWidth(1.5);
              const lineY = cell.y + cell.height / 2;
              doc.line(cell.x + 5, lineY, cell.x + cell.width - 5, lineY);

              // Draw each pattern occurrence
              for (const occ of docRow.occurrences) {
                const startX = cell.x + 5 + (occ.startPct / 100) * (cell.width - 10);
                const width = (occ.widthPct / 100) * (cell.width - 10);
                const colorRgb = this.hexToRgb(occ.color);
                doc.setFillColor(colorRgb.r, colorRgb.g, colorRgb.b);
                doc.rect(startX, cell.y + 4, Math.max(width, 2), cell.height - 8, 'F');
              }
            }
          },
          didDrawPage: (data) => {
            y = data.cursor ? data.cursor.y : y;
          }
        });
        y += 35;
      }

      // Add a page break for the detailed list
      doc.addPage();
      y = margin;

      // 4. Detailed Patterns List (limit to first 100 patterns to avoid huge PDFs)
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("Detailed Pattern List", margin, y);
      y += 10;

      const detailedBody = this.patternGroups.slice(0, 100).map((g) => {
        const occs = g.occurrences.map((occ) => {
          const syllablesText = occ.matchingSyllables
            ? occ.matchingSyllables.map((s: any) => s.text || '').join(' ').trim()
            : '';
          const cleanSylText = syllablesText.replace(/\s+/g, ' ');
          return `• [${occ.sourceSigle}] ${occ.doc.textinitium || 'Untitled'} (notes ${occ.startNoteIdx}-${occ.endNoteIdx}): "${cleanSylText}"`;
        }).join('\n');

        return [
          `Pattern #${g.id}\n(Freq: ${g.occurrences.length})`,
          `Key: ${g.representativeKey}\n\nPitches: ${g.representativePitches}${g.isCompound ? '\n[Compound]' : ''}`,
          occs
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [['Pattern ID', 'Sequence Details', 'Occurrences List']],
        body: detailedBody,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42] },
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 6, valign: 'top' },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 160 },
          2: { cellWidth: 'auto' }
        },
        didDrawPage: (data) => {
          y = data.cursor ? data.cursor.y : y;
        }
      });

      const filename = `pattern-analysis-report-${this.patternType}-${this.patternLength}.pdf`;
      doc.save(filename);
      this.statusLine.success('PDF report exported successfully!');
    } catch (e) {
      console.error('Failed to export PDF:', e);
      this.statusLine.error('Failed to export PDF report');
    }
  }

  async saveCurrentPatternSession() {
    if (!this.newSessionName.trim()) {
      this.statusLine.error('Please enter a session name');
      return;
    }
    await this.patternSvc.saveCurrentPatternSession(this.newSessionName);
    this.newSessionName = '';
    this.showSaveSessionForm = false;
    this.cdRef.markForCheck();
  }

  async loadPatternSession(id: string) {
    await this.patternSvc.loadPatternSession(id);
    this.showSavedSessionsPopover = false;
    this.cdRef.markForCheck();
  }

  async deletePatternSession(id: string, event: MouseEvent) {
    event.stopPropagation();
    await this.patternSvc.deletePatternSession(id);
    this.cdRef.markForCheck();
  }

  async exportPatternSessionJSON() {
    try {
      const sessionData = {
        patternGroups: this.patternSvc.patternGroups,
        patternLength: this.patternSvc.patternLength,
        patternType: this.patternSvc.patternType,
        patternStrictness: this.patternSvc.patternStrictness,
        patternViewMode: this.patternSvc.patternViewMode,
        patternTimelineDocs: this.patternSvc.patternTimelineDocs,
        patternDocTotalNotes: Array.from(this.patternSvc.patternDocTotalNotes.entries()),
        patternMergeEnabled: this.patternSvc.patternMergeEnabled,
        patternMinMergeOverlap: this.patternSvc.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternSvc.patternDeduplicateEnabled,
        detectedDuplicates: this.patternSvc.detectedDuplicates,
        patternPage: this.patternSvc.patternPage
      };

      const filename = `pattern-analysis-${this.patternSvc.patternType}-${this.patternSvc.patternLength}.json`;
      const res = await this.fsService.saveFile(JSON.stringify(sessionData, null, 2), {
        suggestedName: filename,
        types: [{
          description: 'JSON File',
          accept: { 'application/json': ['.json'] }
        }],
        fallbackMimeType: 'application/json'
      });
      if (res.saved) {
        this.statusLine.success('JSON file exported');
      }
    } catch (e) {
      console.error('Failed to export JSON:', e);
      this.statusLine.error('Failed to export JSON file');
    }
  }

  async triggerImportJSON() {
    if (this.fsService.isSupported()) {
      const res = await this.fsService.openFile({
        types: [{
          description: 'Pattern Analysis JSON',
          accept: { 'application/json': ['.json'] }
        }]
      });
      if (res && res.file) {
        this.processPatternSessionFile(res.file);
        return;
      }
    }
    const input = document.getElementById('patternImportJsonInput');
    if (input) {
      input.click();
    }
  }

  importPatternSessionJSON(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.processPatternSessionFile(file);
    event.target.value = '';
  }

  private processPatternSessionFile(file: File) {

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.patternGroups)) {
          this.statusLine.error('Invalid pattern analysis session file');
          return;
        }

        this.patternSvc.patternGroups = data.patternGroups;
        this.patternSvc.patternLength = data.patternLength ?? 8;
        this.patternSvc.patternType = data.patternType ?? 'interval';
        this.patternSvc.patternStrictness = data.patternStrictness ?? 'exact';
        this.patternSvc.patternViewMode = data.patternViewMode ?? 'overview';
        this.patternSvc.patternTimelineDocs = data.patternTimelineDocs || [];
        this.patternSvc.patternMergeEnabled = !!data.patternMergeEnabled;
        this.patternSvc.patternMinMergeOverlap = data.patternMinMergeOverlap ?? 1;
        this.patternSvc.patternDeduplicateEnabled = data.patternDeduplicateEnabled !== false;
        this.patternSvc.detectedDuplicates = data.detectedDuplicates || [];
        this.patternSvc.patternPage = data.patternPage || 1;
        
        if (data.patternDocTotalNotes) {
          this.patternSvc.patternDocTotalNotes = new Map<string, number>(data.patternDocTotalNotes);
        } else {
          this.patternSvc.patternDocTotalNotes = new Map<string, number>();
        }

        this.patternSvc.updatePatternCache();
        this.showSavedSessionsPopover = false;
        this.statusLine.success('Session imported successfully');
        this.cdRef.markForCheck();
      } catch (err) {
        console.error('Failed to parse JSON:', err);
        this.statusLine.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
  }





  async savePatternStateToIndexedDB() {
    await this.patternSvc.savePatternStateToIndexedDB();
  }



  /**
   * Entry point from the overview timeline. Switches to the list view,
   * flips the page to the one that contains this pattern, expands the
   * card, and then scrolls the user to the matching anchor with a brief
   * pulse highlight so they don't lose context after the jump.
   */
  selectPatternGroupFromTimeline(groupId: number) {
    this.openPatternGroupById(groupId);
  }

  /**
   * Centralised "jump to a pattern by id" helper. Used by the timeline
   * click handler AND by URL-hash deep-linking (`#pattern-group-7`) so the
   * navigation behaviour stays consistent across both entry points.
   */
  openPatternGroupById(groupId: number): void {
    const idx = this.patternGroups.findIndex(g => g.id === groupId);
    if (idx < 0) return;

    this.patternViewMode = 'list';
    this.expandedGroupIds.add(groupId);
    this.patternPage = Math.floor(idx / this.patternPageSize) + 1;
    // The actual scroll happens in ngAfterViewChecked once the new page's
    // cards are in the DOM. Setting only the id avoids racing with the
    // page change above — *Timer would target a stale layout otherwise.
    this.pendingPatternScrollId = groupId;
    this.updatePatternCache();

    // Reflect the jump in the URL fragment so the user can bookmark or
    // share the specific pattern.
    try {
      if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(null, '', '#pattern-group-' + groupId);
      }
    } catch { /* ignore — file:// origin etc. */ }

    this.cdRef.markForCheck();
  }

  /** Which documents the formula analysis reads: the hits of the active tab, the selection, or every document. */
  patternScope: 'hits' | 'selection' | 'all' = 'hits';

  /** Number of documents in the chosen scope (the hits count each document once). */
  get patternScopeCount(): number {
    switch (this.patternScope) {
      case 'selection': return this.selection.size;
      case 'all': return this.selSvc.allDocs().length;
      default: return this.currentHitDocIds().length;
    }
  }

  async runPatternGrouping() {
    let scopeIds: string[];
    if (this.patternScope === 'selection') scopeIds = this.selection.ids();
    else if (this.patternScope === 'all') {
      if (this.user) await this.selSvc.ensureIndex(this.user.token);
      scopeIds = this.selSvc.allDocs().map(d => d.id);
    } else scopeIds = this.currentHitDocIds();
    await this.patternSvc.runPatternGrouping(scopeIds);
  }

  enableDeduplicationAndReRun() {
    this.patternSvc.patternDeduplicateEnabled = true;
    this.runPatternGrouping();
  }

  clearDetectedDuplicates() {
    this.patternSvc.detectedDuplicates = [];
    this.patternSvc.updatePatternCache();
    this.cdRef.markForCheck();
  }
}
