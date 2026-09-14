import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { APIService, Source, Document } from '../api.service';
import { UserService, User } from '../user.service';
import { NavigationService } from '../notationsdokumentation/navigation.service';
import { analyzeDocument, AnalyzedPattern } from '../transcription-analyzer-core';
import { ActivatedRoute } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import * as localforage from 'localforage';

export interface Occurence {
  patternId: string;
  sourceId: string;
  documentId: string;
  documentTitle: string;
  folio: string;
  line: string;
  syllable: string;
  uuid: string;
}

export interface PatternGroup {
  basePattern: string;
  totalCount: number;
  occurrences: Occurence[];
  bySource: { [sourceId: string]: Occurence[] };
}

export interface TokenGroup {
  patternId: string;
  count: number;
  occurrences: Occurence[];
  sourcesCount: { [sigle: string]: number };
}

@Component({
    selector: 'app-stats',
    templateUrl: './stats.component.html',
    styleUrls: ['./stats.component.css'],
    standalone: false
})
export class StatsComponent implements OnInit, OnDestroy {
  user: User | null = null;
  sources: Source[] = [];
  documents: Document[] = [];
  
  // Loading state
  loading = false;
  loadingCache = false;
  statsComputed = false;
  lastComputedTime: string | null = null;
  loadingProgress = {
    current: 0,
    total: 0,
    message: ''
  };

  // Raw patterns analyzed
  allAnalyzed: AnalyzedPattern[] = [];

  // Grouped stats
  basePatterns: PatternGroup[] = [];
  displayedPatterns: PatternGroup[] = [];
  filteredSources: Source[] = [];
  
  // Lookups
  sourceNeumeCount: { [sourceId: string]: number } = {};
  sourceSigleLookup: { [id: string]: string } = {};

  // Filters
  minFrequency = 1;
  maxFrequencyLimit = 100;
  patternSearchText = '';
  sourceSearchText = '';

  // RxJS Filter Debouncing
  private filterSubject = new Subject<void>();
  private filterSub?: Subscription;
  private subs: Subscription[] = [];

  // Pagination State
  patternPageSize = 10;
  patternPageIndex = 0;
  
  sourcePageSize = 10;
  sourcePageIndex = 0;

  cellOccurPageSize = 10;
  cellOccurPageIndex = 0;

  tokenOccurPageSize = 10;
  tokenOccurPageIndex = 0;

  // Detail Modal State
  selectedCell: {
    source: Source;
    patternGroup: PatternGroup;
    occurrences: Occurence[];
  } | null = null;

  // Type Column Detail Modal State
  selectedPatternType: PatternGroup | null = null;
  selectedTypeTokens: TokenGroup[] = [];
  activeTokenId: string | null = null;

  private isDestroyed = false;

  constructor(
    private api: APIService,
    private userService: UserService,
    private navService: NavigationService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Set up debounced filtering (300ms)
    this.filterSub = this.filterSubject.pipe(
      debounceTime(300)
    ).subscribe(() => {
      this.applyFilters();
    });

    this.userService.user.subscribe(user => {
      this.user = user;
      if (this.user) {
        const hasQueryParams = !!this.route.snapshot.queryParams['pattern'];
        this.loadCachedStats(hasQueryParams);
      }
    });

    // Subscribe to query parameters to handle navigation from the document editor
    this.subs.push(this.route.queryParams.subscribe(params => {
      if (params['pattern']) {
        this.patternSearchText = params['pattern'];
        this.minFrequency = 1; // reset min frequency so the pattern is visible
        this.applyFilters();
      }
      if (params['showVariants'] === 'true' && params['pattern']) {
        const base = params['pattern'];
        // Poll/wait until stats loading is done and patterns list is populated
        const checkInterval = setInterval(() => {
          if (this.isDestroyed) {
            clearInterval(checkInterval);
            return;
          }
          if (!this.loading && this.basePatterns.length > 0) {
            clearInterval(checkInterval);
            const pg = this.basePatterns.find(p => p.basePattern === base);
            if (pg) {
              this.onTypeHeaderClick(pg);
            }
          }
        }, 100);
      }
    }));
  }

