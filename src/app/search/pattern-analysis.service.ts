import { Injectable } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService, Document, Source } from '../api.service';
import { UserService, User } from '../user.service';
import { NotesStore } from '../notes-store';
import * as VM from '../types/model';
import * as localforage from 'localforage';
import {
  LoadedDoc,
  PatternOccurrence,
  PatternGroup,
  toPitchNames,
  toContour,
  toIntervals
} from './pattern-algo';

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
export class PatternAnalysisService {
  stateChanged$ = new Subject<void>();

  // State
  showPatternAnalysis = false;
  patternLength = 8;
  patternType: 'pitch' | 'interval' | 'contour' = 'interval';
  patternWithOctave = false;
  patternStrictness: 'exact' | 'fuzzy' = 'exact';
  patternProgress = { phase: '', current: 0, total: 0, percent: 0 };
  patternSearching = false;
  patternCancelled = false;
  patternGroups: PatternGroup[] = [];
  patternPage = 1;
  patternPageSize = 20;
  patternViewMode: 'list' | 'overview' = 'overview';
  patternTimelineDocs: TimelineDoc[] = [];
  patternDocTotalNotes = new Map<string, number>();
  patternMergeEnabled = false;
  patternMinMergeOverlap = 1;
  patternDeduplicateEnabled = true;
  detectedDuplicates: { doc1: LoadedDoc; doc2: LoadedDoc; similarity: number }[] = [];
  patternWorker: Worker | null = null;
  savedPatternSessions: { id: string; name: string; date: number; data: any }[] = [];

