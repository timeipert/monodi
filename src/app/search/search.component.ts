import { Component, OnInit, OnDestroy, AfterViewChecked, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { APIService, SourceQuery, DocumentQuery, Source, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { Subscription, forkJoin, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { PageTitleService } from '../page-title.service';
import { NotesStore } from '../notes-store';
import { PatternAnalysisService } from './pattern-analysis.service';
import { SynopsisService, AlignedNode, AlignedLineElement } from './synopsis.service';
import { SearchExecService, TextSnippet, QuickResult, MelodyResult } from './search-exec.service';
import * as VM from '../types/model';
import { textWidth } from '../../utils';
import * as localforage from 'localforage';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import 'svg2pdf.js';
import {
  LoadedDoc,
  PatternOccurrence,
  PatternGroup,
  arrayLevenshtein,
  levenshteinDistance,
  computePatternGroups,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';

// ─── Column config ────────────────────────────────────────────────────────────

export interface ColDef<T> {
  key: keyof T | string;
  label: string;
  visible: boolean;
}

const DEFAULT_SRC_COLS: ColDef<Source>[] = [
  { key: 'quellensigle',         label: 'Source Siglum',     visible: true  },
  { key: 'datierung',            label: 'Dating',            visible: false },
  { key: 'herkunftsregion',      label: 'Region of Origin',  visible: false },
  { key: 'herkunftsort',         label: 'Place of Origin',   visible: true  },
  { key: 'herkunftsinstitution', label: 'Institution',       visible: true  },
  { key: 'ordenstradition',      label: 'Order Tradition',   visible: false },
  { key: 'quellentyp',           label: 'Source Type',       visible: true  },
  { key: 'bibliotheksort',       label: 'Library Location',  visible: false },
  { key: 'bibliothek',           label: 'Library',           visible: false },
  { key: 'bibliothekssignatur',  label: 'Library Signature', visible: false },
];

const DEFAULT_DOC_COLS: ColDef<Document>[] = [
  { key: 'dokumenten_id',            label: 'Document ID',        visible: true  },
  { key: 'textinitium',              label: 'Text Incipit',       visible: true  },
  { key: 'gattung1',                 label: 'Genre 1',            visible: true  },
  { key: 'gattung2',                 label: 'Genre 2',            visible: false },
  { key: 'festtag',                  label: 'Feast Day',          visible: true  },
  { key: 'feier',                    label: 'Celebration',        visible: false },
  { key: 'foliostart',               label: 'Folio Start',        visible: false },
  { key: 'zeilenstart',              label: 'Line Start',         visible: false },
  { key: 'druckausgabe',             label: 'Print Edition',      visible: false },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.', visible: false },
  { key: 'editionsstatus',           label: 'Edition Status',     visible: false },
];

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

const SRC_RES_KEY  = 'monodi_search_src_cols';
const DOC_RES_KEY  = 'monodi_search_doc_cols';
const RECENT_KEY   = 'monodi_search_recent';

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

// LoadedDoc interface is imported from pattern-algo.ts


// ─── Synoptic Alignment definitions ───────────────────────────────────────────


// ─── Transcription utilities ──────────────────────────────────────────────────

function walkZeilen(children: any[], cb: (zeile: any) => void) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child?.kind === 'ZeileContainer') cb(child);
    else if (Array.isArray(child?.children)) walkZeilen(child.children, cb);
  }
}

/** Extract syllables with full neume-group structure preserved. */
function extractSyllables(root: VM.RootContainer): VM.Syllable[] {
  const result: VM.Syllable[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable') {
        result.push(part as VM.Syllable);
      }
    }
  });
  return result;
}

/** Flat note array for pattern matching. Also returns per-note syllable index. */
function flattenNotes(syllables: VM.Syllable[]): { notes: VM.Note[]; sylIdx: number[] } {
  const notes: VM.Note[] = [];
  const sylIdx: number[] = [];
  syllables.forEach((syl, si) => {
    const spaced = syl.notes?.spaced ?? [];
    spaced.forEach(ns => {
      const groups = ns.nonSpaced ?? [];
      groups.forEach(g => {
        const noteList = g.grouped ?? [];
        noteList.forEach(n => { notes.push(n); sylIdx.push(si); });
      });
    });
  });
  return { notes, sylIdx };
}

/**
 * Extract syllable text for full-text matching.
 * Returns both the raw hyphenated form ("Al-le-lu-ia") and the clean form ("Alleluia").
 */
function extractSyllableText(root: VM.RootContainer): string {
  const texts: string[] = [];
  walkZeilen(root.children, zeile => {
    for (const part of (zeile.children || [])) {
      if (part?.kind === 'Syllable' && part.text) texts.push(part.text as string);
    }
  });
  const joined = texts.join('');
  return joined + ' ' + joined.replace(/-/g, '');
}

export { arrayLevenshtein } from './pattern-algo';

export interface SequenceMatch {
  start: number;
  end: number;
  distance: number;
}


function isFuzzySubstring(target: string, query: string, maxDistance: number): { matched: boolean; matchedSub?: string } {
  const N = query.length;
  const M = target.length;
  if (N === 0) return { matched: false };
  if (M === 0) return { matched: false };

  if (N > M + maxDistance) return { matched: false };

  let bestDist = 999;
  let bestSub = '';

  for (let start = 0; start < M; start++) {
    const minLen = Math.max(1, N - maxDistance);
    const maxLen = N + maxDistance;

    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len - 1;
      if (end >= M) break;

      const sub = target.substring(start, end + 1);
      const dist = levenshteinDistance(sub, query);
      if (dist < bestDist) {
        bestDist = dist;
        bestSub = sub;
      }
    }
  }

  return { matched: bestDist <= maxDistance, matchedSub: bestSub };
}

