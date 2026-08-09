import { Injectable } from '@angular/core';
import { Subject, forkJoin, Subscription } from 'rxjs';
import { APIService, SourceQuery, DocumentQuery, Source, Document } from '../api.service';
import { UserService, User } from '../user.service';
import { PatternAnalysisService } from './pattern-analysis.service';
import { NotesStore } from '../notes-store';
import * as localforage from 'localforage';
import * as VM from '../types/model';
import {
  levenshteinDistance,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';
import { textWidth } from '../../utils';

export interface TextSnippet {
  before: string;
  match: string;
  after: string;
}

export interface QuickResult {
  kind: 'source' | 'document';
  id: string;
  sourceId?: string;
  title: string;
  subtitle: string;
  extra: string;
  snippet?: TextSnippet;
  score: number;
  matchedIn: string;
}

export interface MelodyMatchOccurrence {
  startNoteIndex: number;
  endNoteIndex: number;
  distance: number;
  startPct: number;
  endPct: number;
  widthPct: number;
  pitchKey: string;
  color: string;
  border: string;
  name: string;
  noteUUIDs?: string[];
  matchedPitches?: string[];
  matchedIntervals?: string[];
}

export const WILDCARD_COLORS = [
  '#d946ef',
  '#06b6d4',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
];

export interface DistributionItem {
  label: string;
  count: number;
  pct: number;
}

export interface AxisBin {
  label: string;
  count: number;
  pct: number;
  x: number;
  width: number;
}

export interface WildcardStat {
  tokenIndex: number;
  patternToken: string;
  color: string;
  label: string;
  shortLabel: string;
  totalMatches: number;
  pitchDist: DistributionItem[];
  intervalDist: DistributionItem[];
  pitchAxisBins: AxisBin[];
  intervalAxisBins: AxisBin[];
  hoveredBin?: AxisBin | null;
}

export interface MelodyResult {
  document: Document;
  sourceSigle: string;
  noteCount: number;
  matchingSyllables: VM.Syllable[];
  matchSylSet: Set<string>;
  matchNoteSet: Set<string>;
  distance?: number;
  occurrences: MelodyMatchOccurrence[];
  noteSequenceLabel?: string;
  docColor?: string;
  isDocGroupStart?: boolean;
  docGroupCount?: number;
}

export interface HighlightColorInfo {
  fill: string;
  stroke: string;
}

export interface DocumentHighlightState {
  documentId: string;
  patternLabel: string;
  occurrences: MelodyMatchOccurrence[];
  allNoteUUIDMap: Map<string, HighlightColorInfo>;
}

export const OCCURRENCE_COLORS = [
  { color: '#ef4444', border: '#dc2626', name: 'red' },
  { color: '#3b82f6', border: '#2563eb', name: 'blue' },
  { color: '#10b981', border: '#059669', name: 'green' },
  { color: '#8b5cf6', border: '#7c3aed', name: 'purple' },
  { color: '#f97316', border: '#ea580c', name: 'orange' },
  { color: '#06b6d4', border: '#0891b2', name: 'cyan' },
];

export const DOC_ACCENT_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
  '#ca8a04',
];

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

