export const ACCOUNTING_REQUEST_DEADLINE_MS = 90_000;

const deadlines = new WeakMap<AbortSignal, { deadlineAt: number; expireIfElapsed(): void }>();

export interface RequestDeadline {
  signal: AbortSignal;
  deadlineAt: number;
  timedOut(): boolean;
  expireIfElapsed(): void;
  dispose(): void;
}

export function createRequestDeadline(callerSignal?: AbortSignal): RequestDeadline {
  const controller = new AbortController();
  const deadlineAt = Date.now() + ACCOUNTING_REQUEST_DEADLINE_MS;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ACCOUNTING_REQUEST_DEADLINE_MS);
  const onCallerAbort = () => controller.abort();
  const expireIfElapsed = () => {
    if (!timedOut && Date.now() >= deadlineAt) {
      timedOut = true;
      controller.abort();
    }
  };

  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  deadlines.set(controller.signal, { deadlineAt, expireIfElapsed });
  return {
    signal: controller.signal,
    deadlineAt,
    timedOut: () => timedOut,
    expireIfElapsed,
    dispose: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

export function throwIfRequestAborted(signal?: AbortSignal): void {
  if (signal) deadlines.get(signal)?.expireIfElapsed();
  if (!signal?.aborted) return;
  const error = new Error('Accounting request was canceled.');
  error.name = 'AbortError';
  throw error;
}

export function getRequestTimeoutMs(signal: AbortSignal, stageLimitMs: number): number {
  const deadline = deadlines.get(signal);
  deadline?.expireIfElapsed();
  return Math.max(1, Math.min(stageLimitMs, deadline === undefined ? stageLimitMs : deadline.deadlineAt - Date.now()));
}

export function raceRequestWithAbort<T>(operation: Promise<T> | (() => Promise<T>), deadline: RequestDeadline): Promise<T> {
  const { signal } = deadline;
  deadline.expireIfElapsed();
  if (signal.aborted) return Promise.reject(createRequestAbortError(deadline.timedOut()));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createRequestAbortError(deadline.timedOut()));
    signal.addEventListener('abort', onAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = typeof operation === 'function' ? operation() : operation;
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      reject(error);
      return;
    }
    pending.then(value => {
      deadline.expireIfElapsed();
      if (signal.aborted) reject(createRequestAbortError(deadline.timedOut()));
      else resolve(value);
    }, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function createRequestAbortError(timedOut: boolean): Error {
  const error = new Error(timedOut
    ? 'This request exceeded the 90-second processing deadline. The last committed journal was preserved.'
    : 'This request was canceled. The last committed journal was preserved.');
  error.name = timedOut ? 'RequestTimeoutError' : 'AbortError';
  return error;
}
