/**
 * streamHealthCheck — a CI/staging probe for production streaming.
 *
 * "Streaming works on localhost but arrives as one blob in production" is the
 * most common deployment failure for SSE chat backends, almost always caused by
 * a reverse proxy / CDN buffering the response. It is invisible until a human
 * notices the answer appears all-at-once.
 *
 * This utility makes that failure *testable*: point it at your deployed chat
 * route, and it reports whether the response actually arrived incrementally
 * (many chunks over time) or as a single late blob (buffered). Run it in CI
 * against a staging deploy, or as a smoke test after release, so a buffering
 * misconfiguration fails the pipeline instead of reaching users.
 *
 * It validates the transport, not model correctness — it only cares that bytes
 * stream back over time.
 */
import 'server-only';

export interface StreamHealthResult {
  /** True when the response streamed incrementally (not buffered) with a 2xx. */
  ok: boolean;
  /** HTTP status of the probe response (0 if the request never completed). */
  status: number;
  /** Number of non-empty network reads observed from the response body. */
  chunks: number;
  /** Time (ms) from request start to the first non-empty chunk, or null. */
  firstChunkMs: number | null;
  /** Total time (ms) from request start to stream end. */
  totalMs: number;
  /** Heuristic: the response looks buffered (arrived as ~one late chunk). */
  likelyBuffered: boolean;
  /** Human-readable summary / remediation pointer. */
  note: string;
}

export interface StreamHealthCheckOptions {
  /**
   * Absolute URL of the mounted chat route's POST endpoint
   * (e.g. `https://staging.example.com/api/chat`).
   */
  url: string;
  /**
   * Headers used to authenticate the probe. Your `getUserId` must accept these
   * (e.g. a session cookie or a test bearer token). Without valid auth the
   * endpoint returns 401 and the probe reports `ok: false`.
   */
  headers?: Record<string, string>;
  /** Probe message text. Default: `"ping"`. */
  message?: string;
  /** Conversation id for the probe turn. Default: an ephemeral `health-*` id. */
  conversationId?: string;
  /** Abort the probe after this many ms. Default: 20000. */
  timeoutMs?: number;
  /** Custom fetch implementation (default: global `fetch`). */
  fetchImpl?: typeof fetch;
}

/**
 * Probe a deployed chat endpoint and report whether it streams incrementally.
 * Never throws — failures are returned as `{ ok: false, note }`.
 */
export async function streamHealthCheck(
  options: StreamHealthCheckOptions,
): Promise<StreamHealthResult> {
  const {
    url,
    headers = {},
    message = 'ping',
    conversationId = `health-${Date.now()}`,
    timeoutMs = 20_000,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  let firstChunkMs: number | null = null;
  let chunks = 0;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        id: conversationId,
        messages: [
          {
            id: `health-msg-${Date.now()}`,
            role: 'user',
            parts: [{ type: 'text', text: message }],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      return {
        ok: false,
        status: res.status,
        chunks: 0,
        firstChunkMs: null,
        totalMs: Date.now() - start,
        likelyBuffered: false,
        note: res.ok
          ? 'Response had no readable body to stream.'
          : `Endpoint returned ${res.status}. Check auth headers and that the URL is the POST chat route.`,
      };
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks += 1;
        if (firstChunkMs === null) firstChunkMs = Date.now() - start;
      }
    }

    const totalMs = Date.now() - start;
    // A genuinely streamed SSE response yields many reads spread over time.
    // Buffering collapses that into ~one read that lands at the very end, so:
    //   - a single chunk, or
    //   - a first chunk that arrives ~when the stream completes
    // both strongly indicate an intermediary buffered the body.
    const likelyBuffered =
      chunks <= 1 ||
      (firstChunkMs !== null && chunks < 3 && totalMs - firstChunkMs < 5);

    return {
      ok: !likelyBuffered,
      status: res.status,
      chunks,
      firstChunkMs,
      totalMs,
      likelyBuffered,
      note: likelyBuffered
        ? 'Response did not stream incrementally — likely reverse-proxy/CDN buffering. ' +
          'See https://mordn.dev/docs/streaming-setup'
        : `Streamed ${chunks} chunks; first byte at ${firstChunkMs}ms of ${totalMs}ms total.`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      chunks,
      firstChunkMs,
      totalMs: Date.now() - start,
      likelyBuffered: false,
      note: aborted
        ? `Probe timed out after ${timeoutMs}ms before the stream finished.`
        : `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