  /** localforage (IndexedDB) key for the cached pattern-stats result.
   *  Was previously written to localStorage, but `basePatterns` (every
   *  occurrence, with folio/line/syllable/uuid) routinely blew the ~5MB
   *  localStorage quota, the write threw QuotaExceededError, and nothing
   *  ever persisted — so a refresh always had to recompute. IndexedDB has
   *  a far larger quota and stores objects natively (no JSON.stringify). */
  private static readonly STATS_CACHE_KEY = 'monodi_cached_pattern_stats';

  async loadCachedStats(autoComputeIfMissing = false): Promise<void> {
    this.loadingCache = true;
    this.cdr.detectChanges();
    let parsed: any = null;
    try {
      // Preferred: IndexedDB (current location).
      parsed = await localforage.getItem<any>(StatsComponent.STATS_CACHE_KEY);

      // One-time fallback: migrate any legacy localStorage entry that did
      // manage to write (small corpora). Then drop it so we don't read it
      // again — IndexedDB is the source of truth from now on.
      if (!parsed) {
        const legacy = localStorage.getItem('monodi_cached_pattern_stats');
        if (legacy) {
          try { parsed = JSON.parse(legacy); } catch { parsed = null; }
          localStorage.removeItem('monodi_cached_pattern_stats');
        }
      }
    } catch (e) {
      console.warn('Failed to read cached pattern stats:', e);
      parsed = null;
    } finally {
      this.loadingCache = false;
      if (!this.isDestroyed) {
        this.cdr.detectChanges();
      }
    }

    if (this.isDestroyed) return;
    if (parsed) {
      try {
        this.sources = parsed.sources || [];
        this.documents = parsed.documents || [];
        this.basePatterns = parsed.basePatterns || [];
        this.sourceNeumeCount = parsed.sourceNeumeCount || {};
        this.sourceSigleLookup = parsed.sourceSigleLookup || {};
        this.maxFrequencyLimit = parsed.maxFrequencyLimit || 100;
        this.lastComputedTime = parsed.timestamp;
        this.statsComputed = true;
        this.applyFilters();
      } catch (e) {
        if (this.isDestroyed) return;
        this.statsComputed = false;
        if (autoComputeIfMissing) {
          this.loadStats();
        }
      }
    } else {
      if (this.isDestroyed) return;
      this.statsComputed = false;
      if (autoComputeIfMissing) {
        this.loadStats();
      }
    }
    if (this.isDestroyed) return;
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    if (this.filterSub) {
      this.filterSub.unsubscribe();
    }
    for (const s of this.subs) {
      s.unsubscribe();
    }
  }

  onFilterChange() {
    this.filterSubject.next();
  }

  resetFilters() {
    this.sourceSearchText = '';
    this.patternSearchText = '';
    this.minFrequency = 1;
    // Reset immediately for better responsiveness
    this.applyFilters();
  }

