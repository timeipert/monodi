import * as localforage from 'localforage';
import {
  ANALYSIS_FORMAT, ANALYSIS_FORMAT_VERSION,
  AnalysisDefinition, AnalysisExport, AnalysisSummary, CorpusSpec, MethodChoice, ResultRecord,
} from './analysis-types';
import { Packed, packedSize, packJson, unpackJson } from './compress';
import { MAX_RESULT_CHARS, shrinkResult } from './result-size';

/**
 * Saved analyses in IndexedDB, in the same store as the workspace. One small row lists the analyses, one row holds the
 * definition of each, and one row each holds the result of each method, so a large result never rewrites the others and no
 * row comes near the structured-clone limit (the reason `NotesStore` keeps one row per document, too).
 *
 *   monodi_analyses_index                      AnalysisSummary[]
 *   monodi_analysis_<id>                       AnalysisDefinition
 *   monodi_analysis_result_<id>_<method>       Packed ResultRecord (gzip over 256 KB)
 *
 * All writes go through one queue, so the index is never written by two operations at once.
 */
export class AnalysisStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AnalysisStoreError';
  }
}

export class AnalysisStore {
  static readonly INDEX_KEY = 'monodi_analyses_index';
  static readonly defKey = (id: string) => `monodi_analysis_${id}`;
  static readonly resultKey = (id: string, methodId: string) => `monodi_analysis_result_${id}_${methodId}`;

  private static queue: Promise<unknown> = Promise.resolve();

  private static serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  static newId(): string {
    const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return rnd;
  }

  private static async readIndex(): Promise<AnalysisSummary[]> {
    return (await localforage.getItem<AnalysisSummary[]>(this.INDEX_KEY)) ?? [];
  }

  private static async put(key: string, value: unknown): Promise<void> {
    try {
      await localforage.setItem(key, value);
    } catch (e) {
      const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
      throw new AnalysisStoreError(
        quota
          ? 'The browser has no storage left for this analysis. Delete saved analyses or free space (Settings, Workspace) and run it again.'
          : `The analysis could not be saved: ${(e as Error)?.message ?? e}`,
        e,
      );
    }
  }

  private static summaryOf(def: AnalysisDefinition, old?: AnalysisSummary): AnalysisSummary {
    return {
      id: def.id, name: def.name, createdAt: def.createdAt, updatedAt: def.updatedAt,
      docCount: def.corpus.docIds.length, corpusLabel: def.corpus.label,
      methodIds: def.methods.map((m) => m.id),
      resultIds: old?.resultIds ?? [],
      resultBytes: old?.resultBytes ?? {},
      bytes: old?.bytes ?? 0,
    };
  }

  private static withBytes(s: AnalysisSummary, defBytes: number): AnalysisSummary {
    s.bytes = defBytes + Object.values(s.resultBytes).reduce((a, b) => a + b, 0);
    return s;
  }

  // ── analyses ──────────────────────────────────────────────────────────────

