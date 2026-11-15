import type { Corpus, MethodResult, ParamValues } from '@monodi/core/analysis';

/** The messages between the page and `analysis.worker.ts`. Kept apart from the worker so the page can import the types. */
export interface WorkerRequest {
  runId: number;
  corpus: Corpus;
  jobs: { id: string; params: ParamValues }[];
}

export type WorkerMessage =
  | { kind: 'progress'; runId: number; methodId: string; done: number; total: number }
  | { kind: 'result'; runId: number; methodId: string; result: MethodResult; params: ParamValues; ms: number }
  | { kind: 'error'; runId: number; methodId: string; message: string }
  | { kind: 'done'; runId: number };