  async loadStats() {
    const user = this.user;
    if (!user) return;
    this.loading = true;
    this.loadingProgress.current = 0;
    this.loadingProgress.total = 0;
    this.loadingProgress.message = 'Fetching manuscripts...';
    this.cdr.detectChanges();

    try {
      // 1. List all sources
      const sourceRes = await this.api.listSources(user.token).toPromise();
      if (this.isDestroyed) return;
      if (!sourceRes || sourceRes.kind !== 'SourcesRetrieved') {
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }
      this.sources = sourceRes.sources;

      // Populate source sigle lookup map
      this.sourceSigleLookup = {};
      for (const s of this.sources) {
        if (s.id) {
          this.sourceSigleLookup[s.id] = s.quellensigle || s.id;
        }
      }

      this.loadingProgress.message = 'Loading document inventory...';
      this.cdr.detectChanges();

      // 2. List all documents
      const docRes = await this.api.listDocuments(user.token).toPromise();
      if (this.isDestroyed) return;
      if (!docRes || docRes.kind !== 'DocumentsRetrieved') {
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }
      this.documents = docRes.documents;

      if (this.documents.length === 0) {
        this.loading = false;
        await this.processStats([]);
        return;
      }

      // 3. Load notes in chunks
      this.loadingProgress.total = this.documents.length;
      this.loadingProgress.message = `Loading transcription data (0/${this.documents.length})...`;
      this.cdr.detectChanges();

      const docsData: { root: any; doc: Document }[] = [];
      const BATCH_SIZE = 50;

      for (let i = 0; i < this.documents.length; i += BATCH_SIZE) {
        if (this.isDestroyed) return;
        const chunk = this.documents.slice(i, i + BATCH_SIZE);
        const promises = chunk.map(async (doc) => {
          try {
            const noteRes = await this.api.getDocumentNotes(user.token, doc.id).toPromise();
            if (this.isDestroyed) return;
            if (noteRes && noteRes.kind === 'NotesRetrieved') {
              docsData.push({ root: noteRes.data, doc });
            }
          } catch (e) {
            console.warn(`Failed to load notes for document ${doc.id}:`, e);
          }
        });

        await Promise.all(promises);
        if (this.isDestroyed) return;

        this.loadingProgress.current = Math.min(i + BATCH_SIZE, this.documents.length);
        this.loadingProgress.message = `Loading transcription data (${this.loadingProgress.current}/${this.documents.length})...`;
        this.cdr.detectChanges();
        // Yield to browser event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (this.isDestroyed) return;
      this.loadingProgress.message = 'Analyzing notation patterns...';
      this.cdr.detectChanges();
      
      // Let UI render the state
      await new Promise(resolve => setTimeout(resolve, 50));
      if (this.isDestroyed) return;
      
      await this.processStats(docsData);

    } catch (e) {
      console.error('Error during stats loading:', e);
      if (!this.isDestroyed) {
        this.loading = false;
        this.cdr.detectChanges();
      }
    }
  }

  async processStats(docsData: { root: any; doc: Document }[]) {
    const analyzed: AnalyzedPattern[] = [];
    const docLookup = new Map<string, Document>();
    for (const d of this.documents) {
      docLookup.set(d.id, d);
    }

    // Run the analysis in chunks of 20 documents
    const ANALYZE_BATCH = 20;
    for (let i = 0; i < docsData.length; i += ANALYZE_BATCH) {
      if (this.isDestroyed) return;
      const chunk = docsData.slice(i, i + ANALYZE_BATCH);
      for (const entry of chunk) {
        const pats = analyzeDocument(entry.root, entry.doc.quelle_id || 'Unknown', entry.doc.id);
        analyzed.push(...pats);
      }
      this.loadingProgress.message = `Analyzing patterns (${Math.min(i + ANALYZE_BATCH, docsData.length)}/${docsData.length})...`;
      this.cdr.detectChanges();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    if (this.isDestroyed) return;
    this.allAnalyzed = analyzed;

    // Grouping by base pattern in chunks of 10000 patterns
    const patternMap = new Map<string, PatternGroup>();
    const sourceCounts: { [sourceId: string]: number } = {};

    const GROUP_BATCH = 10000;
    for (let i = 0; i < analyzed.length; i += GROUP_BATCH) {
      if (this.isDestroyed) return;
      const chunk = analyzed.slice(i, i + GROUP_BATCH);
      for (const res of chunk) {
        // Clean special suffix signs (Q, O, S, L, A, D) to get the base pattern
        const base = res.patternId.replace(/[QOSLAD]/g, '');
        if (!base) continue;

        if (!patternMap.has(base)) {
          patternMap.set(base, {
            basePattern: base,
            totalCount: 0,
            occurrences: [],
            bySource: {}
          });
        }

        const pg = patternMap.get(base)!;
        const doc = docLookup.get(res.documentId);
        const docTitle = doc ? (doc.textinitium || doc.dokumenten_id || 'Unknown Piece') : 'Unknown Piece';

        const occ: Occurence = {
          patternId: res.patternId,
          sourceId: res.sourceId,
          documentId: res.documentId,
          documentTitle: docTitle,
          folio: res.folio,
          line: res.line,
          syllable: res.syllable,
          uuid: res.uuid
        };

        pg.totalCount++;
        pg.occurrences.push(occ);

        if (!pg.bySource[res.sourceId]) {
          pg.bySource[res.sourceId] = [];
        }
        pg.bySource[res.sourceId].push(occ);

        // Track total neumes per manuscript
        sourceCounts[res.sourceId] = (sourceCounts[res.sourceId] || 0) + 1;
      }
      this.loadingProgress.message = `Grouping patterns (${Math.min(i + GROUP_BATCH, analyzed.length)}/${analyzed.length})...`;
      this.cdr.detectChanges();
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (this.isDestroyed) return;
    this.sourceNeumeCount = sourceCounts;
    this.basePatterns = Array.from(patternMap.values()).sort((a, b) => b.totalCount - a.totalCount);

    // Calculate maximum frequency limit for slider (ensuring a minimum of 100)
    const maxVal = this.basePatterns.length > 0 ? this.basePatterns[0].totalCount : 100;
    this.maxFrequencyLimit = Math.max(100, maxVal);

    const timestamp = new Date().toLocaleString();
    this.lastComputedTime = timestamp;
    this.statsComputed = true;

    this.loadingProgress.message = 'Saving to database...';
    this.cdr.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    if (this.isDestroyed) return;

    // Persist to IndexedDB
    try {
      await localforage.setItem(StatsComponent.STATS_CACHE_KEY, {
        timestamp,
        sources: this.sources,
        documents: this.documents,
        basePatterns: this.basePatterns,
        sourceNeumeCount: this.sourceNeumeCount,
        sourceSigleLookup: this.sourceSigleLookup,
        maxFrequencyLimit: this.maxFrequencyLimit
      });
    } catch (e) {
      console.warn('Failed to cache pattern stats in IndexedDB:', e);
    }

    if (this.isDestroyed) return;
    this.applyFilters();
    this.loading = false;
    this.cdr.detectChanges();
  }

  applyFilters() {
    // 1. Filter Patterns
    let filteredPatterns = this.basePatterns;

    filteredPatterns = filteredPatterns.filter(p => p.totalCount >= this.minFrequency);

    if (this.patternSearchText.trim()) {
      const q = this.patternSearchText.toLowerCase();
      filteredPatterns = filteredPatterns.filter(p => p.basePattern.toLowerCase().includes(q));
    }
    this.displayedPatterns = filteredPatterns;
    this.patternPageIndex = 0; // reset pagination

    // 2. Filter Sources
    if (!this.sourceSearchText.trim()) {
      this.filteredSources = this.sources;
    } else {
      const q = this.sourceSearchText.toLowerCase();
      this.filteredSources = this.sources.filter(s => {
        const sigle = (s.quellensigle || '').toLowerCase();
        const library = (s.bibliothek || '').toLowerCase();
        const place = (s.herkunftsort || '').toLowerCase();
        const inst = (s.herkunftsinstitution || '').toLowerCase();
        return sigle.includes(q) || library.includes(q) || place.includes(q) || inst.includes(q);
      });
    }
    this.sourcePageIndex = 0; // reset pagination

    this.cdr.detectChanges();
  }

  // ── Pagination Getters ──
  get totalPatternPages(): number {
    return Math.ceil(this.displayedPatterns.length / this.patternPageSize);
  }

  get totalSourcePages(): number {
    return Math.ceil(this.filteredSources.length / this.sourcePageSize);
  }

  get totalCellOccurPages(): number {
    return this.selectedCell ? Math.ceil(this.selectedCell.occurrences.length / this.cellOccurPageSize) : 0;
  }

  get totalTokenOccurPages(): number {
    return Math.ceil(this.activeTokenOccurrences.length / this.tokenOccurPageSize);
  }

  get paginatedPatterns(): PatternGroup[] {
    const start = this.patternPageIndex * this.patternPageSize;
    return this.displayedPatterns.slice(start, start + this.patternPageSize);
  }

  get paginatedSources(): Source[] {
    const start = this.sourcePageIndex * this.sourcePageSize;
    return this.filteredSources.slice(start, start + this.sourcePageSize);
  }

  get paginatedCellOccurrences(): Occurence[] {
    if (!this.selectedCell) return [];
    const start = this.cellOccurPageIndex * this.cellOccurPageSize;
    return this.selectedCell.occurrences.slice(start, start + this.cellOccurPageSize);
  }

  get paginatedTokenOccurrences(): Occurence[] {
    const start = this.tokenOccurPageIndex * this.tokenOccurPageSize;
    return this.activeTokenOccurrences.slice(start, start + this.tokenOccurPageSize);
  }

  get activeTokenOccurrences(): Occurence[] {
    if (!this.selectedPatternType || !this.activeTokenId) return [];
    const token = this.selectedTypeTokens.find(t => t.patternId === this.activeTokenId);
    return token ? token.occurrences : [];
  }

  // ── Event Handlers ──
  onCellClick(source: Source, pg: PatternGroup) {
    const occs = pg.bySource[source.id || ''] || [];
    if (occs.length === 0) return;

    this.selectedCell = {
      source,
      patternGroup: pg,
      occurrences: occs
    };
    this.cellOccurPageIndex = 0; // reset modal pagination
    this.cdr.detectChanges();
  }

  closeModal() {
    this.selectedCell = null;
    this.cdr.detectChanges();
  }

  onTypeHeaderClick(pg: PatternGroup) {
    this.selectedPatternType = pg;
    this.activeTokenId = null;
    this.tokenOccurPageIndex = 0; // reset modal pagination
    
    // Group occurrences of this pattern type by their actual patternId (special signs)
    const tokenMap = new Map<string, { patternId: string, count: number, occurrences: Occurence[] }>();
    for (const occ of pg.occurrences) {
      if (!tokenMap.has(occ.patternId)) {
        tokenMap.set(occ.patternId, {
          patternId: occ.patternId,
          count: 0,
          occurrences: []
        });
      }
      const item = tokenMap.get(occ.patternId)!;
      item.count++;
      item.occurrences.push(occ);
    }

    this.selectedTypeTokens = Array.from(tokenMap.values())
      .sort((a, b) => b.count - a.count)
      .map(item => {
        // Count occurrences by source sigle
        const sourcesCount: { [sigle: string]: number } = {};
        for (const occ of item.occurrences) {
          const sigle = this.sourceSigleLookup[occ.sourceId] || occ.sourceId;
          sourcesCount[sigle] = (sourcesCount[sigle] || 0) + 1;
        }
        return {
          ...item,
          sourcesCount
        };
      });

    if (this.selectedTypeTokens.length > 0) {
      this.activeTokenId = this.selectedTypeTokens[0].patternId;
    }

    this.cdr.detectChanges();
  }

  onTokenSelect(tokenId: string) {
    this.activeTokenId = tokenId;
    this.tokenOccurPageIndex = 0; // reset pagination when token changes
    this.cdr.detectChanges();
  }

  closeTypeModal() {
    this.selectedPatternType = null;
    this.selectedTypeTokens = [];
    this.activeTokenId = null;
    this.cdr.detectChanges();
  }

  goToOccurrence(occ: Occurence) {
    this.closeModal();
    this.closeTypeModal();
    this.navService.openEditorForPattern(occ.sourceId, occ.documentId, occ.uuid);
  }

  getSourceStart(): number {
    return this.filteredSources.length === 0 ? 0 : this.sourcePageIndex * this.sourcePageSize + 1;
  }

  getSourceEnd(): number {
    const end = (this.sourcePageIndex + 1) * this.sourcePageSize;
    return end > this.filteredSources.length ? this.filteredSources.length : end;
  }

  getPatternStart(): number {
    return this.displayedPatterns.length === 0 ? 0 : this.patternPageIndex * this.patternPageSize + 1;
  }

  getPatternEnd(): number {
    const end = (this.patternPageIndex + 1) * this.patternPageSize;
    return end > this.displayedPatterns.length ? this.displayedPatterns.length : end;
  }

  getCellOccurStart(): number {
    if (!this.selectedCell) return 0;
    return this.selectedCell.occurrences.length === 0 ? 0 : this.cellOccurPageIndex * this.cellOccurPageSize + 1;
  }

  getCellOccurEnd(): number {
    if (!this.selectedCell) return 0;
    const end = (this.cellOccurPageIndex + 1) * this.cellOccurPageSize;
    return end > this.selectedCell.occurrences.length ? this.selectedCell.occurrences.length : end;
  }

  getTokenOccurStart(): number {
    return this.activeTokenOccurrences.length === 0 ? 0 : this.tokenOccurPageIndex * this.tokenOccurPageSize + 1;
  }

  getTokenOccurEnd(): number {
    const end = (this.tokenOccurPageIndex + 1) * this.tokenOccurPageSize;
    return end > this.activeTokenOccurrences.length ? this.activeTokenOccurrences.length : end;
  }

  getObjectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }
}