  user: User | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: APIService,
    private userService: UserService,
    private toastr: ToastrService
  ) {
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
    }));
  }

  notifyChange() {
    this.stateChanged$.next();
  }

  async runPatternGrouping(
    activeTab: string,
    filteredQuickResults: any[],
    filteredSourceResults: any[],
    filteredDocumentResults: any[],
    filteredMelodyResults: any[]
  ) {
    if (!this.user) return;
    this.patternSearching = true;
    this.patternCancelled = false;
    this.patternGroups = [];
    this.patternPage = 1;
    this.patternProgress = { phase: 'Initializing...', current: 0, total: 0, percent: 0 };
    this.notifyChange();

    try {
      this.patternProgress.phase = 'Loading library metadata...';
      this.notifyChange();
      
      const [docsRes, sourcesRes] = await Promise.all([
        this.api.listDocuments(this.user.token).toPromise(),
        this.api.listSources(this.user.token).toPromise()
      ]);

      if (this.patternCancelled) return;

      const allDocs = docsRes?.kind === 'DocumentsRetrieved' ? docsRes.documents : [];
      const allSources = sourcesRes?.kind === 'SourcesRetrieved' ? sourcesRes.sources : [];
      
      const docMap = new Map<string, Document>(allDocs.map(d => [d.id!, d]));
      const sourceMap = new Map<string, Source>(allSources.map(s => [s.id!, s]));

      let targetDocs: { doc: Document; sourceSigle: string }[] = [];

      if (activeTab === 'quick') {
        const docResults = filteredQuickResults.filter(r => r.kind === 'document');
        for (const qr of docResults) {
          const doc = docMap.get(qr.id);
          if (doc) {
            const sigle = sourceMap.get(doc.quelle_id)?.quellensigle ?? '';
            targetDocs.push({ doc, sourceSigle: sigle });
          }
        }
      } else if (activeTab === 'sources') {
        const sourceIds = new Set(filteredSourceResults.map(s => s.id));
        for (const doc of allDocs) {
          if (sourceIds.has(doc.quelle_id)) {
            const sigle = sourceMap.get(doc.quelle_id)?.quellensigle ?? '';
            targetDocs.push({ doc, sourceSigle: sigle });
          }
        }
      } else if (activeTab === 'documents') {
        for (const d of filteredDocumentResults) {
          const sigle = sourceMap.get(d.quelle_id)?.quellensigle ?? '';
          targetDocs.push({ doc: d, sourceSigle: sigle });
        }
      } else if (activeTab === 'melody') {
        for (const mr of filteredMelodyResults) {
          const sigle = mr.sourceSigle || (sourceMap.get(mr.document.quelle_id)?.quellensigle ?? '');
          targetDocs.push({ doc: mr.document, sourceSigle: sigle });
        }
      }

      if (targetDocs.length === 0) {
        this.patternProgress = { phase: 'No documents in results to analyze', current: 0, total: 0, percent: 100 };
        this.patternSearching = false;
        this.updatePatternCache();
        this.notifyChange();
        return;
      }

      this.patternProgress = { phase: 'Loading document melodies...', current: 0, total: targetDocs.length, percent: 0 };
      this.notifyChange();

      const loadedDocs: LoadedDoc[] = [];

      const BATCH_SIZE = 100;
      for (let i = 0; i < targetDocs.length; i += BATCH_SIZE) {
        if (this.patternCancelled) return;
        
        const batch = targetDocs.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (target) => {
          try {
            const root = await NotesStore.get(target.doc.id);
            if (root) {
              const syllables = extractSyllables(root);
              const { notes, sylIdx } = flattenNotes(syllables);
              if (notes.length > 0) {
                let sequence: string[] = [];
                if (this.patternType === 'pitch') {
                  sequence = toPitchNames(notes, this.patternWithOctave);
                } else if (this.patternType === 'contour') {
                  sequence = toContour(notes);
                } else if (this.patternType === 'interval') {
                  sequence = toIntervals(notes);
                }

                loadedDocs.push({
                  doc: target.doc,
                  sourceSigle: target.sourceSigle,
                  notes,
                  syllables,
                  sylIdx,
                  sequence
                });
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch notes for ${target.doc.id}:`, e);
          }
        });

        await Promise.all(promises);

        const currentProgress = Math.min(i + BATCH_SIZE, targetDocs.length);
        this.patternProgress.current = currentProgress;
        this.patternProgress.percent = Math.round((currentProgress / targetDocs.length) * 100);
        this.notifyChange();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (this.patternCancelled) return;

      if (loadedDocs.length === 0) {
        this.patternProgress = { phase: 'No melodies with notes found', current: 0, total: 0, percent: 100 };
        this.patternSearching = false;
        this.updatePatternCache();
        this.notifyChange();
        return;
      }

      this.patternProgress.phase = 'Handing analysis to background worker…';
      this.patternProgress.percent = 0;
      this.notifyChange();
      await new Promise(resolve => setTimeout(resolve, 0));

      this.detectedDuplicates = [];
      this.patternDocTotalNotes.clear();
      for (const ld of loadedDocs) {
        this.patternDocTotalNotes.set(ld.doc.id!, ld.notes.length);
      }

      if (this.patternWorker) {
        this.patternWorker.terminate();
      }

      this.patternWorker = new Worker(new URL('./pattern.worker', import.meta.url), { type: 'module' });

      this.patternWorker.onmessage = ({ data }) => {
        if (this.patternCancelled) {
          if (this.patternWorker) {
            this.patternWorker.terminate();
            this.patternWorker = null;
          }
          return;
        }

        if (data.kind === 'progress') {
          this.patternProgress = {
            phase:   data.phase,
            current: data.current,
            total:   data.total,
            percent: data.percent,
          };
          this.notifyChange();
          return;
        }

        if (data.kind === 'success') {
          const groups = data.groups;
          this.patternGroups = groups;
          this.detectedDuplicates = data.detectedDuplicates || [];
          if (this.patternDeduplicateEnabled && Array.isArray(data.excludedDocIds)) {
            for (const id of data.excludedDocIds as string[]) {
              this.patternDocTotalNotes.delete(id);
            }
          }

          this.patternTimelineDocs = data.patternTimelineDocs || [];
          this.patternSearching = false;
          this.patternProgress = { phase: 'Analysis completed successfully', current: groups.length, total: groups.length, percent: 100 };
          this.updatePatternCache();
          this.notifyChange();
        } else {
          console.error('Worker reported error:', data.error);
          this.patternSearching = false;
          this.patternProgress.phase = 'Failed with error: ' + data.error;
          this.updatePatternCache();
          this.notifyChange();
        }

        if (this.patternWorker) {
          this.patternWorker.terminate();
          this.patternWorker = null;
        }
      };

      this.patternWorker.onerror = (err) => {
        console.error('Worker error:', err);
        this.patternSearching = false;
        this.patternProgress.phase = 'Failed with worker error';
        this.updatePatternCache();
        this.notifyChange();
        if (this.patternWorker) {
          this.patternWorker.terminate();
          this.patternWorker = null;
        }
      };

      this.patternWorker.postMessage({
        loadedDocs,
        patternType: this.patternType,
        patternLength: this.patternLength,
        patternStrictness: this.patternStrictness,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
      });
      this.updatePatternCache();
      this.notifyChange();

    } catch (err) {
      console.error('Melodic Pattern Grouping failed:', err);
      this.patternSearching = false;
      this.patternProgress.phase = 'Failed with error: ' + (err as Error).message;
      this.updatePatternCache();
      this.notifyChange();
    }
  }

  updatePatternCache() {
    this.savePatternStateToIndexedDB();
  }

  async savePatternStateToIndexedDB() {
    try {
      const params = {
        showPatternAnalysis: this.showPatternAnalysis,
        patternType: this.patternType,
        patternLength: this.patternLength,
        patternWithOctave: this.patternWithOctave,
        patternStrictness: this.patternStrictness,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        patternViewMode: this.patternViewMode,
        patternPage: this.patternPage,
        savedAt: new Date().toISOString(),
      };
      if (this.showPatternAnalysis && this.patternGroups.length > 0) {
        localStorage.setItem('monodi_pattern_params', JSON.stringify(params));
      } else if (!this.showPatternAnalysis) {
        localStorage.removeItem('monodi_pattern_params');
      }
    } catch (e) {
      console.warn('Failed to save pattern params to localStorage:', e);
    }

    try {
      const patternData = {
        showPatternAnalysis: this.showPatternAnalysis,
        patternLength: this.patternLength,
        patternType: this.patternType,
        patternWithOctave: this.patternWithOctave,
        patternStrictness: this.patternStrictness,
        patternViewMode: this.patternViewMode,
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        patternPage: this.patternPage,
      };
      await localforage.setItem('pattern_state', patternData);
    } catch (e) {
      console.warn('Failed to save pattern state to IndexedDB:', e);
    }
  }

  async saveCurrentPatternSession(name: string) {
    if (!name.trim()) {
      this.toastr.error('Please enter a session name');
      return;
    }

    try {
      const sessionData = {
        patternGroups: this.patternGroups,
        patternLength: this.patternLength,
        patternType: this.patternType,
        patternStrictness: this.patternStrictness,
        patternViewMode: this.patternViewMode,
        patternTimelineDocs: this.patternTimelineDocs,
        patternDocTotalNotes: Array.from(this.patternDocTotalNotes.entries()),
        patternMergeEnabled: this.patternMergeEnabled,
        patternMinMergeOverlap: this.patternMinMergeOverlap,
        patternDeduplicateEnabled: this.patternDeduplicateEnabled,
        detectedDuplicates: this.detectedDuplicates,
        patternPage: this.patternPage
      };

      const newSession = {
        id: Math.random().toString(36).substring(2, 11) + '-' + Date.now(),
        name: name.trim(),
        date: Date.now(),
        data: sessionData
      };

      this.savedPatternSessions = [newSession, ...this.savedPatternSessions];
      await localforage.setItem('saved_pattern_sessions', this.savedPatternSessions);
      this.toastr.success('Session saved successfully');
      this.notifyChange();
    } catch (e) {
      console.error('Failed to save session:', e);
      this.toastr.error('Failed to save session');
    }
  }

  async loadPatternSession(id: string) {
    const session = this.savedPatternSessions.find(s => s.id === id);
    if (!session) {
      this.toastr.error('Session not found');
      return;
    }

    try {
      const data = session.data;
      this.patternGroups = data.patternGroups || [];
      this.patternLength = data.patternLength ?? 8;
      this.patternType = data.patternType ?? 'interval';
      this.patternStrictness = data.patternStrictness ?? 'exact';
      this.patternViewMode = data.patternViewMode ?? 'overview';
      this.patternTimelineDocs = data.patternTimelineDocs || [];
      this.patternMergeEnabled = !!data.patternMergeEnabled;
      this.patternMinMergeOverlap = data.patternMinMergeOverlap ?? 1;
      this.patternDeduplicateEnabled = data.patternDeduplicateEnabled !== false;
      this.detectedDuplicates = data.detectedDuplicates || [];
      this.patternPage = data.patternPage || 1;
      
      if (data.patternDocTotalNotes) {
        this.patternDocTotalNotes = new Map<string, number>(data.patternDocTotalNotes);
      } else {
        this.patternDocTotalNotes = new Map<string, number>();
      }

      this.updatePatternCache();
      this.toastr.success(`Session "${session.name}" loaded`);
      this.notifyChange();
    } catch (e) {
      console.error('Failed to load session:', e);
      this.toastr.error('Failed to load session');
    }
  }

  async deletePatternSession(id: string) {
    try {
      this.savedPatternSessions = this.savedPatternSessions.filter(s => s.id !== id);
      await localforage.setItem('saved_pattern_sessions', this.savedPatternSessions);
      this.toastr.success('Session deleted');
      this.notifyChange();
    } catch (e) {
      console.error('Failed to delete session:', e);
      this.toastr.error('Failed to delete session');
    }
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
    this.notifyChange();
  }
}