  /** The saved analyses, newest first. */
  static async list(): Promise<AnalysisSummary[]> {
    const index = await this.readIndex();
    return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static async get(id: string): Promise<AnalysisDefinition | null> {
    return (await localforage.getItem<AnalysisDefinition>(this.defKey(id))) ?? null;
  }

  /** Create a new analysis (not yet holding a result). */
  static async create(name: string, corpus: CorpusSpec, methods: MethodChoice[], note = ''): Promise<AnalysisDefinition> {
    const now = Date.now();
    const def: AnalysisDefinition = {
      id: this.newId(), name: name.trim() || 'Untitled analysis', note, createdAt: now, updatedAt: now,
      corpus: { ...corpus, docIds: [...new Set(corpus.docIds)].sort() }, methods,
    };
    await this.save(def, false);
    return def;
  }

  /** Write the definition and update its line in the index. `touch` sets the modification time. */
  static save(def: AnalysisDefinition, touch = true): Promise<void> {
    return this.serialized(async () => {
      if (touch) def.updatedAt = Date.now();
      await this.put(this.defKey(def.id), def);
      const index = await this.readIndex();
      const at = index.findIndex((s) => s.id === def.id);
      const old = at >= 0 ? index[at] : undefined;
      const summary = this.withBytes(this.summaryOf(def, old), JSON.stringify(def).length * 2);
      if (at >= 0) index[at] = summary; else index.push(summary);
      await this.put(this.INDEX_KEY, index);
    });
  }

  /** Delete an analysis with all its results. */
  static delete(id: string): Promise<void> {
    return this.serialized(async () => {
      const index = await this.readIndex();
      const s = index.find((x) => x.id === id);
      for (const methodId of s?.resultIds ?? []) await localforage.removeItem(this.resultKey(id, methodId));
      await localforage.removeItem(this.defKey(id));
      await this.put(this.INDEX_KEY, index.filter((x) => x.id !== id));
    });
  }

  /** Delete every analysis (the "Clear analyses" button and the wipe paths of the settings). */
  static deleteAll(): Promise<void> {
    return this.serialized(async () => {
      const index = await this.readIndex();
      for (const s of index) {
        for (const methodId of s.resultIds) await localforage.removeItem(this.resultKey(s.id, methodId));
        await localforage.removeItem(this.defKey(s.id));
      }
      await localforage.removeItem(this.INDEX_KEY);
    });
  }

  // ── results ───────────────────────────────────────────────────────────────

  static async getResult(id: string, methodId: string): Promise<ResultRecord | null> {
    const packed = await localforage.getItem<Packed>(this.resultKey(id, methodId));
    if (!packed) return null;
    try {
      const rec = await unpackJson<ResultRecord>(packed);
      rec.bytes = packedSize(packed); // the row cannot hold its own size when it is written
      return rec;
    } catch (e) {
      console.warn(`Stored result ${methodId} of analysis ${id} could not be read`, e);
      return null;
    }
  }

  /** Store a result, cutting its tables if it is larger than `MAX_RESULT_CHARS`. Returns the record as stored. */
  static putResult(id: string, rec: ResultRecord): Promise<ResultRecord> {
    return this.serialized(async () => {
      const shrunk = shrinkResult(rec.result, MAX_RESULT_CHARS);
      const stored: ResultRecord = { ...rec, result: shrunk.result, truncated: rec.truncated || shrunk.truncated };
      const packed = await packJson(stored);
      stored.bytes = packedSize(packed);
      await this.put(this.resultKey(id, rec.methodId), packed);
      const index = await this.readIndex();
      const s = index.find((x) => x.id === id);
      if (s) {
        if (!s.resultIds.includes(rec.methodId)) s.resultIds.push(rec.methodId);
        s.resultBytes[rec.methodId] = stored.bytes;
        s.updatedAt = Date.now();
        const def = await this.get(id);
        this.withBytes(s, def ? JSON.stringify(def).length * 2 : 0);
        await this.put(this.INDEX_KEY, index);
      }
      return stored;
    });
  }

  static removeResult(id: string, methodId: string): Promise<void> {
    return this.serialized(async () => {
      await localforage.removeItem(this.resultKey(id, methodId));
      const index = await this.readIndex();
      const s = index.find((x) => x.id === id);
      if (s) {
        s.resultIds = s.resultIds.filter((m) => m !== methodId);
        delete s.resultBytes[methodId];
        const def = await this.get(id);
        this.withBytes(s, def ? JSON.stringify(def).length * 2 : 0);
        await this.put(this.INDEX_KEY, index);
      }
    });
  }

  /** Total stored bytes of all analyses (from the index, no reading of results). */
  static async totalBytes(): Promise<number> {
    return (await this.readIndex()).reduce((n, s) => n + s.bytes, 0);
  }

  // ── export and import ─────────────────────────────────────────────────────

  /** The analysis with all its results, ready to write as a `.monodi-analysis.json` file. */
  static async exportOne(id: string, withResults = true): Promise<AnalysisExport> {
    const analysis = await this.get(id);
    if (!analysis) throw new AnalysisStoreError('The analysis does not exist.');
    const results: ResultRecord[] = [];
    if (withResults) {
      const s = (await this.readIndex()).find((x) => x.id === id);
      for (const methodId of s?.resultIds ?? []) {
        const r = await this.getResult(id, methodId);
        if (r) results.push(r);
      }
    }
    return { format: ANALYSIS_FORMAT, version: ANALYSIS_FORMAT_VERSION, exportedAt: Date.now(), analysis, results };
  }

  /** Every analysis with its results, for the workspace backup. */
  static async exportAll(): Promise<AnalysisExport[]> {
    const out: AnalysisExport[] = [];
    for (const s of await this.list()) out.push(await this.exportOne(s.id, true));
    return out;
  }

  /**
   * Restore the analyses of a workspace backup: replaces the analyses of this browser by the ones in the file, under
   * their original ids (a restore replaces the workspace as it was, so ids and results are kept). Entries that are not
   * valid analyses are skipped; returns how many were restored.
   */
  static async restoreAll(files: unknown[]): Promise<number> {
    await this.deleteAll();
    let n = 0;
    for (const f of files) {
      try {
        const file = this.parseExport(f);
        await this.save(file.analysis, false);
        for (const r of file.results) if (file.analysis.methods.some((m) => m.id === r.methodId)) await this.putResult(file.analysis.id, r);
        n++;
      } catch (e) {
        console.warn('A saved analysis in the backup was skipped', e);
      }
    }
    return n;
  }

  /** Check that a parsed file is an analysis export; throws a readable error otherwise. */
  static parseExport(json: unknown): AnalysisExport {
    const f = json as Partial<AnalysisExport> | null;
    if (!f || typeof f !== 'object' || f.format !== ANALYSIS_FORMAT) throw new AnalysisStoreError('This file is not a monodi analysis (format "monodi-analysis" expected).');
    if (typeof f.version !== 'number' || f.version > ANALYSIS_FORMAT_VERSION) throw new AnalysisStoreError('This analysis was written by a newer version of monodi and cannot be read.');
    const a = f.analysis;
    if (!a || typeof a.id !== 'string' || !a.corpus || !Array.isArray(a.corpus.docIds) || !Array.isArray(a.methods)) throw new AnalysisStoreError('The analysis in this file is incomplete.');
    return { format: ANALYSIS_FORMAT, version: f.version, exportedAt: f.exportedAt ?? 0, analysis: a, results: Array.isArray(f.results) ? f.results : [] };
  }

  /**
   * Add an exported analysis to the store under a new id (so an import never overwrites an analysis). Whether its results
   * are still valid for the documents of this workspace is decided later by the fingerprint check.
   */
  static async importOne(file: AnalysisExport): Promise<AnalysisDefinition> {
    const now = Date.now();
    const def: AnalysisDefinition = { ...file.analysis, id: this.newId(), name: `${file.analysis.name} (imported)`, updatedAt: now };
    await this.save(def, false);
    for (const r of file.results) {
      if (def.methods.some((m) => m.id === r.methodId)) await this.putResult(def.id, r);
    }
    return def;
  }
}
