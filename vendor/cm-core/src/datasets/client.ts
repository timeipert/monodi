/**
 * Fetching with integrity: every file of a dataset is checked against the size and SHA-256 that its index lists, and a
 * request that fails for a reason that may pass (network error, 429, 5xx) is repeated with a growing pause.
 *
 * Nothing here touches the page or the storage; `fetch`, the hash function and the pause are parameters, so the tests
 * run in Node without a network.
 */

export class DatasetError extends Error {
  /** HTTP status, if the server answered. */
  status?: number;
  url?: string;
  /** `network`, `http`, `integrity`, `format` or `aborted`. */
  kind: string;

  constructor(message: string, kind: string, url?: string, status?: number) {
    super(message);
    this.name = 'DatasetError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

export interface FetchContext {
  fetch: typeof fetch;
  /** SHA-256 of a buffer as lower-case hex. */
  sha256: (data: ArrayBuffer) => Promise<string>;
  /** How many times a failed request is repeated (so up to `retries + 1` attempts). */
  retries: number;
  /** A request that takes longer is abandoned and counts as a network error. */
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Cancels everything that uses this context. */
  signal?: AbortSignal;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function makeContext(partial: Partial<FetchContext> = {}): FetchContext {
  return {
    fetch: partial.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    sha256: partial.sha256 ?? sha256Hex,
    retries: partial.retries ?? 3,
    timeoutMs: partial.timeoutMs ?? 60_000,
    sleep: partial.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    signal: partial.signal,
  };
}

/** What an index promises about a file; a field that is missing is not checked. */
export interface Expected {
  bytes?: number;
  sha256?: string;
}

function abortError(url: string): DatasetError {
  return new DatasetError('The request was cancelled.', 'aborted', url);
}

async function attemptOnce(url: string, expected: Expected, ctx: FetchContext): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  let response: Response;
  let data: ArrayBuffer;
  try {
    try {
      response = await ctx.fetch(url, { signal: controller.signal });
      if (response.ok) data = await response.arrayBuffer();
    } catch (error) {
      if (ctx.signal?.aborted) throw abortError(url);
      throw new DatasetError(`Could not reach ${url} (offline, blocked or too slow).`, 'network', url);
    }
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok) {
    throw new DatasetError(`The server answered HTTP ${response.status} for ${url}.`, 'http', url, response.status);
  }
  if (expected.bytes !== undefined && data!.byteLength !== expected.bytes) {
    throw new DatasetError(
      `${url} has ${data!.byteLength} bytes, the index lists ${expected.bytes}.`, 'integrity', url,
    );
  }
  if (expected.sha256 !== undefined && (await ctx.sha256(data!)) !== expected.sha256) {
    throw new DatasetError(`${url} does not match the SHA-256 of the index.`, 'integrity', url);
  }
  return data!;
}

/** A status that a repetition cannot change: the file is missing or not for us. */
function isFinal(error: DatasetError): boolean {
  return error.kind === 'http' && error.status !== undefined && error.status < 500 && error.status !== 429;
}

/** Fetch a file and check it against `expected`; repeat after a network error, 429, 5xx or a mismatch. */
export async function fetchBytes(url: string, expected: Expected, ctx: FetchContext): Promise<ArrayBuffer> {
  let last: DatasetError | undefined;
  for (let attempt = 0; attempt <= ctx.retries; attempt++) {
    if (ctx.signal?.aborted) throw abortError(url);
    try {
      return await attemptOnce(url, expected, ctx);
    } catch (error) {
      if (!(error instanceof DatasetError)) throw error;
      if (error.kind === 'aborted' || isFinal(error)) throw error;
      last = error;
      if (attempt < ctx.retries) await ctx.sleep(Math.min(250 * 2 ** attempt, 8000) * (0.75 + Math.random() * 0.5));
    }
  }
  throw last!;
}

export async function fetchJson<T>(url: string, expected: Expected, ctx: FetchContext): Promise<T> {
  const data = await fetchBytes(url, expected, ctx);
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    throw new DatasetError(`${url} is not valid JSON.`, 'format', url);
  }
}

/** A fetch that runs ahead of its consumer, see `prefetch`. */
export interface Prefetch<T, R> {
  /** The next result in the order of the items; throws the error of its fetch and then stops the others. */
  take(): Promise<{ item: T; value: R }>;
  /** Stop fetching (an import that was cancelled or failed). */
  close(): void;
}

/**
 * Fetch the items in order, keeping up to `window` of them in flight or finished and not yet taken. A consumer that
 * processes one result while the next ones arrive makes the transfer time overlap with its own work, and a window
 * of many small files hides the delay of each request (a file of a few KB takes as long to ask for as one of a MB).
 * Results come in the order of `items`. The first failed fetch aborts the others, and so does a cancel of `ctx`.
 */
export function prefetch<T, R>(
  items: readonly T[],
  fetchOne: (item: T, ctx: FetchContext) => Promise<R>,
  window: number,
  ctx: FetchContext,
): Prefetch<T, R> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (ctx.signal?.aborted) controller.abort();
  else ctx.signal?.addEventListener('abort', onAbort);
  const inner: FetchContext = { ...ctx, signal: controller.signal };
  const queue: Array<{ item: T; promise: Promise<R> }> = [];
  let next = 0;
  /** Items started and not yet handed out; the one the consumer waits for counts too. */
  let outstanding = 0;
  const fill = () => {
    while (outstanding < window && next < items.length && !controller.signal.aborted) {
      const item = items[next++];
      const promise = fetchOne(item, inner);
      promise.catch(() => undefined); // the consumer sees the error when it takes this item
      queue.push({ item, promise });
      outstanding++;
    }
  };
  fill();
  return {
    async take() {
      const head = queue.shift();
      if (!head) {
        throw controller.signal.aborted
          ? new DatasetError('The request was cancelled.', 'aborted')
          : new DatasetError('There is nothing left to fetch.', 'format');
      }
      try {
        const value = await head.promise;
        outstanding--;
        fill(); // refilled before the consumer works on this result, so the next ones arrive meanwhile
        return { item: head.item, value };
      } catch (error) {
        controller.abort();
        throw error;
      }
    },
    close() {
      controller.abort();
      ctx.signal?.removeEventListener('abort', onAbort);
    },
  };
}
