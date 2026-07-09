/**
 * Shared HTTP helper for the hosted API clients.
 *
 * Every hosted client (chat store, storage, config, feedback, knowledge, memory,
 * mem0) issues `fetch` to a remote service. Without a timeout, a hung or stalled
 * upstream holds the request — and the connection-pool slot / serverless compute
 * behind it — open until the platform kills it, which on a chat turn means a
 * wedged reply. `withFetchTimeout` bounds every call with a wall-clock deadline.
 *
 * It also defaults every request to `cache: 'no-store'`. These clients run
 * inside Next.js route handlers, whose patched `fetch` caches GETs by default —
 * keyed on URL ONLY, so a per-user header like `X-Chat-User` does not vary the
 * cache key. Left uncorrected, that means one user's hosted-backend response
 * (their conversation list, their config) can be served straight to another
 * user, and a since-updated history can be served stale. Per-user data must
 * never enter that cache, so the wrapper opts every wrapped call out of it;
 * callers that legitimately want caching can still override via `init`.
 */

import 'server-only';

/** Default per-request timeout (ms) for the hosted HTTP clients. */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * Wrap a `fetch` implementation so every call is bounded by a wall-clock
 * timeout. Returns a `fetch`-compatible function: when the deadline passes the
 * underlying request is aborted (the promise rejects with an `AbortError`), so a
 * hung/stalled upstream can never hold a request open indefinitely. A
 * caller-supplied `init.signal` is still honoured (aborting it aborts the
 * request). `timeoutMs <= 0` disables the timeout and returns the impl unchanged.
 *
 * Portable across Node and Edge/Workers — uses only `AbortController` /
 * `setTimeout` / `fetch`, no runtime-specific APIs.
 */
export function withFetchTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  if (!timeoutMs || timeoutMs <= 0) return fetchImpl;
  const wrapped = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const controller = new AbortController();
    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return Promise.resolve(
      fetchImpl(input, { cache: 'no-store', ...init, signal: controller.signal }),
    ).finally(() => clearTimeout(timer));
  };
  return wrapped as typeof fetch;
}
