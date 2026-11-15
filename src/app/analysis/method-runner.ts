import { runMethod } from '@monodi/core/analysis';
import type { Corpus, MethodResult, ParamValues } from '@monodi/core/analysis';
import type { WorkerMessage, WorkerRequest } from './worker-protocol';

export interface RunJob { id: string; params: ParamValues }

export interface RunHooks {
  onProgress(methodId: string, done: number, total: number): void;
  /** Called with each result as soon as it is ready; the runner waits for the returned promise before it finishes. */
  onResult(methodId: string, result: MethodResult, params: ParamValues, durationMs: number): Promise<void> | void;
  onError(methodId: string, message: string): void;
}

/** Runs a list of methods on a corpus. The real one uses a web worker; tests use the in-thread one. */
export interface MethodRunner {
  run(corpus: Corpus, jobs: RunJob[], hooks: RunHooks): Promise<'done' | 'cancelled'>;
  /** Stops the run; `run` then resolves with `cancelled`. */
  cancel(): void;
}

export const CANCELLED = 'cancelled' as const;

/** Runs the methods on the calling thread, one after the other with a pause between them. For tests. */
export class InlineMethodRunner implements MethodRunner {
  private stopped = false;

  async run(corpus: Corpus, jobs: RunJob[], hooks: RunHooks): Promise<'done' | 'cancelled'> {
    this.stopped = false;
    for (const job of jobs) {
      if (this.stopped) return CANCELLED;
      const t0 = performance.now();
      try {
        const { result, params } = runMethod(job.id, corpus, job.params, { progress: (d, t) => hooks.onProgress(job.id, d, t) });
        await hooks.onResult(job.id, result, params, Math.round(performance.now() - t0));
      } catch (e) {
        hooks.onError(job.id, (e as Error)?.message ?? String(e));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return this.stopped ? CANCELLED : 'done';
  }

  cancel(): void { this.stopped = true; }
}

/** Runs the methods in a web worker, so the page stays usable. One worker per run, ended when the run ends. */
export class WorkerMethodRunner implements MethodRunner {
  private worker: Worker | null = null;
  private runId = 0;
  private finish: ((v: 'done' | 'cancelled') => void) | null = null;

  run(corpus: Corpus, jobs: RunJob[], hooks: RunHooks): Promise<'done' | 'cancelled'> {
    this.cancel();
    const runId = ++this.runId;
    const worker = new Worker(new URL('./analysis.worker', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<'done' | 'cancelled'>((resolve) => {
      const pending: Promise<void>[] = [];
      let settled = false;
      const end = (v: 'done' | 'cancelled') => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.finish = null;
        resolve(v);
      };
      this.finish = end;
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (data.runId !== runId) return; // an answer to an older run
        if (data.kind === 'progress') hooks.onProgress(data.methodId, data.done, data.total);
        else if (data.kind === 'result') pending.push(Promise.resolve(hooks.onResult(data.methodId, data.result, data.params, data.ms)).catch((e) => hooks.onError(data.methodId, (e as Error)?.message ?? String(e))));
        else if (data.kind === 'error') hooks.onError(data.methodId, data.message);
        else if (data.kind === 'done') Promise.all(pending).then(() => end('done'));
      };
      worker.onerror = (ev) => {
        for (const j of jobs) hooks.onError(j.id, ev.message || 'The analysis worker failed.');
        end('done');
      };
      const request: WorkerRequest = { runId, corpus, jobs };
      worker.postMessage(request);
    });
  }

  cancel(): void {
    if (this.finish) this.finish(CANCELLED);
  }
}