function sequenceDistance(s1: string[], s2: string[]): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1].toLowerCase() === s2[j - 1].toLowerCase() ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function findSubsequenceMatches(sequence: string[], pattern: string[], maxDistance: number): SequenceMatch[] {
  const N = pattern.length;
  const M = sequence.length;
  if (N === 0 || M === 0) return [];

  const matches: SequenceMatch[] = [];

  // Iterate over all possible starting positions in the sequence
  for (let start = 0; start < M; start++) {
    const minLen = Math.max(1, N - maxDistance);
    const maxLen = N + maxDistance;

    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len - 1;
      if (end >= M) break;

      const sub = sequence.slice(start, end + 1);
      const dist = sequenceDistance(sub, pattern);
      if (dist <= maxDistance) {
        matches.push({ start, end, distance: dist });
      }
    }
  }

  // Filter overlapping matches, keeping the best one
  matches.sort((a, b) => a.distance - b.distance || (a.end - a.start) - (b.end - b.start));
  const filteredMatches: SequenceMatch[] = [];

  for (const m of matches) {
    let isRedundant = false;
    for (const selected of filteredMatches) {
      if (Math.abs(selected.start - m.start) <= 2 && Math.abs(selected.end - m.end) <= 2) {
        isRedundant = true;
        break;
      }
    }
    if (!isRedundant) {
      filteredMatches.push(m);
    }
  }

  return filteredMatches.sort((a, b) => a.start - b.start);
}

