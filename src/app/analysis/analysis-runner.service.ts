import { Injectable } from '@angular/core';
import { applyFilters, diffDigests, filtersKey, getMethod, hasExcludeRules, methodFingerprint, normalizeParams, usedDigests } from '@monodi/core/analysis';
import type { CorpusFilters, DocDigests, Uses } from '@monodi/core/analysis';
import { AnalysisStore } from './analysis-store';
import type { AnalysisDefinition, MethodStatus, ResultRecord } from './analysis-types';
import { CorpusLoader } from './corpus-loader';
import { CANCELLED, MethodRunner, WorkerMethodRunner } from './method-runner';

export interface RunSummary {
  /** Methods computed in this run. */
  ran: string[];
  /** Methods whose stored result was valid, so nothing was computed. */
  cached: string[];
  failed: { id: string; message: string }[];
  cancelled: boolean;
  /** Documents of the corpus that no longer exist and were left out. */
  missingDocs: number;
  /** Chants that a rule of the filters left out. */
  excludedDocs: number;
  ms: number;
}

export interface RunCallbacks {
  onStatus(methodId: string, status: MethodStatus): void;
  /** Called with each result after it was stored. */
  onResult?(record: ResultRecord): void;
}

/**
 * Runs the methods of a saved analysis. Everything that makes a result reusable is decided here: a method whose stored
 * result has the same fingerprint (same method version, parameters and documents as far as it reads them) is not run
 * again; every other chosen method is computed in the worker and stored as it finishes.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisRunnerService {
  private runner: MethodRunner = new WorkerMethodRunner();
  private cancelled = false;

  constructor(private readonly loader: CorpusLoader) {}

  /** Replace the way methods are run (tests use the in-thread runner). */
  setRunner(runner: MethodRunner): void { this.runner = runner; }

  /** Stop the run that is in progress (reading documents or computing). */
  cancel(): void {
    this.cancelled = true;
    this.runner.cancel();
  }

  async run(def: AnalysisDefinition, methodIds: string[], token: string, cb: RunCallbacks, opts: { force?: boolean } = {}): Promise<RunSummary> {
    const t0 = performance.now();
    this.cancelled = false;
    const summary: RunSummary = { ran: [], cached: [], failed: [], cancelled: false, missingDocs: 0, excludedDocs: 0, ms: 0 };
    const chosen = def.methods.filter((m) => methodIds.includes(m.id) && getMethod(m.id));
    for (const m of chosen) cb.onStatus(m.id, { state: 'running', done: 0, total: 0 });

    // 1. Read the documents once for all methods.
    const loaded = await this.loader.load(
      def.corpus.docIds, token,
      (done, total) => { for (const m of chosen) cb.onStatus(m.id, { state: 'running', done, total }); },
      { isCancelled: () => this.cancelled },
    );
    if (!loaded) return this.finish(summary, t0, true);
    summary.missingDocs = loaded.missing.length;

    // The filters leave chants and stop words out once, for every method. The fingerprint covers them, and a rule reads the
    // metadata, so with rules every method counts the metadata digest as something it reads.
    const filtered = applyFilters(loaded.corpus, def.filters);
    const idsKept = new Set(filtered.kept.map((i) => loaded.corpus.docs[i].id));
    const keptDigests: Record<string, DocDigests> = {};
    for (const id of Object.keys(loaded.digests)) if (idsKept.has(id)) keptDigests[id] = loaded.digests[id];
    summary.excludedDocs = filtered.excluded.length;
    const fKey = filtersKey(def.filters);

    // 2. Keep every stored result that is still valid.
    const jobs: { id: string; params: Record<string, number | boolean | string>; fingerprint: string }[] = [];
    for (const m of chosen) {
      const method = getMethod(m.id)!;
      const params = normalizeParams(method, m.params);
      const uses = usesWith(method.uses, def.filters);
      const fingerprint = methodFingerprint({ methodId: method.id, version: method.version, params, uses, digests: keptDigests, extra: fKey });
      const stored = opts.force ? null : await AnalysisStore.getResult(def.id, method.id);
      if (stored && stored.fingerprint === fingerprint) {
        summary.cached.push(method.id);
        cb.onStatus(method.id, { state: 'fresh' });
      } else {
        jobs.push({ id: method.id, params, fingerprint });
        cb.onStatus(method.id, { state: 'running', done: 0, total: 0 });
      }
    }
    if (jobs.length === 0) return this.finish(summary, t0, false);

    // 3. Compute the rest in the worker and store each result as it arrives.
    const fingerprints = new Map(jobs.map((j) => [j.id, j.fingerprint]));
    const outcome = await this.runner.run(filtered.corpus, jobs.map((j) => ({ id: j.id, params: j.params })), {
      onProgress: (id, done, total) => cb.onStatus(id, { state: 'running', done, total }),
      onResult: async (id, result, params, ms) => {
        const method = getMethod(id)!;
        const record: ResultRecord = {
          methodId: id, methodVersion: method.version, params, fingerprint: fingerprints.get(id)!, filtersKey: fKey,
          digests: usedDigests(keptDigests, usesWith(method.uses, def.filters)), computedAt: Date.now(), durationMs: ms,
          bytes: 0, truncated: false, result,
        };
        try {
          const stored = await AnalysisStore.putResult(def.id, record);
          summary.ran.push(id);
          cb.onStatus(id, { state: 'fresh' });
          cb.onResult?.(stored);
        } catch (e) {
          summary.failed.push({ id, message: (e as Error).message });
          cb.onStatus(id, { state: 'error', message: (e as Error).message });
        }
      },
      onError: (id, message) => {
        summary.failed.push({ id, message });
        cb.onStatus(id, { state: 'error', message });
      },
    });
    return this.finish(summary, t0, outcome === CANCELLED || this.cancelled);
  }

  private finish(summary: RunSummary, t0: number, cancelled: boolean): RunSummary {
    summary.cancelled = cancelled;
    summary.ms = Math.round(performance.now() - t0);
    return summary;
  }

  /**
   * Compare each stored result with the documents as they are now: reads the documents again (only their notes, when a
   * result needs them) and compares the digests. Returns a status per method that has a stored result. Takes time on a
   * large corpus, so the page runs it on request and shows the stored results meanwhile.
   */
  async checkFreshness(
    def: AnalysisDefinition,
    token: string,
    progress: (done: number, total: number) => void = () => undefined,
    isCancelled: () => boolean = () => false,
  ): Promise<Record<string, MethodStatus> | null> {
    const records: ResultRecord[] = [];
    for (const m of def.methods) {
      const r = await AnalysisStore.getResult(def.id, m.id);
      if (r) records.push(r);
    }
    if (records.length === 0) return {};
    const needNotes = records.some((r) => getMethod(r.methodId)?.uses.some((u) => u !== 'meta'));
    const loaded = await this.loader.load(def.corpus.docIds, token, progress, { needNotes, isCancelled });
    if (!loaded) return null;
    const filtered = applyFilters(loaded.corpus, def.filters);
    const idsKept = new Set(filtered.kept.map((i) => loaded.corpus.docs[i].id));
    const current: Record<string, DocDigests | undefined> = {};
    for (const id of Object.keys(loaded.digests)) if (idsKept.has(id)) current[id] = loaded.digests[id];
    const fKey = filtersKey(def.filters);
    const out: Record<string, MethodStatus> = {};
    for (const r of records) {
      const method = getMethod(r.methodId);
      if (!method) { out[r.methodId] = { state: 'stale', reason: 'The method is no longer available.', changed: 0, removed: 0 }; continue; }
      if (method.version !== r.methodVersion) {
        out[r.methodId] = { state: 'stale', reason: `The method changed (version ${r.methodVersion} to ${method.version}).`, changed: 0, removed: 0 };
        continue;
      }
      const chosen = def.methods.find((m) => m.id === r.methodId);
      const wanted = normalizeParams(method, chosen?.params);
      if (JSON.stringify(wanted) !== JSON.stringify(r.params)) {
        out[r.methodId] = { state: 'stale', reason: 'The parameters were changed after this result was computed.', changed: 0, removed: 0 };
        continue;
      }
      if ((r.filtersKey ?? '') !== fKey) {
        out[r.methodId] = { state: 'stale', reason: 'The chants or words left out were changed after this result was computed.', changed: 0, removed: 0 };
        continue;
      }
      const diff = diffDigests(r.digests, current, usesWith(method.uses, def.filters));
      out[r.methodId] = diff.same
        ? { state: 'fresh' }
        : { state: 'stale', reason: describeDiff(diff.changed.length, diff.removed.length), changed: diff.changed.length, removed: diff.removed.length };
    }
    return out;
  }
}

/** With rules that leave chants out by their metadata, every method also reads the metadata digest. */
function usesWith(uses: readonly Uses[], filters: CorpusFilters | undefined): Uses[] {
  return hasExcludeRules(filters) && !uses.includes('meta') ? [...uses, 'meta'] : [...uses];
}

function describeDiff(changed: number, removed: number): string {
  const parts: string[] = [];
  if (changed) parts.push(`${changed} document${changed === 1 ? '' : 's'} changed`);
  if (removed) parts.push(`${removed} removed`);
  return `${parts.join(', ')} since this result was computed.`;
}
