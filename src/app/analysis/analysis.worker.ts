/// <reference lib="webworker" />

/**
 * Runs analysis methods off the main thread. The page posts the corpus once with the list of methods to run; the worker
 * runs them one after the other and posts progress and each result as it is ready, so the page can store results as they
 * come. Every message carries the `runId` of the request. Cancelling is done by ending the worker.
 */
import { runMethod } from '@monodi/core/analysis';
import type { WorkerMessage, WorkerRequest } from './worker-protocol';

const EMIT_EVERY_MS = 80;

addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const { runId, corpus, jobs } = data;
  for (const job of jobs) {
    let last = 0;
    const t0 = performance.now();
    try {
      const { result, params } = runMethod(job.id, corpus, job.params, {
        progress: (done, total) => {
          const now = performance.now();
          if (now - last < EMIT_EVERY_MS && done !== total) return;
          last = now;
          postMessage({ kind: 'progress', runId, methodId: job.id, done, total } satisfies WorkerMessage);
        },
      });
      postMessage({ kind: 'result', runId, methodId: job.id, result, params, ms: Math.round(performance.now() - t0) } satisfies WorkerMessage);
    } catch (e) {
      postMessage({ kind: 'error', runId, methodId: job.id, message: (e as Error)?.message ?? String(e) } satisfies WorkerMessage);
    }
  }
  postMessage({ kind: 'done', runId } satisfies WorkerMessage);
});