export function sequenceDistance(s1: string[], s2: string[]): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }

  dp[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    const patTok = s2[j - 1].toLowerCase();
    const skipCost = (patTok === '.?' || patTok === '?') ? 0 : 1;
    dp[0][j] = dp[0][j - 1] + skipCost;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const patTok = s2[j - 1].toLowerCase();
      const seqTok = s1[i - 1].toLowerCase();

      const isMatch = (patTok === '.' || patTok === '.?' || patTok === '?' || seqTok === patTok);
      const cost = isMatch ? 0 : 1;
      const skipCost = (patTok === '.?' || patTok === '?') ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + skipCost,
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

  let optCount = 0;
  for (const t of pattern) {
    if (t === '.?' || t === '?') optCount++;
  }

  const matches: SequenceMatch[] = [];

  for (let start = 0; start < M; start++) {
    const minLen = Math.max(1, N - optCount - maxDistance);
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

export function parseMelodyPattern(raw: string, searchType: 'pitch' | 'contour' | 'interval', withOctave: boolean): string[] {
  const clean = raw.trim();
  if (!clean) return [];

  if (searchType === 'contour') {
    const tokens: string[] = [];
    const regex = /(\.\?|\.|\s+|[udrUDR])/g;
    let m;
    while ((m = regex.exec(clean)) !== null) {
      const tok = m[1].trim();
      if (tok) tokens.push((tok === '.?' || tok === '?') ? '.?' : tok.toLowerCase());
    }
    return tokens;
  }

  if (searchType === 'interval') {
    const tokens: string[] = [];
    const regex = /(\.\?|\.|[+-]?\d+)/g;
    let m;
    while ((m = regex.exec(clean)) !== null) {
      const tok = m[1];
      if (tok === '.?' || tok === '?') tokens.push('.?');
      else if (tok === '.') tokens.push('.');
      else {
        const num = parseInt(tok, 10);
        tokens.push(num > 0 ? `+${num}` : `${num}`);
      }
    }
    return tokens;
  }

  const noteRegex = /(\.\?|\.)|(?:([bB])([b#♭♯]?)|([ac-ghAC-GH])([#♭♯]?))([0-9]?)/g;
  const matches: string[] = [];
  let match;
  
  while ((match = noteRegex.exec(clean)) !== null) {
    if (match[1]) {
      matches.push(match[1]);
      continue;
    }
    const isB = match[2] !== undefined;
    const base = (isB ? match[2] : match[4]).toLowerCase();
    const accidental = (isB ? match[3] : match[5]) || '';
    const octave = match[6] || '';

    let note = base;
    if (note === 'h') {
      note = 'b';
    } else if (note === 'b') {
      note = 'bb';
    }

    let accNorm = accidental.replace(/♭/g, 'b').replace(/♯/g, '#');

    if (accNorm) {
      if (note === 'bb' && accNorm === 'b') {
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

function pitchPatternToIntervals(pattern: string[]): string[] {
  const intervals: string[] = [];
  let currentOctave = 4;
  let prevVal: number | null = null;

  for (const token of pattern) {
    if (token === '.' || token === '.?' || token === '?') {
      intervals.push(token);
      continue;
    }

    const match = token.match(/^([a-g]|bb)(#|b)?(\d)?$/i);
    if (!match) continue;
    let base = match[1].toUpperCase();
    if (base === 'BB') base = 'B';
    const explicitOctave = match[3] ? parseInt(match[3], 10) : undefined;
    const baseIdx = (VM.baseNoteIndexes as any)[base] ?? 0;

    let octave = explicitOctave;
    if (octave === undefined) {
      if (prevVal === null) {
        octave = 4;
      } else {
        let bestOct = currentOctave;
        let minDiff = Infinity;
        for (const testOct of [currentOctave - 1, currentOctave, currentOctave + 1]) {
          const testVal = testOct * 7 + baseIdx;
          const diff = Math.abs(testVal - prevVal);
          if (diff < minDiff) {
            minDiff = diff;
            bestOct = testOct;
          }
        }
        octave = bestOct;
      }
    }
    currentOctave = octave;

    const val = octave * 7 + baseIdx;
    if (prevVal !== null) {
      const diff = val - prevVal;
      intervals.push(diff > 0 ? `+${diff}` : `${diff}`);
    }
    prevVal = val;
  }
  return intervals;
}

const PITCH_AXIS = ['F3', 'G3', 'A3', 'Bb3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'Bb4', 'B4', 'C5', 'D5', 'E5', 'F5'];
const INTERVAL_AXIS = ['-7', '-6', '-5', '-4', '-3', '-2', '-1', '0', '+1', '+2', '+3', '+4', '+5', '+6', '+7'];

function buildPitchAxisBins(counts: Map<string, number>, total: number): AxisBin[] {
  const nBins = PITCH_AXIS.length;
  const canvasW = 190;
  const colW = canvasW / nBins;
  const barW = Math.max(3, colW - 1);

  const binCounts = new Map<string, number>();
  PITCH_AXIS.forEach(p => binCounts.set(p, 0));

  for (const [pitch, count] of counts.entries()) {
    let norm = pitch.toUpperCase().replace(/BB/g, 'Bb');
    if (binCounts.has(norm)) {
      binCounts.set(norm, (binCounts.get(norm) || 0) + count);
    } else {
      const baseOnly = norm.replace(/\d+/g, '');
      const matchKey = PITCH_AXIS.find(p => p.startsWith(baseOnly));
      if (matchKey) {
        binCounts.set(matchKey, (binCounts.get(matchKey) || 0) + count);
      }
    }
  }

  return PITCH_AXIS.map((pLabel, i) => {
    const count = binCounts.get(pLabel) || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return {
      label: pLabel,
      count,
      pct,
      x: Math.round(i * colW * 10) / 10,
      width: Math.round(barW * 10) / 10
    };
  });
}

function buildIntervalAxisBins(counts: Map<string, number>, total: number): AxisBin[] {
  const nBins = INTERVAL_AXIS.length;
  const canvasW = 190;
  const colW = canvasW / nBins;
  const barW = Math.max(3, colW - 1);

  const binCounts = new Map<string, number>();
  INTERVAL_AXIS.forEach(inv => binCounts.set(inv, 0));

  for (const [inv, count] of counts.entries()) {
    if (binCounts.has(inv)) {
      binCounts.set(inv, (binCounts.get(inv) || 0) + count);
    }
  }

  return INTERVAL_AXIS.map((invLabel, i) => {
    const count = binCounts.get(invLabel) || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return {
      label: invLabel,
      count,
      pct,
      x: Math.round(i * colW * 10) / 10,
      width: Math.round(barW * 10) / 10
    };
  });
}

function findTextSnippet(text: string, query: string, window = 35): TextSnippet | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return undefined;

  let before = text.slice(Math.max(0, idx - window), idx);
  if (idx - window > 0) before = '…' + before.replace(/^\S+\s/, '');

  const match = text.slice(idx, idx + query.length);

  let after = text.slice(idx + query.length, idx + query.length + window);
  if (idx + query.length + window < text.length) after = after.replace(/\s\S+$/, '') + '…';

  return { before, match, after };
}

function walkZeilen(children: any[], cb: (zeile: any) => void) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child?.kind === 'ZeileContainer') cb(child);
    else if (Array.isArray(child?.children)) walkZeilen(child.children, cb);
  }
}

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

@Injectable({
  providedIn: 'root'
})
export class SearchExecService {
  stateChanged$ = new Subject<void>();

  // Cached parameters
  cachedQuickText = '';
  cachedQuickResults: QuickResult[] = [];
  cachedQuickSearched = false;
  cachedQuickMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  cachedQuickTolerance = true;
  cachedQuickDistance = 2;

  // Search execution states
  searchProgress = { current: 0, total: 0, matched: 0 };
  searchCancelled = false;

  // Active persistent document highlights from search
  activeDocumentHighlight: DocumentHighlightState | null = null;

  setDocumentHighlight(highlight: DocumentHighlightState): void {
    this.activeDocumentHighlight = highlight;
    this.notifyChange();
  }

  clearDocumentHighlight(): void {
    this.activeDocumentHighlight = null;
    this.notifyChange();
  }

  getNoteHighlightColor(docId: string | undefined, noteUuid: string | undefined): HighlightColorInfo | null {
    if (!this.activeDocumentHighlight || !docId || !noteUuid) return null;
    if (this.activeDocumentHighlight.documentId !== docId) return null;
    return this.activeDocumentHighlight.allNoteUUIDMap.get(noteUuid) || null;
  }

  quickText = '';
  quickResults: QuickResult[] = [];
  quickSearched = false;
  quickSearching = false;
  quickSearchMode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy' = 'phrase';
  quickMedievalTolerance = true;
  quickFuzzyDistance = 2;
  quickPage = 1;
  quickPageSize = 25;

  sourceQuery: SourceQuery = {};
  sourceResults: Source[] = [];
  sourceSearched = false;
  sourceSearching = false;
  sourcesPage = 1;
  sourcesPageSize = 25;

  documentQuery: DocumentQuery = {
    dokumenten_id: undefined, gattung1: undefined, gattung2: undefined,
    festtag: undefined, feier: undefined, textinitium: undefined,
    bibliographischerverweis: undefined, druckausgabe: undefined,
    zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
  };
  documentResults: Document[] = [];
  documentSearched = false;
  documentSearching = false;
  documentsPage = 1;
  documentsPageSize = 25;

  melodyPattern = '';
  melodySearchType: 'pitch' | 'contour' | 'interval' = 'pitch';
  melodyWithOctave = false;
  melodyIncludeTransposed = false;
  melodyOnlyWithinSyllables = false;
  melodyRangeStartPct = 0;
  melodyRangeEndPct = 100;
  melodyResults: MelodyResult[] = [];
  wildcardStats: WildcardStat[] = [];
  melodySearched = false;
  melodySearching = false;
  melodyScanned = 0;
  melodyWithNotes = 0;
  melodyMaxDistance = 0;
  melodyPage = 1;
  melodyPageSize = 10;

  user: User | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: APIService,
    private userService: UserService,
    private patternSvc: PatternAnalysisService
  ) {
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
    }));
  }

  notifyChange() {
    this.stateChanged$.next();
  }

  matchText(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
    return matchTextInternal(text, query, mode, spellingTolerance, maxDistance);
  }

  async searchQuick(
    addRecentSearch: (q: string) => void,
    onFilterReset: () => void
  ) {
    if (!this.user || !this.quickText.trim()) return;

    if (
      this.cachedQuickSearched &&
      this.cachedQuickText === this.quickText &&
      this.cachedQuickMode === this.quickSearchMode &&
      this.cachedQuickTolerance === this.quickMedievalTolerance &&
      this.cachedQuickDistance === this.quickFuzzyDistance
    ) {
      this.quickResults = this.cachedQuickResults.slice();
      this.quickSearched = true;
      this.searchProgress = { current: this.quickResults.length, total: this.quickResults.length, matched: this.quickResults.length };
      this.notifyChange();
      return;
    }

    this.quickSearching = true;
    this.quickSearched = false;
    this.searchCancelled = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.quickPage = 1;
    onFilterReset();
    addRecentSearch(this.quickText);
    this.notifyChange();

    try {
      const [sources, docs] = await Promise.all([
        this.api.listSources(this.user.token).toPromise(),
        this.api.listDocuments(this.user.token).toPromise(),
      ]);

      const results: QuickResult[] = [];

      if (sources?.kind === 'SourcesRetrieved') {
        for (const s of sources.sources) {
          if (this.searchCancelled) { this.finishQuickSearch(results); return; }
          let bestMatch: {score: number, matchedIn: string} | null = null;
          
          const metaMap: {[key: string]: string} = {
            'Siglum': s.quellensigle || s.bibliothekssignatur || '',
            'Institution': s.herkunftsinstitution || '',
            'Location': s.herkunftsort || '',
            'Type': s.quellentyp || '',
            'Dating': s.datierung || ''
          };

          for (const [key, val] of Object.entries(metaMap)) {
            if (typeof val === 'string' && val.trim() !== '') {
               const res = matchTextInternal(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
               if (res.matched && (!bestMatch || res.score > bestMatch.score)) {
                 const finalScore = key === 'Siglum' ? Math.min(100, res.score + 5) : res.score;
                 bestMatch = { score: finalScore, matchedIn: key };
               }
            }
          }
          
          if (bestMatch) {
            results.push({
              kind: 'source', id: s.id!,
              title:    s.quellensigle || s.bibliothekssignatur || '(no siglum)',
              subtitle: [s.herkunftsinstitution, s.herkunftsort].filter(Boolean).join(', '),
              extra:    [s.quellentyp, s.datierung].filter(Boolean).join(' · '),
              score: bestMatch.score,
              matchedIn: `Metadata: ${bestMatch.matchedIn}`,
            });
          }
        }
      }

      const allDocs = docs?.kind === 'DocumentsRetrieved' ? docs.documents : [];
      this.searchProgress = { current: 0, total: allDocs.length, matched: results.length };
      this.notifyChange();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishQuickSearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (d) => {
          let bestMeta: {score: number, matchedIn: string, snippet?: TextSnippet} | null = null;
          const dMap: {[key: string]: string} = {
            'Incipit': d.textinitium || '',
            'Doc ID': d.dokumenten_id || '',
            'Genre': d.gattung1 || d.gattung2 || '',
            'Feast': d.festtag || '',
            'Celebration': d.feier || ''
          };
          for (const [key, val] of Object.entries(dMap)) {
            if (typeof val === 'string' && val.trim() !== '') {
               const m = matchTextInternal(val, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
               if (m.matched && (!bestMeta || m.score > bestMeta.score)) {
                  const finalScore = key === 'Incipit' ? Math.min(100, m.score + 5) : m.score;
                  bestMeta = { score: finalScore, matchedIn: key, snippet: m.snippet };
               }
            }
          }

          let bestSyl: {score: number, matchedIn: string, snippet?: TextSnippet} | null = null;
          try {
            const root = await NotesStore.get(d.id);
            if (root) {
              const sylsList = extractSyllables(root).map(s => s.text);
              const sylRaw    = sylsList.join('');
              const sylClean  = sylRaw.replace(/-/g, '');
              const sylSpaced = sylsList.join(' ').replace(/-/g, ' ');
              const ms1 = matchTextInternal(sylSpaced, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance);
              const ms2 = !ms1.matched ? matchTextInternal(sylClean, this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms1;
              const ms3 = !ms2.matched ? matchTextInternal(sylRaw,    this.quickText, this.quickSearchMode, this.quickMedievalTolerance, this.quickFuzzyDistance) : ms2;
              
              const bestM = ms1.matched ? ms1 : ms2.matched ? ms2 : ms3.matched ? ms3 : null;
              if (bestM) {
                 bestSyl = { score: bestM.score, matchedIn: 'Transcription', snippet: bestM.snippet };
              }
            }
          } catch (e) {
            console.warn(`Skipping notes for ${d.id}:`, e);
          }

          const bestOverall = (bestMeta && bestSyl) ? (bestMeta.score >= bestSyl.score ? bestMeta : bestSyl) : (bestMeta || bestSyl);

          if (bestOverall) {
            results.push({
              kind: 'document', id: d.id, sourceId: d.quelle_id,
              title:    d.textinitium || d.dokumenten_id || '(no incipit)',
              subtitle: [d.gattung1, d.gattung2].filter(Boolean).join(' / '),
              extra:    [d.festtag, d.feier].filter(Boolean).join(' · '),
              snippet:  bestOverall.snippet,
              score:    bestOverall.score,
              matchedIn: bestOverall.matchedIn === 'Transcription' ? 'Transcription' : `Metadata: ${bestOverall.matchedIn}`
            });
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, allDocs.length);
        this.searchProgress.current = currentProgress;
        this.searchProgress.matched = results.length;
        this.quickResults = results.slice();
        this.notifyChange();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      this.finishQuickSearch(results);
    } catch (err) {
      console.error('Quick search failed:', err);
      this.quickSearching = false;
      this.quickSearched = true;
      this.notifyChange();
    }
  }

  private finishQuickSearch(results: QuickResult[]): void {
    results.sort((a, b) => b.score - a.score);
    this.quickResults = results;
    this.quickSearched = true;
    this.quickSearching = false;

    this.cachedQuickText = this.quickText;
    this.cachedQuickMode = this.quickSearchMode;
    this.cachedQuickTolerance = this.quickMedievalTolerance;
    this.cachedQuickDistance = this.quickFuzzyDistance;
    this.cachedQuickResults = this.quickResults.slice();
    this.cachedQuickSearched = true;

    this.saveSearchStateToIndexedDB();
    this.notifyChange();
  }

  searchSources() {
    if (!this.user) return;
    this.sourceSearching = true;
    this.sourceSearched = false;
    this.sourcesPage = 1;
    this.api.querySources(this.user.token, this.sourceQuery).subscribe(res => {
      if (res.kind === 'SourcesRetrieved') this.sourceResults = res.sources;
      this.sourceSearched = true;
      this.sourceSearching = false;
      this.saveSearchStateToIndexedDB();
      this.notifyChange();
    });
  }

  searchDocuments() {
    if (!this.user) return;
    this.documentSearching = true;
    this.documentSearched = false;
    this.documentsPage = 1;
    this.api.queryDocuments(this.user.token, this.documentQuery).subscribe(res => {
      if (res.kind === 'DocumentsRetrieved') this.documentResults = res.documents;
      this.documentSearched = true;
      this.documentSearching = false;
      this.saveSearchStateToIndexedDB();
      this.notifyChange();
    });
  }

  async searchMelody() {
    if (!this.user || !this.melodyPattern.trim()) return;
    this.melodySearching  = true;
    this.melodySearched   = false;
    this.melodyScanned    = 0;
    this.melodyWithNotes  = 0;
    this.searchCancelled  = false;
    this.searchProgress = { current: 0, total: 0, matched: 0 };
    this.melodyPage = 1;

    const pattern = parseMelodyPattern(this.melodyPattern, this.melodySearchType, this.melodyWithOctave);
    const useTransposedPitch = (this.melodySearchType === 'pitch' && this.melodyIncludeTransposed);
    const effectivePattern = useTransposedPitch ? pitchPatternToIntervals(pattern) : pattern;

    try {
      const [docsRes, sourcesRes] = await Promise.all([
        this.api.listDocuments(this.user.token).toPromise(),
        this.api.listSources(this.user.token).toPromise(),
      ]);
      const allDocs    = docsRes?.kind    === 'DocumentsRetrieved' ? docsRes.documents  : [];
      const allSources = sourcesRes?.kind === 'SourcesRetrieved'   ? sourcesRes.sources : [];
      const sourceMap  = new Map<string, Source>(allSources.map(s => [s.id ?? '', s]));
      const results: MelodyResult[] = [];

      this.melodyScanned = allDocs.length;
      this.searchProgress = { current: 0, total: allDocs.length, matched: 0 };
      this.notifyChange();

      const BATCH_SIZE = 100;
      for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
        if (this.searchCancelled) { this.finishMelodySearch(results); return; }
        
        const batch = allDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (doc) => {
          let root: VM.RootContainer | null = null;
          try { root = await NotesStore.get(doc.id); }
          catch (e) { console.warn(`Skipping ${doc.id}:`, e); }

          if (root) {
            const syllables = extractSyllables(root);
            const { notes, sylIdx } = flattenNotes(syllables);
            if (notes.length > 0) {
              this.melodyWithNotes++;

              const sequence = (this.melodySearchType === 'pitch' && !useTransposedPitch)
                ? toPitchNames(notes, this.melodyWithOctave)
                : this.melodySearchType === 'contour'
                ? toContour(notes)
                : toIntervals(notes);

              let matches = findSubsequenceMatches(sequence, effectivePattern, this.melodyMaxDistance);
              if (this.melodyOnlyWithinSyllables) {
                matches = matches.filter(m => {
                  const startNote = m.start;
                  const endNote = (this.melodySearchType === 'contour' || this.melodySearchType === 'interval' || useTransposedPitch) ? m.end + 1 : m.end;
                  return sylIdx[startNote] === sylIdx[endNote];
                });
              }

              if (this.melodyRangeStartPct > 0 || this.melodyRangeEndPct < 100) {
                const totalNotes = Math.max(1, notes.length);
                matches = matches.filter(m => {
                  const startNote = m.start;
                  const endNote = (this.melodySearchType === 'contour' || this.melodySearchType === 'interval' || useTransposedPitch) ? m.end + 1 : m.end;
                  const matchStartPct = (startNote / totalNotes) * 100;
                  const matchEndPct = (endNote / totalNotes) * 100;
                  return matchStartPct >= (this.melodyRangeStartPct - 0.1) && matchEndPct <= (this.melodyRangeEndPct + 0.1);
                });
              }

              if (matches.length > 0) {
                const groupsByPitch = new Map<string, typeof matches>();
                if (this.melodySearchType === 'contour' || this.melodySearchType === 'interval' || useTransposedPitch) {
                  for (const m of matches) {
                    const startNote = m.start;
                    const endNote = m.end + 1;
                    const matchedNotes = notes.slice(startNote, Math.min(notes.length, endNote + 1));
                    const key = matchedNotes.map(n => n.base.toUpperCase() + (n.octave !== undefined ? n.octave : '')).join(' ');
                    if (!groupsByPitch.has(key)) groupsByPitch.set(key, []);
                    groupsByPitch.get(key)!.push(m);
                  }
                } else {
                  groupsByPitch.set(pattern.join(' ').toUpperCase(), matches);
                }

                let colorIdx = 0;
                for (const [pitchKey, matchGroup] of groupsByPitch.entries()) {
                  const matchSylSet = new Set<string>();
                  const matchNoteSet = new Set<string>();
                  const allMatchingSylIndices: number[] = [];

                  const occurrences: MelodyMatchOccurrence[] = matchGroup.map(m => {
                    const startNote = m.start;
                    const endNote = (this.melodySearchType === 'contour' || this.melodySearchType === 'interval' || useTransposedPitch)
                      ? m.end + 1
                      : m.end;

                    for (let ni = startNote; ni <= endNote && ni < sylIdx.length; ni++) {
                      const syl = syllables[sylIdx[ni]];
                      if (syl?.uuid) matchSylSet.add(syl.uuid);
                      allMatchingSylIndices.push(sylIdx[ni]);
                    }

                    const occNoteUUIDs: string[] = [];
                    for (let ni = startNote; ni <= endNote && ni < notes.length; ni++) {
                      const note = notes[ni];
                      if (note?.uuid) {
                        matchNoteSet.add(note.uuid);
                        occNoteUUIDs.push(note.uuid);
                      }
                    }

                    const totalNotes = Math.max(1, notes.length);
                    const startPct = Math.round((startNote / totalNotes) * 1000) / 10;
                    const endPct   = Math.round((endNote / totalNotes) * 1000) / 10;
                    const widthPct = Math.max(3, Math.round(((endNote - startNote + 1) / totalNotes) * 1000) / 10);
                    const cObj = OCCURRENCE_COLORS[colorIdx % OCCURRENCE_COLORS.length];
                    colorIdx++;

                    const matchedNotes = notes.slice(startNote, Math.min(notes.length, endNote + 1));
                    const matchedPitches = matchedNotes.map(n => n.base.toUpperCase() + (this.melodyWithOctave && n.octave !== undefined ? n.octave : ''));
                    const matchedIntervals = toIntervals(matchedNotes);

                    return {
                      startNoteIndex: startNote,
                      endNoteIndex: endNote,
                      distance: m.distance,
                      startPct,
                      endPct,
                      widthPct,
                      pitchKey,
                      color: cObj.color,
                      border: cObj.border,
                      name: cObj.name,
                      noteUUIDs: occNoteUUIDs,
                      matchedPitches,
                      matchedIntervals
                    };
                  });

                  const bestDistance = Math.min(...matchGroup.map(m => m.distance));

                  const matchSylMin = Math.min(...allMatchingSylIndices);
                  const matchSylMax = Math.max(...allMatchingSylIndices);
                  const ctxFirst = Math.max(0, matchSylMin - 2);
                  const ctxLast  = Math.min(syllables.length - 1, matchSylMax + 2);
                  const contextSyllables = syllables.slice(ctxFirst, ctxLast + 1);

                  results.push({
                    document:   doc,
                    sourceSigle: sourceMap.get(doc.quelle_id)?.quellensigle ?? '',
                    noteCount:  notes.length,
                    matchingSyllables: contextSyllables,
                    matchSylSet,
                    matchNoteSet,
                    distance: bestDistance,
                    occurrences,
                    noteSequenceLabel: (this.melodySearchType === 'contour' || this.melodySearchType === 'interval') ? pitchKey : undefined
                  });
                }
              }
            }
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, allDocs.length);
        this.searchProgress.current = currentProgress;
        this.searchProgress.matched = results.length;
        this.finishMelodySearch(results);
        this.notifyChange();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      this.finishMelodySearch(results);
    } catch (err) {
      console.error('Melody search failed:', err);
      this.melodySearching = false;
      this.melodySearched = true;
      this.notifyChange();
    }
  }

  private finishMelodySearch(results: MelodyResult[]): void {
    const docColorMap = new Map<string, string>();
    let docColorIdx = 0;

    results.sort((a, b) => {
      const docCompare = a.document.id.localeCompare(b.document.id);
      if (docCompare !== 0) return docCompare;
      return (a.distance ?? 0) - (b.distance ?? 0);
    });

    for (let r = 0; r < results.length; r++) {
      const res = results[r];
      if (!docColorMap.has(res.document.id)) {
        docColorMap.set(res.document.id, DOC_ACCENT_COLORS[docColorIdx % DOC_ACCENT_COLORS.length]);
        docColorIdx++;
      }
      res.docColor = docColorMap.get(res.document.id);

      const isFirst = (r === 0 || results[r - 1].document.id !== res.document.id);
      res.isDocGroupStart = isFirst;
      if (isFirst) {
        let count = 0;
        for (let k = r; k < results.length && results[k].document.id === res.document.id; k++) {
          count++;
        }
        res.docGroupCount = count;
      }
    }

    // Compute wildcard match distributions for '.' and '.?'
    const wildcardIndices: { idx: number; token: string }[] = [];
    const parsedPattern = parseMelodyPattern(this.melodyPattern, this.melodySearchType, this.melodyWithOctave);
    parsedPattern.forEach((tok, i) => {
      if (tok === '.' || tok === '.?' || tok === '?') {
        wildcardIndices.push({ idx: i, token: tok });
      }
    });

    if (wildcardIndices.length > 0) {
      this.wildcardStats = wildcardIndices.map((wObj, wIdx) => {
        const pitchCounts = new Map<string, number>();
        const intervalCounts = new Map<string, number>();
        let totalMatches = 0;

        for (const res of results) {
          for (const occ of res.occurrences) {
            if (occ.matchedPitches && wObj.idx < occ.matchedPitches.length) {
              const p = occ.matchedPitches[wObj.idx];
              if (p) {
                pitchCounts.set(p, (pitchCounts.get(p) || 0) + 1);
                totalMatches++;
              }
            }
            if (occ.matchedIntervals && wObj.idx < occ.matchedIntervals.length) {
              const inv = occ.matchedIntervals[wObj.idx];
              if (inv) {
                intervalCounts.set(inv, (intervalCounts.get(inv) || 0) + 1);
              }
            }
          }
        }

        const total = Math.max(1, totalMatches);

        const pitchDist: DistributionItem[] = Array.from(pitchCounts.entries())
          .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
          .sort((a, b) => b.count - a.count);

        const intervalDist: DistributionItem[] = Array.from(intervalCounts.entries())
          .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
          .sort((a, b) => b.count - a.count);

        const pitchAxisBins = buildPitchAxisBins(pitchCounts, total);
        const intervalAxisBins = buildIntervalAxisBins(intervalCounts, total);
        const color = WILDCARD_COLORS[wIdx % WILDCARD_COLORS.length];

        return {
          tokenIndex: wObj.idx,
          patternToken: wObj.token,
          color,
          label: `Wildcard #${wIdx + 1} (Pos ${wObj.idx + 1})`,
          shortLabel: `.${wIdx + 1}`,
          totalMatches,
          pitchDist,
          intervalDist,
          pitchAxisBins,
          intervalAxisBins
        };
      });
    } else {
      this.wildcardStats = [];
    }

    this.melodyResults  = results;
    this.melodySearched = true;
    this.melodySearching = false;
    this.saveSearchStateToIndexedDB();
    this.notifyChange();
  }

  cancelSearch(): void {
    this.searchCancelled = true;
    this.notifyChange();
  }

  activeTab: 'quick' | 'sources' | 'documents' | 'melody' = 'quick';

  async saveSearchStateToIndexedDB(activeTab?: string) {
    try {
      const searchData = {
        activeTab: activeTab || this.activeTab,
        quickText: this.quickText,
        quickPage: this.quickPage,
        sourcesPage: this.sourcesPage,
        documentsPage: this.documentsPage,
        melodyPage: this.melodyPage,
        quickSearchMode: this.quickSearchMode,
        quickMedievalTolerance: this.quickMedievalTolerance,
        quickFuzzyDistance: this.quickFuzzyDistance,
        sourceQuery: this.sourceQuery,
        documentQuery: this.documentQuery,
        melodyPattern: this.melodyPattern,
        melodySearchType: this.melodySearchType,
        melodyWithOctave: this.melodyWithOctave,
        melodyOnlyWithinSyllables: this.melodyOnlyWithinSyllables,
        melodyMaxDistance: this.melodyMaxDistance
      };
      await localforage.setItem('search_state', searchData);
    } catch (e) {
      console.warn('Failed to save search state to IndexedDB:', e);
    }
  }

  async loadFromIndexedDB(
    onRetriggerPatternGrouping: () => void,
    onSetActiveTab: (tab: any) => void
  ) {
    try {
      // 0. Load saved pattern sessions list
      try {
        const saved: any = await localforage.getItem('saved_pattern_sessions');
        if (Array.isArray(saved)) {
          this.patternSvc.savedPatternSessions = saved;
        } else {
          this.patternSvc.savedPatternSessions = [];
        }
      } catch (e) {
        console.warn('Failed to load saved pattern sessions:', e);
        this.patternSvc.savedPatternSessions = [];
      }

      // 1. Load pattern analysis state
      const staticCachePopulated = this.patternSvc.patternGroups.length > 0
                                || this.patternSvc.showPatternAnalysis;

      if (!staticCachePopulated) {
        let savedParams: any = null;
        try {
          const raw = localStorage.getItem('monodi_pattern_params');
          if (raw) savedParams = JSON.parse(raw);
        } catch { /* ignore */ }

        if (savedParams?.showPatternAnalysis) {
          this.patternSvc.patternLength           = savedParams.patternLength           ?? this.patternSvc.patternLength;
          this.patternSvc.patternType             = savedParams.patternType             ?? this.patternSvc.patternType;
          this.patternSvc.patternWithOctave       = !!savedParams.patternWithOctave;
          this.patternSvc.patternStrictness       = savedParams.patternStrictness       ?? this.patternSvc.patternStrictness;
          this.patternSvc.patternMergeEnabled     = !!savedParams.patternMergeEnabled;
          this.patternSvc.patternMinMergeOverlap  = savedParams.patternMinMergeOverlap  ?? this.patternSvc.patternMinMergeOverlap;
          this.patternSvc.patternDeduplicateEnabled = savedParams.patternDeduplicateEnabled !== false;
          this.patternSvc.patternViewMode         = savedParams.patternViewMode         ?? this.patternSvc.patternViewMode;
          this.patternSvc.patternPage             = savedParams.patternPage             ?? 1;
          this.patternSvc.showPatternAnalysis     = true;

          setTimeout(() => {
            if (this.patternSvc.showPatternAnalysis && this.patternSvc.patternGroups.length === 0) {
              onRetriggerPatternGrouping();
            }
          }, 0);
        }
      }

      // 2. Restore only lightweight VIEW PREFERENCES from the last session.
      const searchData: any = await localforage.getItem('search_state');
      if (searchData) {
        if (searchData.activeTab) {
          this.activeTab = searchData.activeTab;
          onSetActiveTab(searchData.activeTab);
        }

        if (searchData.quickSearchMode) this.quickSearchMode = searchData.quickSearchMode;
        this.quickMedievalTolerance = !!searchData.quickMedievalTolerance;
        if (searchData.quickFuzzyDistance !== undefined) this.quickFuzzyDistance = searchData.quickFuzzyDistance;

        if (searchData.melodySearchType) this.melodySearchType = searchData.melodySearchType;
        this.melodyWithOctave = !!searchData.melodyWithOctave;
        this.melodyOnlyWithinSyllables = !!searchData.melodyOnlyWithinSyllables;
        if (searchData.melodyWithNotes !== undefined) this.melodyWithNotes = searchData.melodyWithNotes;
        if (searchData.melodyMaxDistance !== undefined) this.melodyMaxDistance = searchData.melodyMaxDistance;
      }
      this.notifyChange();
    } catch (e) {
      console.warn('Error loading state from IndexedDB:', e);
    }
  }
}

function matchTextInternal(text: string, query: string, mode: 'phrase' | 'words-and' | 'words-or' | 'fuzzy', spellingTolerance: boolean, maxDistance: number): { matched: boolean; snippet?: TextSnippet; score: number } {
  if (!text) return { matched: false, score: 0 };
  const norm = (s: string) => {
    let res = s.toLowerCase();
    if (spellingTolerance) {
      res = res
        .replace(/[jv]/g, char => char === 'j' ? 'i' : 'u')
        .replace(/y/g, 'i')
        .replace(/ae/g, 'e')
        .replace(/(.)\1+/g, '$1');
    }
    return res;
  };

  const targetNorm = norm(text);
  const queryNorm = norm(query);

  if (mode === 'phrase') {
    if (spellingTolerance) {
      const idx = targetNorm.indexOf(queryNorm);
      if (idx !== -1) {
        const matchStart = idx;
        const matchEnd = idx + queryNorm.length;
        const snippet = findTextSnippet(text, text.substring(Math.max(0, matchStart), Math.min(text.length, matchEnd))) || { before: '', match: query, after: '' };
        return { matched: true, snippet, score: 90 };
      }
      return { matched: false, score: 0 };
    } else {
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx !== -1) {
        return { matched: true, snippet: findTextSnippet(text, query), score: 100 };
      }
      return { matched: false, score: 0 };
    }
  }

  if (mode === 'words-and' || mode === 'words-or') {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { matched: false, score: 0 };

    const wordMatches = words.map(w => {
      const wNorm = norm(w);
      return targetNorm.includes(wNorm) || text.toLowerCase().includes(w.toLowerCase());
    });

    const matched = mode === 'words-and' 
      ? wordMatches.every(m => m) 
      : wordMatches.some(m => m);

    if (matched) {
      for (const w of words) {
        const idx = text.toLowerCase().indexOf(w.toLowerCase());
        if (idx !== -1) {
          return { matched: true, snippet: findTextSnippet(text, w), score: mode === 'words-and' ? 80 : 70 };
        }
      }
      return { matched: true, snippet: { before: '', match: text.substring(0, Math.min(text.length, 25)), after: '…' }, score: mode === 'words-and' ? 80 : 70 };
    }
    return { matched: false, score: 0 };
  }

  if (mode === 'fuzzy') {
    const targetWords = text.toLowerCase().split(/\s+/).filter(Boolean);
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return { matched: false, score: 0 };

    const matchedWords = queryWords.map(qw => {
      let bestDist = 999;
      let matchedTargetWord = '';
      for (const tw of targetWords) {
        const res = isFuzzySubstring(norm(tw), norm(qw), maxDistance);
        if (res.matched) {
          const dist = levenshteinDistance(norm(res.matchedSub || ''), norm(qw));
          if (dist < bestDist) {
            bestDist = dist;
            matchedTargetWord = tw;
          }
        }
      }
      return { matched: bestDist <= maxDistance, word: matchedTargetWord, dist: bestDist };
    });

    const matched = queryWords.length > 0 && matchedWords.every(mw => mw.matched);
    if (matched) {
      const avgDist = matchedWords.reduce((sum, mw) => sum + mw.dist, 0) / matchedWords.length;
      const score = Math.max(10, 60 - avgDist * 10);
      
      const firstMatch = matchedWords[0].word;
      if (firstMatch) {
        const origIdx = text.toLowerCase().indexOf(firstMatch);
        const origWord = origIdx !== -1 ? text.substring(origIdx, origIdx + firstMatch.length) : firstMatch;
        const snippet = findTextSnippet(text, origWord);
        return { matched: true, snippet, score };
      }
      return { matched: true, score };
    }
    return { matched: false, score: 0 };
  }

  return { matched: false, score: 0 };
}
