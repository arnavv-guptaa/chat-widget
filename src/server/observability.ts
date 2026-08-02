/**
 * Observability — structured, correlated logging for a chat turn.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The handler already logged the things that matter — save failures, title
 * failures, memory-extraction failures, stream errors. But it logged them as
 * loose `console.error(JSON.stringify({ event, userId, conversationId }))`
 * calls with no shared shape, no correlation id, and no way for the host to
 * redirect them. `logErrors` was a *boolean*: you could silence the output or
 * keep it, but you could not route it into Datadog, add your own fields, or
 * follow a single turn from request → model → tool → persistence.
 *
 * So the moment something went wrong in production you had exactly the wrong
 * artefact: a wall of unrelated lines, no way to tell which belonged to the
 * conversation the customer is complaining about.
 *
 * This module fixes the *seam*, deliberately and narrowly:
 *
 *   • one `ChatLogger` interface the host can implement
 *   • one `traceId` minted per request and stamped on every line for that turn
 *   • one event vocabulary, so `turn.finish` means the same thing everywhere
 *
 * ──────────────────────────────────────────────────────────────────────────
 * What this is NOT
 * ──────────────────────────────────────────────────────────────────────────
 *
 * This is not OpenTelemetry, and it deliberately does not depend on it. Adding
 * `@opentelemetry/*` to a widget package would push a heavy, version-fragile
 * transitive tree onto every consumer to serve the subset who want it. Instead
 * this is the *seam* an OTel adapter plugs into: a host that wants spans
 * implements `ChatLogger`, opens a span per `traceId`, and gets full fidelity
 * with zero cost to everyone else. That adapter is tracked separately (#109).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Contract for implementers
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A `ChatLogger` MUST NOT throw and MUST NOT block. It sits on the hot path of
 * every turn; a logger that throws would turn a successful answer into a 500,
 * and one that awaits a network write would add latency to every token. The
 * handler wraps every call in a try/catch as defence in depth, but implement
 * accordingly: buffer and flush out of band.
 */

import type { ChatErrorKind } from './errors';

/** Standard severity ladder. `debug` is for per-chunk / per-step volume. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * The canonical event vocabulary.
 *
 * Typed as a union of known events *plus* `(string & {})`, so the known names
 * autocomplete and typo-check while a host or future feature can still emit
 * something bespoke without a package release.
 */
export type ChatLogEvent =
  /** A chat turn began. Carries model + message counts. */
  | 'turn.start'
  /** A chat turn completed normally. Carries durationMs, finishReason, usage. */
  | 'turn.finish'
  /** A chat turn failed. Carries the error taxonomy fields. */
  | 'turn.error'
  /** The client disconnected, or the wall-clock cap fired. Not a failure. */
  | 'turn.abort'
  /** The model finished a step. Carries stepCount and any tools invoked. */
  | 'turn.step'
  /** Persisting the assistant turn failed — the loudest thing in this file. */
  | 'save.failed'
  /** Thread-title generation or rename failed (degrades to a placeholder). */
  | 'title.failed'
  /** Memory extraction failed (best-effort, post-response). */
  | 'memory.failed'
  /** Knowledge retrieval failed (the turn continues, ungrounded). */
  | 'retrieval.failed'
  /** History summarization failed (the turn continues, uncompacted). */
  | 'summarize.failed'
  /** Per-request tool resource teardown failed — a resource may have leaked. */
  | 'cleanup.failed'
  /** A history page was served. Carries limit/hasMore for pagination debugging. */
  | 'history.page'
  /** An unhandled throw reached the dispatcher and became a 500. */
  | 'request.error'
  | (string & {});

/**
 * The structured payload of one log line.
 *
 * Every field beyond `traceId` and `event` is optional because not every event
 * has every dimension — but when a field IS present it always means the same
 * thing, which is the entire point of having a shape at all.
 */
export interface ChatLogFields {
  /** Correlation id for this request. Present on every line. */
  traceId: string;
  /** The canonical event name. */
  event: ChatLogEvent;
  /** The verified user, when the request got past authentication. */
  userId?: string;
  conversationId?: string;
  messageId?: string;
  /** Model label for this turn (`anthropic/claude-…`). */
  model?: string;
  /** Tool name, for tool-scoped events. */
  toolName?: string;
  /** Wall-clock duration of whatever the event describes. */
  durationMs?: number;
  /** Error taxonomy fields, mirrored from `classifyError`. */
  kind?: ChatErrorKind;
  retryable?: boolean;
  status?: number;
  code?: string;
  /** The error's message. Never the raw error object — that is not serialisable. */
  error?: string;
  /** Stack, on `error`-level lines only, when one exists. */
  stack?: string;
  /** Event-specific extras (token counts, finishReason, page size, …). */
  [key: string]: unknown;
}