function parseMelodyPattern(raw: string, searchType: 'pitch' | 'contour' | 'interval', withOctave: boolean): string[] {
  const clean = raw.trim();
  if (searchType === 'contour') {
    if (clean.includes(' ')) {
      return clean.split(/\s+/).filter(Boolean).map(p => p.toLowerCase());
    } else {
      return clean.split('').filter(char => !/\s/.test(char)).map(p => p.toLowerCase());
    }
  }

  if (searchType === 'interval') {
    const matches: string[] = [];
    const regex = /([+-]?\d+)/g;
    let match;
    while ((match = regex.exec(clean)) !== null) {
      const num = parseInt(match[1], 10);
      matches.push(num > 0 ? `+${num}` : `${num}`);
    }
    return matches;
  }

  // Pitch matching
  // Note base: A-G, H (case-insensitive)
  // We use a regex that restricts the flat accidental 'b' to only follow a B/b base.
  // Other notes (A, C, D, E, F, G, H) can only have #, ♭, ♯ as accidentals.
  // This prevents 'ab' from being parsed as A-flat instead of note A followed by note B.
  const noteRegex = /(?:([bB])([b#♭♯]?)|([ac-ghAC-GH])([#♭♯]?))([0-9]?)/g;
  const matches: string[] = [];
  let match;
  
  while ((match = noteRegex.exec(clean)) !== null) {
    const isB = match[1] !== undefined;
    const base = (isB ? match[1] : match[3]).toLowerCase();
    const accidental = (isB ? match[2] : match[4]) || '';
    const octave = match[5] || '';

    let note = base;
    // Normalize German notation:
    // H -> B (B-natural)
    // B -> Bb (B-flat)
    if (note === 'h') {
      note = 'b';
    } else if (note === 'b') {
      note = 'bb';
    }

    // Normalize accidental
    let accNorm = accidental.replace(/♭/g, 'b').replace(/♯/g, '#');

    // Combine base and accidental
    if (accNorm) {
      if (note === 'bb' && accNorm === 'b') {
        // already B-flat, do nothing
      } else {
        note += accNorm;
      }
    }

    if (withOctave && octave) {
      note += octave;
    }

    matches.push(note);
  }

  return matches;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── Text snippet ─────────────────────────────────────────────────────────────

/** Find the query in text and return a { before, match, after } snippet. */
function findTextSnippet(text: string, query: string, window = 35): TextSnippet | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return undefined;

  // Walk back to a word boundary or window limit
  let before = text.slice(Math.max(0, idx - window), idx);
  if (idx - window > 0) before = '…' + before.replace(/^\S+\s/, ''); // trim partial word

  const match = text.slice(idx, idx + query.length);

  let after = text.slice(idx + query.length, idx + query.length + window);
  if (idx + query.length + window < text.length) after = after.replace(/\s\S+$/, '') + '…';

  return { before, match, after };
}

// ─── Melody SVG renderer ──────────────────────────────────────────────────────



// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewChecked {
  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  // ── Synoptic Comparison ───────────────────────────────────────────────────
  selectedDocs: Document[] = [];
  showSynopsis = false;
  synopsisLoading = false;
  synopsisPdfExporting = false;

  // Selection analysis dashboard
  showDashboard = false;
  dashboardLoading = false;
  dashboardRoots: (VM.RootContainer | null)[] = [];
  dashboardSources: (Source | null)[] = [];

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
  get sourceQuery() { return this.searchExecSvc.sourceQuery; }
  set sourceQuery(v) { this.searchExecSvc.sourceQuery = v; }

  get sourceResults() { return this.searchExecSvc.sourceResults; }
  set sourceResults(v) { this.searchExecSvc.sourceResults = v; }

  get sourceSearched() { return this.searchExecSvc.sourceSearched; }
  set sourceSearched(v) { this.searchExecSvc.sourceSearched = v; }

  get sourceSearching() { return this.searchExecSvc.sourceSearching; }
  set sourceSearching(v) { this.searchExecSvc.sourceSearching = v; }

  get sourcesPage() { return this.searchExecSvc.sourcesPage; }
  set sourcesPage(v) { this.searchExecSvc.sourcesPage = v; }

  // ── Document search delegation ─────────────────────────────────────────────
  get documentQuery() { return this.searchExecSvc.documentQuery; }
  set documentQuery(v) { this.searchExecSvc.documentQuery = v; }

  get documentResults() { return this.searchExecSvc.documentResults; }
  set documentResults(v) { this.searchExecSvc.documentResults = v; }

  get documentSearched() { return this.searchExecSvc.documentSearched; }
  set documentSearched(v) { this.searchExecSvc.documentSearched = v; }

  get documentSearching() { return this.searchExecSvc.documentSearching; }
  set documentSearching(v) { this.searchExecSvc.documentSearching = v; }

  get documentsPage() { return this.searchExecSvc.documentsPage; }
  set documentsPage(v) { this.searchExecSvc.documentsPage = v; }

  // ── Melody search delegation ───────────────────────────────────────────────
  get melodyPattern() { return this.searchExecSvc.melodyPattern; }
  set melodyPattern(v) { this.searchExecSvc.melodyPattern = v; }

  get melodySearchType() { return this.searchExecSvc.melodySearchType; }
  set melodySearchType(v) { this.searchExecSvc.melodySearchType = v; }

  get melodyWithOctave() { return this.searchExecSvc.melodyWithOctave; }
  set melodyWithOctave(v) { this.searchExecSvc.melodyWithOctave = v; }

  get melodyOnlyWithinSyllables() { return this.searchExecSvc.melodyOnlyWithinSyllables; }
  set melodyOnlyWithinSyllables(v) { this.searchExecSvc.melodyOnlyWithinSyllables = v; }

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

  // View-local configs
  srcSortCol = '';
  srcSortAsc = true;
  showSrcColPicker = false;
  srcResultCols: ColDef<Source>[] = [];

  docSortCol = '';
  docSortAsc = true;
  showDocColPicker = false;
  docResultCols: ColDef<Document>[] = [];
  synopsisMetadataCols: ColDef<Document>[] = [];
  showSynopsisColPicker = false;

  quickPageSize = 25;
  sourcesPageSize = 25;
  documentsPageSize = 25;
  melodyPageSize = 10;

  // ── Recent searches ───────────────────────────────────────────────────────
  recentSearches: string[] = [];

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
  /** Documents processed per yield in the chunked search loops. ~50 keeps
   *  the progress bar smooth on a low-end laptop without amortising too
   *  many extra Promise scheduling steps. */
  private static readonly SEARCH_BATCH_SIZE = 50;

  /** Hard cap on how many results are *rendered* at once. Way over this and
   *  Angular spends all its time in change-detection / DOM updates on
   *  result rows the user can't even see. They can ask for more via the
   *  "Show more" buttons. */
  private static readonly INITIAL_RESULT_LIMIT = 100;

  /** Current visible-result caps; incremented by `showMore*()`. */
  visibleQuickLimit    = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleSourceLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
  visibleMelodyLimit   = SearchComponent.INITIAL_RESULT_LIMIT;







  // ── Cached sort results (avoid recomputing per CD pass) ──────────────────
  /** Precomputed sorted view; mirror of `sourceResults` / `documentResults`
   *  but recomputed only when the data or sort spec actually changes. The
   *  prior code used getters that ran the sort on *every* change detection
   *  pass, which is O(N log N) per CD on huge result sets. */
  private _sortedSources: Source[] = [];
  private _sortedDocs:    Document[] = [];
  private _srcSortKey = ''; // composite "col|asc" cache key
  private _docSortKey = '';
  private _srcResultsRef: Source[] | null = null;
  private _docResultsRef: Document[] | null = null;

  // ── Post-search filter ───────────────────────────────────────────────────
  /** Text typed into the in-result filter bars. Empty = no filter. Each
   *  search tab keeps its own filter so switching tabs doesn't lose state. */
  quickFilterText    = '';
  sourceFilterText   = '';
  documentFilterText = '';
  melodyFilterText   = '';

  /** Debounced values that actually drive the getter filters. */
  quickFilterValue    = '';
  sourceFilterValue   = '';
  documentFilterValue = '';
  melodyFilterValue   = '';

  private filterSubject = new Subject<'quick' | 'source' | 'document' | 'melody'>();

  /** Memoised filtered lists. Recomputed only when the underlying results
   *  array reference or filter string actually changes — otherwise the
   *  cached array is returned, so a CD-heavy parent component doesn't
   *  cause a substring scan on every tick. */
  private _filteredQuick:    QuickResult[]  = [];
  private _filteredSrc:      Source[]       = [];
  private _filteredDoc:      Document[]     = [];
  private _filteredMelody:   MelodyResult[] = [];
  private _quickFilterKey  = '__init__';
  private _srcFilterKey    = '__init__';
  private _docFilterKey    = '__init__';
  private _melodyFilterKey = '__init__';
  private _quickFilterRef:  QuickResult[]  | null = null;
  private _srcFilterRef:    Source[]       | null = null;
  private _docFilterRef:    Document[]     | null = null;
  private _melodyFilterRef: MelodyResult[] | null = null;

  constructor(
    private api: APIService,
    private router: Router,
    private route: ActivatedRoute,
    private userService: UserService,
    private pageTitle: PageTitleService,
    private sanitizer: DomSanitizer,
    private cdRef: ChangeDetectorRef,
    private toastr: ToastrService,
    private patternSvc: PatternAnalysisService,
    private synopsisSvc: SynopsisService,
    private searchExecSvc: SearchExecService,
  ) {
    this.loadCols();
    this.loadRecentSearches();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.pageTitle.set('Search');

    this.subs.push(
      this.searchExecSvc.stateChanged$.subscribe(() => {
        this.cdRef.markForCheck();
      })
    );

    this.subs.push(
      this.filterSubject.pipe(debounceTime(300)).subscribe(which => {
        switch (which) {
          case 'quick':    this.quickFilterValue = this.quickFilterText; break;
          case 'source':   this.sourceFilterValue = this.sourceFilterText; break;
          case 'document': this.documentFilterValue = this.documentFilterText; break;
          case 'melody':   this.melodyFilterValue = this.melodyFilterText; break;
        }
        this.applyFilterLimitReset(which);
      })
    );

    this.subs.push(this.userService.user.subscribe(async user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') this.settings = res.settings;
        });
        await this.loadFromIndexedDB();
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
        const el = this.synScrollRef?.nativeElement;
        this.updateSynWindow(el ? el.scrollLeft : 0, el ? el.clientWidth : 1400);
        this.cdRef.markForCheck();
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
    this.visibleQuickLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.updateUrl();
    await this.searchExecSvc.searchQuick(
      (q) => this.addRecentSearch(q),
      () => this.clearFilter('quick')
    );
  }

  cancelSearch(): void {
    this.searchExecSvc.cancelSearch();
  }

  searchSources() {
    this.visibleSourceLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.updateUrl();
    this.searchExecSvc.searchSources();
  }

  clearSourceQuery() {
    this.searchExecSvc.sourceQuery = {};
    this.searchExecSvc.sourceResults = [];
    this.searchExecSvc.sourceSearched = false;
    this.srcSortCol = '';
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }

  searchDocuments() {
    this.visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.updateUrl();
    this.searchExecSvc.searchDocuments();
  }

  clearDocumentQuery() {
    this.searchExecSvc.documentQuery = {
      dokumenten_id: undefined, gattung1: undefined, gattung2: undefined,
      festtag: undefined, feier: undefined, textinitium: undefined,
      bibliographischerverweis: undefined, druckausgabe: undefined,
      zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
    };
    this.searchExecSvc.documentResults = [];
    this.searchExecSvc.documentSearched = false;
    this.docSortCol = '';
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }

  async searchMelody() {
    this.visibleMelodyLimit = SearchComponent.INITIAL_RESULT_LIMIT;
    this.updateUrl();
    await this.searchExecSvc.searchMelody();
  }

  get melodyPatternHint(): string {
    if (this.melodySearchType === 'pitch') {
      return this.melodyWithOctave
        ? 'e.g. C4D4E4F4  (note names + octave, no spaces needed)'
        : 'e.g. CDEFG  (note names A–G, no spaces needed)';
    } else if (this.melodySearchType === 'contour') {
      return 'e.g. uudrud  (u=up, d=down, r=repeat)';
    }
    return 'e.g. +1-2+0  (signed step differences, spaces optional)';
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  sortBy(col: string, which: 'src' | 'doc') {
    if (which === 'src') {
      if (this.srcSortCol === col) this.srcSortAsc = !this.srcSortAsc;
      else { this.srcSortCol = col; this.srcSortAsc = true; }
    } else {
      if (this.docSortCol === col) this.docSortAsc = !this.docSortAsc;
      else { this.docSortCol = col; this.docSortAsc = true; }
    }
  }

  private sortArr<T>(arr: T[], col: string, asc: boolean): T[] {
    if (!col) return arr;
    return [...arr].sort((a, b) => {
      const av = String((a as any)[col] ?? '').toLowerCase();
      const bv = String((b as any)[col] ?? '').toLowerCase();
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  /**
   * Sorted-result accessors used by the template's `*ngFor`.
   *
   * These USED to be eager `sortArr(...)` getters which re-ran the entire
   * O(N log N) sort on every Angular change-detection pass — on big result
   * sets that meant the browser was doing thousands of comparisons per
   * scroll tick. The cached implementation keeps the previous output and
   * only re-sorts when either the underlying array reference or the sort
   * key/direction actually changes.
   */
  get sortedSourceResults(): Source[] {
    const key = this.srcSortCol + '|' + this.srcSortAsc;
    if (this._srcResultsRef !== this.sourceResults || this._srcSortKey !== key) {
      this._sortedSources = this.sortArr(this.sourceResults, this.srcSortCol, this.srcSortAsc);
      this._srcResultsRef = this.sourceResults;
      this._srcSortKey = key;
    }
    return this._sortedSources;
  }
  get sortedDocumentResults(): Document[] {
    const key = this.docSortCol + '|' + this.docSortAsc;
    if (this._docResultsRef !== this.documentResults || this._docSortKey !== key) {
      this._sortedDocs = this.sortArr(this.documentResults, this.docSortCol, this.docSortAsc);
      this._docResultsRef = this.documentResults;
      this._docSortKey = key;
    }
    return this._sortedDocs;
  }
  // ── Post-search filtering ──────────────────────────────────────────────
  /**
   * Generic substring filter. `keyFn` returns a string of all the text the
   * row should be matchable by (e.g. concatenated metadata). The filter
   * text is split on whitespace into AND-terms so the user can type
   * `Aa 13 Karolus` to narrow to rows containing *both* "Aa 13" and
   * "Karolus" — feels natural for refining a large result set.
   */
  private applyFilter<T>(arr: T[], filterText: string, keyFn: (row: T) => string): T[] {
    const trimmed = filterText.trim().toLowerCase();
    if (!trimmed) return arr;
    const terms = trimmed.split(/\s+/).filter(Boolean);
    return arr.filter(row => {
      const haystack = keyFn(row).toLowerCase();
      return terms.every(t => haystack.includes(t));
    });
  }

  /** Cached filtered views — keyed on (results ref, filter text) so a CD
   *  pass that didn't change either skips the substring scan entirely. */
  get filteredQuickResults(): QuickResult[] {
    const key = this.quickFilterValue;
    if (this._quickFilterRef !== this.quickResults || this._quickFilterKey !== key) {
      this._filteredQuick = this.applyFilter(this.quickResults, key,
        r => `${r.title} ${r.subtitle} ${r.extra} ${r.snippet?.before ?? ''} ${r.snippet?.match ?? ''} ${r.snippet?.after ?? ''}`);
      this._quickFilterRef = this.quickResults;
      this._quickFilterKey = key;
    }
    return this._filteredQuick;
  }
  get filteredSourceResults(): Source[] {
    const sorted = this.sortedSourceResults;
    const key = this.sourceFilterValue;
    if (this._srcFilterRef !== sorted || this._srcFilterKey !== key) {
      this._filteredSrc = this.applyFilter(sorted, key,
        s => Object.values(s).filter(v => typeof v === 'string').join(' '));
      this._srcFilterRef = sorted;
      this._srcFilterKey = key;
    }
    return this._filteredSrc;
  }
  get filteredDocumentResults(): Document[] {
    const sorted = this.sortedDocumentResults;
    const key = this.documentFilterValue;
    if (this._docFilterRef !== sorted || this._docFilterKey !== key) {
      this._filteredDoc = this.applyFilter(sorted, key,
        d => Object.values(d).filter(v => typeof v === 'string').join(' '));
      this._docFilterRef = sorted;
      this._docFilterKey = key;
    }
    return this._filteredDoc;
  }
  get filteredMelodyResults(): MelodyResult[] {
    const key = this.melodyFilterValue;
    if (this._melodyFilterRef !== this.melodyResults || this._melodyFilterKey !== key) {
      this._filteredMelody = this.applyFilter(this.melodyResults, key, r => {
        const d = r.document;
        return `${r.sourceSigle} ${d.textinitium ?? ''} ${d.dokumenten_id ?? ''} ${d.gattung1 ?? ''} ${d.gattung2 ?? ''} ${d.festtag ?? ''} ${d.feier ?? ''} ${d.foliostart ?? ''}`;
      });
      this._melodyFilterRef = this.melodyResults;
      this._melodyFilterKey = key;
    }
    return this._filteredMelody;
  }

  /** Visible-cap slicing — keeps the DOM small on huge result sets. Slices
   *  AFTER filtering so "Show more" pages through the filtered view. */
  get visibleQuickResults():    QuickResult[]  { return this.filteredQuickResults.slice(0, this.visibleQuickLimit); }
  get visibleSourceResults():   Source[]       { return this.filteredSourceResults.slice(0, this.visibleSourceLimit); }
  get visibleDocumentResults(): Document[]     { return this.filteredDocumentResults.slice(0, this.visibleDocumentLimit); }
  get visibleMelodyResults():   MelodyResult[] { return this.filteredMelodyResults.slice(0, this.visibleMelodyLimit); }

  // ── Search pagination helper and getters ──────────────────────────────────

  getPagerWindow(currentPage: number, totalPages: number): number[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const out: number[] = [1];
    const winStart = Math.max(2, currentPage - 2);
    const winEnd   = Math.min(totalPages - 1, currentPage + 2);
    if (winStart > 2) out.push(-1);
    for (let p = winStart; p <= winEnd; p++) out.push(p);
    if (winEnd < totalPages - 1) out.push(-1);
    out.push(totalPages);
    return out;
  }

  async saveSearchStateToIndexedDB() {
    await this.searchExecSvc.saveSearchStateToIndexedDB(this.activeTab);
  }

  async loadFromIndexedDB() {
    await this.searchExecSvc.loadFromIndexedDB(
      () => this.runPatternGrouping(),
      (tab) => { this.activeTab = tab; }
    );
    this.cdRef.markForCheck();
  }

  showMoreQuick():     void { this.visibleQuickLimit    += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreSources():   void { this.visibleSourceLimit   += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreDocuments(): void { this.visibleDocumentLimit += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }
  showMoreMelody():    void { this.visibleMelodyLimit   += SearchComponent.INITIAL_RESULT_LIMIT; this.cdRef.markForCheck(); }

  trackQuick   = (_: number, r: QuickResult)  => r.id;
  trackSource  = (_: number, s: Source)       => s.id ?? '';
  trackDoc     = (_: number, d: Document)     => d.id;
  trackMelody  = (_: number, r: MelodyResult) => r.document.id;

  // Quick Search Pagination
  get quickTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredQuickResults.length / this.quickPageSize));
  }
  get pagedQuickResults(): QuickResult[] {
    const start = (this.quickPage - 1) * this.quickPageSize;
    return this.filteredQuickResults.slice(start, start + this.quickPageSize);
  }
  get quickPageFromIndex(): number {
    if (this.filteredQuickResults.length === 0) return 0;
    return (this.quickPage - 1) * this.quickPageSize + 1;
  }
  get quickPageToIndex(): number {
    return Math.min(this.filteredQuickResults.length, this.quickPage * this.quickPageSize);
  }
  get quickPagerWindow(): number[] {
    return this.getPagerWindow(this.quickPage, this.quickTotalPages);
  }

  goToQuickPage(p: number): void {
    if (this.filteredQuickResults.length === 0) return;
    this.quickPage = Math.max(1, Math.min(this.quickTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstQuickPage(): void { this.goToQuickPage(1); }
  goToLastQuickPage():  void { this.goToQuickPage(this.quickTotalPages); }
  goToPrevQuickPage():  void { this.goToQuickPage(this.quickPage - 1); }
  goToNextQuickPage():  void { this.goToQuickPage(this.quickPage + 1); }

  // Sources Search Pagination
  get sourcesTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredSourceResults.length / this.sourcesPageSize));
  }
  get pagedSourceResults(): Source[] {
    const start = (this.sourcesPage - 1) * this.sourcesPageSize;
    return this.filteredSourceResults.slice(start, start + this.sourcesPageSize);
  }
  get sourcesPageFromIndex(): number {
    if (this.filteredSourceResults.length === 0) return 0;
    return (this.sourcesPage - 1) * this.sourcesPageSize + 1;
  }
  get sourcesPageToIndex(): number {
    return Math.min(this.filteredSourceResults.length, this.sourcesPage * this.sourcesPageSize);
  }
  get sourcesPagerWindow(): number[] {
    return this.getPagerWindow(this.sourcesPage, this.sourcesTotalPages);
  }
  goToSourcesPage(p: number): void {
    if (this.filteredSourceResults.length === 0) return;
    this.sourcesPage = Math.max(1, Math.min(this.sourcesTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstSourcesPage(): void { this.goToSourcesPage(1); }
  goToLastSourcesPage():  void { this.goToSourcesPage(this.sourcesTotalPages); }
  goToPrevSourcesPage():  void { this.goToSourcesPage(this.sourcesPage - 1); }
  goToNextSourcesPage():  void { this.goToSourcesPage(this.sourcesPage + 1); }

  // Documents Search Pagination
  get documentsTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDocumentResults.length / this.documentsPageSize));
  }
  get pagedDocumentResults(): Document[] {
    const start = (this.documentsPage - 1) * this.documentsPageSize;
    return this.filteredDocumentResults.slice(start, start + this.documentsPageSize);
  }
  get documentsPageFromIndex(): number {
    if (this.filteredDocumentResults.length === 0) return 0;
    return (this.documentsPage - 1) * this.documentsPageSize + 1;
  }
  get documentsPageToIndex(): number {
    return Math.min(this.filteredDocumentResults.length, this.documentsPage * this.documentsPageSize);
  }
  get documentsPagerWindow(): number[] {
    return this.getPagerWindow(this.documentsPage, this.documentsTotalPages);
  }
  goToDocumentsPage(p: number): void {
    if (this.filteredDocumentResults.length === 0) return;
    this.documentsPage = Math.max(1, Math.min(this.documentsTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstDocumentsPage(): void { this.goToDocumentsPage(1); }
  goToLastDocumentsPage():  void { this.goToDocumentsPage(this.documentsTotalPages); }
  goToPrevDocumentsPage():  void { this.goToDocumentsPage(this.documentsPage - 1); }
  goToNextDocumentsPage():  void { this.goToDocumentsPage(this.documentsPage + 1); }

  // Melody Search Pagination
  get melodyTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMelodyResults.length / this.melodyPageSize));
  }
  get pagedMelodyResults(): MelodyResult[] {
    const start = (this.melodyPage - 1) * this.melodyPageSize;
    return this.filteredMelodyResults.slice(start, start + this.melodyPageSize);
  }
  get melodyPageFromIndex(): number {
    if (this.filteredMelodyResults.length === 0) return 0;
    return (this.melodyPage - 1) * this.melodyPageSize + 1;
  }
  get melodyPageToIndex(): number {
    return Math.min(this.filteredMelodyResults.length, this.melodyPage * this.melodyPageSize);
  }
  get melodyPagerWindow(): number[] {
    return this.getPagerWindow(this.melodyPage, this.melodyTotalPages);
  }
  goToMelodyPage(p: number): void {
    if (this.filteredMelodyResults.length === 0) return;
    this.melodyPage = Math.max(1, Math.min(this.melodyTotalPages, p));
    this.saveSearchStateToIndexedDB();
    this.cdRef.markForCheck();
  }
  goToFirstMelodyPage(): void { this.goToMelodyPage(1); }
  goToLastMelodyPage():  void { this.goToMelodyPage(this.melodyTotalPages); }
  goToPrevMelodyPage():  void { this.goToMelodyPage(this.melodyPage - 1); }
  goToNextMelodyPage():  void { this.goToMelodyPage(this.melodyPage + 1); }

  /** Reset visible cap whenever the filter changes so users don't have to
   *  click "Show more" to discover that their narrower filter already fits. */
  onFilterChange(which: 'quick' | 'source' | 'document' | 'melody'): void {
    this.filterSubject.next(which);
  }

  applyFilterLimitReset(which: 'quick' | 'source' | 'document' | 'melody'): void {
    switch (which) {
      case 'quick':
        this.visibleQuickLimit    = SearchComponent.INITIAL_RESULT_LIMIT;
        this.quickPage = 1;
        break;
      case 'source':
        this.visibleSourceLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
        this.sourcesPage = 1;
        break;
      case 'document':
        this.visibleDocumentLimit = SearchComponent.INITIAL_RESULT_LIMIT;
        this.documentsPage = 1;
        break;
      case 'melody':
        this.visibleMelodyLimit   = SearchComponent.INITIAL_RESULT_LIMIT;
        this.melodyPage = 1;
        break;
    }
    this.cdRef.markForCheck();
  }

  /** Clears the filter for the given tab. */
  clearFilter(which: 'quick' | 'source' | 'document' | 'melody'): void {
    switch (which) {
      case 'quick':    this.quickFilterText = ''; this.quickFilterValue = ''; break;
      case 'source':   this.sourceFilterText = ''; this.sourceFilterValue = ''; break;
      case 'document': this.documentFilterText = ''; this.documentFilterValue = ''; break;
      case 'melody':   this.melodyFilterText = ''; this.melodyFilterValue = ''; break;
    }
    this.applyFilterLimitReset(which);
  }

  get visibleSrcCols() { return this.srcResultCols.filter(c => c.visible); }
  get visibleDocCols() { return this.docResultCols.filter(c => c.visible); }

  sortIcon(col: string, which: 'src' | 'doc'): string {
    const activeCol = which === 'src' ? this.srcSortCol : this.docSortCol;
    const asc       = which === 'src' ? this.srcSortAsc : this.docSortAsc;
    if (activeCol !== col) return 'bi bi-chevron-expand text-muted opacity-50';
    return asc ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  exportSourcesCSV()   { this.exportCSV(this.sortedSourceResults, this.visibleSrcCols, 'sources.csv'); }
  exportDocumentsCSV() { this.exportCSV(this.sortedDocumentResults, this.visibleDocCols, 'documents.csv'); }

  exportMelodyCSV() {
    const rows = this.melodyResults.map(r => ({
      sourceSigle:  r.sourceSigle,
      dokumenten_id: r.document.dokumenten_id,
      textinitium:  r.document.textinitium,
      gattung1:     r.document.gattung1,
      festtag:      r.document.festtag,
      noteCount:    r.noteCount,
    }));
    this.exportCSV(rows, [
      { key: 'sourceSigle',  label: 'Source Siglum', visible: true },
      { key: 'dokumenten_id', label: 'Document ID',  visible: true },
      { key: 'textinitium',  label: 'Text Incipit',  visible: true },
      { key: 'gattung1',     label: 'Genre',         visible: true },
      { key: 'festtag',      label: 'Feast Day',     visible: true },
      { key: 'noteCount',    label: 'Note Count',    visible: true },
    ], 'melody-results.csv');
  }

  private exportCSV(data: any[], cols: ColDef<any>[], filename: string) {
    const visCols = cols.filter(c => c.visible);
    const header  = visCols.map(c => `"${c.label}"`).join(',');
    const rows    = data.map(row =>
      visCols.map(c => `"${String((row as any)[c.key] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  goToSource(id: string)                         { this.router.navigate(['/source', id]); }
  goToDocument(sourceId: string, docId: string)  { this.router.navigate(['/document', sourceId, docId]); }
  goToQuickResult(r: QuickResult) {
    if (r.kind === 'source') this.goToSource(r.id);
    else this.goToDocument(r.sourceId!, r.id);
  }

  // ── Column persistence ────────────────────────────────────────────────────

  loadCols() {
    this.srcResultCols = this.loadFromStorage<Source>(SRC_RES_KEY, DEFAULT_SRC_COLS);
    this.docResultCols = this.loadFromStorage<Document>(DOC_RES_KEY, DEFAULT_DOC_COLS);
    this.synopsisMetadataCols = this.loadFromStorage<Document>(SYNOPSIS_COLS_KEY, DEFAULT_SYNOPSIS_COLS);
  }

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

  saveSrcCols() { localStorage.setItem(SRC_RES_KEY, JSON.stringify(this.srcResultCols)); }
  saveDocCols() { localStorage.setItem(DOC_RES_KEY, JSON.stringify(this.docResultCols)); }
  saveSynopsisCols() { localStorage.setItem(SYNOPSIS_COLS_KEY, JSON.stringify(this.synopsisMetadataCols)); }

  get visibleSynopsisCols() {
    return this.synopsisMetadataCols.filter(c => c.visible);
  }

  getDocFieldValue(doc: Document, key: string): string {
    const val = (doc as any)[key];
    if (val === undefined || val === null || val === '') return '—';
    return val;
  }

  // ── Recent searches ───────────────────────────────────────────────────────

  loadRecentSearches() {
    try { this.recentSearches = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { this.recentSearches = []; }
  }

  addRecentSearch(q: string) {
    if (!q.trim()) return;
    this.recentSearches = [q, ...this.recentSearches.filter(r => r !== q)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentSearches));
  }

  applyRecent(q: string)  { this.quickText = q; this.searchQuick(); }
  clearRecent()           { this.recentSearches = []; localStorage.removeItem(RECENT_KEY); }
  countQuickResults(kind: 'source' | 'document'): number {
    return this.quickResults.filter(r => r.kind === kind).length;
  }

  // ── Settings helpers ──────────────────────────────────────────────────────

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        alert('Added to global options!');
      });
    }
  }

  // ── Synoptic Comparison methods ───────────────────────────────────────────

  toggleDocSelection(doc: Document, event: Event) {
    event.stopPropagation();
    const idx = this.selectedDocs.findIndex(d => d.id === doc.id);
    if (idx > -1) {
      this.selectedDocs.splice(idx, 1);
    } else {
      this.selectedDocs.push(doc);
    }
    this.updateUrl();
  }

  toggleQuickResultSelection(r: QuickResult, event: Event) {
    event.stopPropagation();
    const doc: Document = {
      id: r.id,
      quelle_id: r.sourceId || '',
      dokumenten_id: r.title || r.id,
      textinitium: r.title || '',
      gattung1: '',
      gattung2: '',
      festtag: '',
      feier: '',
      bibliographischerverweis: '',
      druckausgabe: '',
      zeilenstart: '',
      foliostart: '',
      kommentar: '',
      editionsstatus: ''
    };
    this.toggleDocSelection(doc, event);
  }

  isDocSelected(id: string): boolean {
    return this.selectedDocs.some(d => d.id === id);
  }

  clearDocSelection() {
    this.selectedDocs = [];
    this.synopsisSvc.exitSynopsis();
    this.updateUrl();
  }

  selectTab(tab: 'quick' | 'sources' | 'documents' | 'melody') {
    this.activeTab = tab;
    this.updateUrl();
    this.saveSearchStateToIndexedDB();
  }

  exitSynopsis() {
    this.showSynopsis = false;
    this.updateUrl();
  }

  updateUrl() {
    const queryParams: any = {
      tab: this.activeTab,
      compare: this.selectedDocs.length > 0 ? this.selectedDocs.map(d => d.id).join(',') : null,
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

    if (params.tab) this.activeTab = params.tab;
    if (params.align) this.synopsisSvc.alignmentMode = params.align;
    if (params.q) {
      this.quickText = params.q;
      this.searchQuick();
    }

    if (params.compare) {
      const docIds = params.compare.split(',');
      const observables = docIds.map((id: string) => this.api.getDocument(this.user!.token, id));
      (forkJoin(observables) as any).subscribe({
        next: (results: any[]) => {
          const docs: Document[] = [];
          for (const res of results) {
            if (res.kind === 'DocumentRetrieved') {
              docs.push(res.document);
            }
          }
          this.selectedDocs = docs;
          
          if (params.synopsis === 'true' && this.selectedDocs.length >= 2) {
            this.enterSynopsis();
          }
        },
        error: (err: any) => {
          console.error('Error restoring compared documents:', err);
        }
      });
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
    const total = this.selectedDocs.length;
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
        this.selectedDocs,
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
    this.synopsisLoading = true;
    this.showSynopsis = false;
    this.synopsisSvc.enterSynopsis(
      this.selectedDocs,
      (show) => { this.showSynopsis = show; this.cdRef.markForCheck(); },
      (loading) => { this.synopsisLoading = loading; this.cdRef.markForCheck(); },
      () => { this.updateUrl(); this.cdRef.markForCheck(); }
    );
  }

  // ── Selection analysis dashboard ──────────────────────────────────────────

  openDashboard() {
    if (!this.user || this.selectedDocs.length < 1) return;
    const token = this.user.token;
    this.dashboardLoading = true;
    this.cdRef.markForCheck();
    forkJoin({
      sources: this.api.listSources(token),
      notes: forkJoin(this.selectedDocs.map(d => this.api.getDocumentNotes(token, d.id))),
    }).subscribe({
      next: ({ sources, notes }) => {
        const srcList = sources.kind === 'SourcesRetrieved' ? sources.sources : [];
        const srcMap = new Map(srcList.filter(s => s.id).map(s => [s.id!, s] as [string, Source]));
        this.dashboardSources = this.selectedDocs.map(d => srcMap.get(d.quelle_id) || null);
        this.dashboardRoots = notes.map(n => (n.kind === 'NotesRetrieved' ? n.data : null));
        this.dashboardLoading = false;
        this.showDashboard = true;
        this.cdRef.markForCheck();
      },
      error: () => {
        this.dashboardLoading = false;
        this.toastr.error('Could not load the selected documents for analysis.');
        this.cdRef.markForCheck();
      },
    });
  }

  exitDashboard() {
    this.showDashboard = false;
    this.dashboardRoots = [];
    this.dashboardSources = [];
    this.cdRef.markForCheck();
  }

  // ── Pattern Analysis Methods ──────────────────────────────────────────────

  get patternTargetDocsCount(): number {
    if (this.activeTab === 'quick') {
      return this.filteredQuickResults.filter(r => r.kind === 'document').length;
    } else if (this.activeTab === 'sources') {
      return this.filteredSourceResults.length;
    } else if (this.activeTab === 'documents') {
      return this.filteredDocumentResults.length;
    } else if (this.activeTab === 'melody') {
      return this.filteredMelodyResults.length;
    }
    return 0;
  }

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

  async getCurrentSearchDocIds(): Promise<string[]> {
    if (!this.user) return [];
    try {
      const docsRes = await this.api.listDocuments(this.user.token).toPromise();
      const allDocs = docsRes?.kind === 'DocumentsRetrieved' ? docsRes.documents : [];
      
      const docIds: string[] = [];
      if (this.activeTab === 'quick') {
        const docResults = this.filteredQuickResults.filter(r => r.kind === 'document');
        docIds.push(...docResults.map(r => r.id));
      } else if (this.activeTab === 'sources') {
        const sourceIds = new Set(this.filteredSourceResults.map(s => s.id));
        for (const doc of allDocs) {
          if (sourceIds.has(doc.quelle_id)) {
            docIds.push(doc.id!);
          }
        }
      } else if (this.activeTab === 'documents') {
        docIds.push(...this.filteredDocumentResults.map(d => d.id!));
      } else if (this.activeTab === 'melody') {
        docIds.push(...this.filteredMelodyResults.map(mr => mr.document.id!));
      }
      return docIds;
    } catch (e) {
      console.warn('Failed to get current search doc IDs:', e);
      return [];
    }
  }

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
      const pageHeight = 842;
      const pageWidth = 595;
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
      this.toastr.success('PDF report exported successfully!');
    } catch (e) {
      console.error('Failed to export PDF:', e);
      this.toastr.error('Failed to export PDF report');
    }
  }

  async saveCurrentPatternSession() {
    if (!this.newSessionName.trim()) {
      this.toastr.error('Please enter a session name');
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

  exportPatternSessionJSON() {
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
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      this.toastr.success('JSON file exported');
    } catch (e) {
      console.error('Failed to export JSON:', e);
      this.toastr.error('Failed to export JSON file');
    }
  }

  triggerImportJSON() {
    const input = document.getElementById('patternImportJsonInput');
    if (input) {
      input.click();
    }
  }

  importPatternSessionJSON(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.patternGroups)) {
          this.toastr.error('Invalid pattern analysis session file');
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
        this.toastr.success('Session imported successfully');
        this.cdRef.markForCheck();
      } catch (err) {
        console.error('Failed to parse JSON:', err);
        this.toastr.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
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

  async runPatternGrouping() {
    await this.patternSvc.runPatternGrouping(
      this.activeTab,
      this.filteredQuickResults,
      this.filteredSourceResults,
      this.filteredDocumentResults,
      this.filteredMelodyResults
    );
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