/**
 * The seam. Implement this to route chat telemetry wherever you already send
 * logs — Datadog, Pino, an OTel span, a queue.
 *
 * Must not throw and must not block. See the module doc.
 */
export interface ChatLogger {
  log(level: LogLevel, fields: ChatLogFields): void;
}

/** Discards everything. Used when `logErrors: false`. */
export const noopLogger: ChatLogger = { log: () => {} };

/**
 * The default logger: one JSON object per line on the console.
 *
 * JSON rather than pretty text because the overwhelmingly common destination is
 * a log aggregator that parses structured lines, and a human can still read it.
 * `warn`/`error` go to `console.error` so they land on stderr and survive
 * stdout-only log filters; everything else goes to `console.log`.
 */
export function createConsoleLogger(options?: { minLevel?: LogLevel }): ChatLogger {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = order[options?.minLevel ?? 'info'];
  return {
    log(level, fields) {
      if (order[level] < min) return;
      let line: string;
      try {
        line = JSON.stringify({ level, ...fields });
      } catch {
        // A caller stuffed something circular into the extras. Never lose the
        // line over it — fall back to the fields we know are safe.
        line = JSON.stringify({ level, traceId: fields.traceId, event: fields.event, serialization: 'failed' });
      }
      if (level === 'error' || level === 'warn') console.error(line);
      else console.log(line);
    },
  };
}

/**
 * Mint (or adopt) a correlation id for this request.
 *
 * If the caller already has a trace we ADOPT it rather than inventing a
 * competing one — a widget log that can't be joined to the host's request log
 * is half as useful. In precedence order:
 *
 *   1. `traceparent` (W3C Trace Context) → the 32-hex trace-id field
 *   2. `x-request-id` / `x-correlation-id` / `x-amzn-trace-id` — the de-facto
 *      headers set by Vercel, Cloudflare, ALB and most gateways
 *   3. a fresh random id
 *
 * Adopted values are length-capped and stripped of anything outside a safe
 * charset: this string lands in log lines and a response header, so a hostile
 * client must not be able to inject newlines (log forging) or header
 * terminators.
 */
export function resolveTraceId(request: { headers: Headers }): string {
  const sanitize = (raw: string | null | undefined): string | undefined => {
    if (!raw) return undefined;
    const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128);
    return cleaned.length >= 8 ? cleaned : undefined;
  };

  const traceparent = request.headers.get('traceparent');
  if (traceparent) {
    // version-traceid-spanid-flags → field 1 is the 32-hex trace id.
    const traceId = traceparent.split('-')[1];
    if (traceId && /^[0-9a-f]{32}$/i.test(traceId) && !/^0+$/.test(traceId)) return traceId;
  }
  for (const header of ['x-request-id', 'x-correlation-id', 'x-amzn-trace-id']) {
    const adopted = sanitize(request.headers.get(header));
    if (adopted) return adopted;
  }
  return newTraceId();
}

/** A fresh 32-hex trace id, W3C-shaped so it drops straight into a `traceparent`. */
export function newTraceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * A logger with request-scoped fields already bound.
 *
 * The handler creates one per turn so call sites read as
 * `log.warn('save.failed', { error })` instead of restating traceId + userId +
 * conversationId on every line — which is exactly the repetition that made the
 * old ad-hoc calls drift out of shape from one another.
 */
export interface TurnLogger {
  readonly traceId: string;
  debug(event: ChatLogEvent, fields?: Partial<ChatLogFields>): void;
  info(event: ChatLogEvent, fields?: Partial<ChatLogFields>): void;
  warn(event: ChatLogEvent, fields?: Partial<ChatLogFields>): void;
  error(event: ChatLogEvent, fields?: Partial<ChatLogFields>): void;
  /** Derive a logger with extra bound fields (a conversation id learned mid-request). */
  child(extra: Partial<ChatLogFields>): TurnLogger;
}

/**
 * Bind base fields to a `ChatLogger`.
 *
 * Every emit is wrapped: a host logger that throws must never turn a working
 * answer into a 500. We swallow rather than re-log, because the only channel
 * available to report a broken logger is the broken logger.
 */
export function createTurnLogger(logger: ChatLogger, base: Partial<ChatLogFields> & { traceId: string }): TurnLogger {
  const emit = (level: LogLevel, event: ChatLogEvent, fields?: Partial<ChatLogFields>) => {
    try {
      logger.log(level, { ...base, ...fields, traceId: base.traceId, event } as ChatLogFields);
    } catch {
      /* a logger that throws must not break the turn */
    }
  };
  return {
    traceId: base.traceId,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createTurnLogger(logger, { ...base, ...extra, traceId: base.traceId }),
  };
}

/** Normalise a thrown value into the `error` / `stack` log fields. */
export function errorFields(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) {
    return { error: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { error: typeof err === 'string' ? err : String(err) };
}

/** Header carrying the trace id back to the caller. */
export const TRACE_HEADER = 'X-Mordn-Trace-Id';
