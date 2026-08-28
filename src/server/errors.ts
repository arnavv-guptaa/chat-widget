/**
 * Error taxonomy — turning "something went wrong" into something actionable.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Before this module the handler had exactly one user-facing failure string
 * and no notion of *what kind* of failure had occurred. A 429 from the
 * provider, an expired API key, a blown context window, and a genuine 500 all
 * collapsed into "An error occurred while generating the response." A host
 * that wanted to retry-with-backoff on rate limits, surface "your key is
 * invalid" to an operator, or tell a user their message was too long had to
 * write the classifier themselves — in their own `onError`, against provider
 * error shapes we already have in hand.
 *
 * That is the burden this package exists to absorb. Classification is
 * infrastructure, not application logic.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why it duck-types instead of using `instanceof`
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `ai` is a PEER dependency spanning `^6.0.0`, and the concrete provider
 * packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, the
 * gateway) are not dependencies at all. Importing error classes to
 * `instanceof` against would (a) couple us to one point in that range, (b)
 * break silently when a provider is loaded from a different copy of the SDK in
 * the host's tree — the classic dual-package `instanceof` failure — and (c)
 * miss raw provider errors that never became SDK classes.
 *
 * So we read *shape*: `name`, `statusCode`/`status`, the parsed `responseBody`,
 * the provider's own `type`/`code` discriminants, and response headers. That
 * is stable across SDK minors and works on errors the SDK never wrapped.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Design rules
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  1. NEVER throw. Classification runs on an already-failing path; a throw
 *     here would replace a real error with a confusing one. Every helper is
 *     defensive and the whole entry point is wrapped.
 *  2. Prefer a WRONG-but-safe answer to a wrong-and-dangerous one. When
 *     signals conflict we bias toward `retryable: false` — a missed retry
 *     costs one failed turn; a retry loop against a content-policy block or a
 *     bad key costs money and can get an account limited.
 *  3. `unknown` is a legitimate answer. Guessing a category we cannot support
 *     is worse than admitting we do not know.
 */

/**
 * What kind of failure this is, in terms of what the caller should DO about it.
 *
 * The axis is deliberately "what action does this imply", not "which layer
 * threw" — a category the host cannot act on differently is not worth having.
 */
export type ChatErrorKind =
  /** Client disconnected, or the wall-clock cap fired. Not a failure at all. */
  | 'abort'
  /** 429 / quota exhausted. Retry after `retryAfterMs`. */
  | 'rate_limit'
  /** Bad, missing, or expired credentials. The OPERATOR must fix this; retrying never helps. */
  | 'auth'
  /** 5xx, network blip, upstream overloaded. Retry with backoff. */
  | 'transient'
  /** The provider refused on safety grounds. Never retry — the same input yields the same refusal. */
  | 'content_policy'
  /** The request was malformed or too large. The CALLER must change the input. */
  | 'prompt'
  /** Model limitation: context window exceeded, unknown model, unsupported feature. */
  | 'model'
  /** A tool call threw. The turn failed, but the model and provider are healthy. */
  | 'tool'
  /** Genuinely unrecognised. Treated as non-retryable. */
  | 'unknown';

/** The result of classifying a stream/turn failure. */
export interface ClassifiedChatError {
  /** The actionable category. */
  kind: ChatErrorKind;
  /**
   * Is a straight retry of the same request likely to succeed?
   *
   * `true` only for `rate_limit` and `transient`. Deliberately conservative:
   * a retry against a content-policy block or an invalid key burns money and
   * quota to arrive at the identical failure.
   */
  retryable: boolean;
  /**
   * How long to wait before retrying, in ms, when the provider told us.
   * Parsed from `Retry-After` (delta-seconds or HTTP-date) or from the
   * provider's own rate-limit reset headers. `undefined` means "we were not
   * told" — back off on your own schedule, do not treat it as zero.
   */
  retryAfterMs?: number;
  /** Upstream HTTP status, when the failure carried one. */
  status?: number;
  /** The provider's own machine-readable code (`rate_limit_exceeded`, `overloaded_error`, …). */
  code?: string;
  /** A safe, user-facing sentence for this category. Never contains provider internals. */
  message: string;
  /**
   * The original thrown value, untouched.
   *
   * Log it, report it, re-classify it — but do not put it in front of a user:
   * provider errors routinely echo prompt fragments and occasionally key
   * prefixes.
   */
  cause: unknown;
}

// ── User-facing copy ─────────────────────────────────────────────────────────
// One sentence per category. These are what a user actually sees, so they say
// what happened and what to do, and never leak upstream detail.
//
// `abort` copy intentionally contains "abort": the client error banner
// suppresses abort-shaped messages so a stopped turn renders as the partial
// answer it is rather than an error strip.
const MESSAGES: Record<ChatErrorKind, string> = {
  abort: 'The response was aborted.',
  rate_limit: 'The assistant is handling a lot of requests right now. Please try again in a moment.',
  auth: 'The assistant is not configured correctly. Please contact support.',
  transient: 'The assistant is temporarily unavailable. Please try again.',
  content_policy: "I can't help with that request.",
  prompt: "That request couldn't be processed. Try rephrasing or shortening your message.",
  model: 'The configured model could not complete this request. Try a different request or contact support.',
  tool: 'A tool the assistant was using failed. Please try again.',
  unknown: 'An error occurred while generating the response.',
};

/** The user-facing sentence for a category. Exported so hosts can reuse or localise it. */
export function messageForErrorKind(kind: ChatErrorKind): string {
  return MESSAGES[kind] ?? MESSAGES.unknown;
}

// ── Shape probes ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Follow `cause` a bounded number of hops. Providers nest 2-3 deep; the cap stops a cycle. */
function causeChain(err: unknown, max = 5): unknown[] {
  const chain: unknown[] = [];
  let current = err;
  const seen = new Set<unknown>();
  while (current != null && chain.length < max && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = asRecord(current)?.cause;
  }
  return chain;
}

/**
 * Is this the AbortController firing rather than a real failure?
 *
 * Aborts arrive in several shapes depending on runtime and provider: a
 * DOMException named `AbortError` (undici / browsers), a plain Error with that
 * name, an SDK-wrapped abort, or Node's standard `ABORT_ERR` code. We do not
 * classify by message text because upstream gateways also use "aborted" for
 * real failures that must remain visible.
 *
 * Conservative by design: a false negative logs one extra error, a false
 * positive silently swallows a genuine outage.
 */
export function isAbortError(err: unknown): boolean {
  for (const link of causeChain(err)) {
    const rec = asRecord(link);
    if (!rec) continue;
    const name = str(rec.name);
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    // Node/undici may preserve only the standard abort code. Do not classify
    // free text containing "aborted": upstream gateways use that word for real
    // transport failures, and a false positive would silently suppress them.
    if (str(rec.code).toUpperCase() === 'ABORT_ERR') return true;
  }
  return false;
}

/** Pull an HTTP status off any of the several fields providers and the SDK use. */
function extractStatus(err: unknown): number | undefined {
  for (const link of causeChain(err)) {
    const rec = asRecord(link);
    if (!rec) continue;
    for (const key of ['statusCode', 'status', 'httpStatus']) {
      const value = rec[key];
      if (typeof value === 'number' && value >= 100 && value <= 599) return value;
    }
    // Undici/fetch responses hung off the error.
    const response = asRecord(rec.response);
    if (response && typeof response.status === 'number') return response.status;
  }
  return undefined;
}

/**
 * The provider's machine-readable discriminant.
 *
 * Every major provider nests this differently:
 *   OpenAI     `{ error: { code: 'rate_limit_exceeded', type: 'insufficient_quota' } }`
 *   Anthropic  `{ error: { type: 'overloaded_error' } }`
 *   Google     `{ error: { status: 'RESOURCE_EXHAUSTED' } }`
 * plus Node's `err.code` (`ECONNRESET`) for transport failures. We look in all
 * of them and return the first non-empty hit.
 */
function extractCode(err: unknown): string | undefined {
  for (const link of causeChain(err)) {
    const rec = asRecord(link);
    if (!rec) continue;

    // Prefer nested provider errors over envelope discriminants such as
    // Anthropic's outer `{ type: "error" }`.
    const nested: Array<Record<string, unknown>> = [];
    const direct: Array<Record<string, unknown>> = [rec];
    const directError = asRecord(rec.error);
    if (directError) nested.push(directError);
    const data = asRecord(rec.data);
    if (data) {
      direct.push(data);
      const dataError = asRecord(data.error);
      if (dataError) nested.push(dataError);
    }

    const body = rec.responseBody;
    if (typeof body === 'string' && body.length > 0 && body.length < 100_000) {
      try {
        const parsed = asRecord(JSON.parse(body));
        if (parsed) {
          direct.push(parsed);
          const parsedError = asRecord(parsed.error);
          if (parsedError) nested.push(parsedError);
        }
      } catch {
        /* not JSON — fine, the text probe below still sees it */
      }
    }

    for (const candidate of [...nested, ...direct]) {
      const code =
        str(candidate.code) ||
        str(candidate.type) ||
        str(candidate.status) ||
        str(candidate.reason);
      if (code) return code;
    }
  }
  return undefined;
}

/** Every string we can safely search, lowercased and joined. Used only for last-resort probes. */
function searchableText(err: unknown): string {
  const parts: string[] = [];
  for (const link of causeChain(err)) {
    const rec = asRecord(link);
    if (!rec) continue;
    parts.push(str(rec.message));
    const body = rec.responseBody;
    if (typeof body === 'string') parts.push(body.slice(0, 4000));
  }
  return parts.join(' \n ').toLowerCase();
}

/** Case-insensitive header read across the several shapes the SDK hands back. */
function readHeader(err: unknown, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const link of causeChain(err)) {
    const rec = asRecord(link);
    if (!rec) continue;
    const containers = [rec.responseHeaders, asRecord(rec.response)?.headers];
    for (const container of containers) {
      if (!container) continue;
      // A real Headers instance.
      if (typeof (container as Headers).get === 'function') {
        try {
          const value = (container as Headers).get(target);
          if (value) return value;
        } catch {
          /* not a Headers after all */
        }
        continue;
      }
      const plain = asRecord(container);
      if (!plain) continue;
      for (const [key, value] of Object.entries(plain)) {
        if (key.toLowerCase() === target && typeof value === 'string' && value) return value;
      }
    }
  }
  return undefined;
}

/**
 * How long the provider told us to wait, in ms.
 *
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110). Anthropic
 * and OpenAI additionally publish absolute reset timestamps on their own
 * headers, which we fall back to.
 *
 * Clamped to [0, 15min] so a malformed or hostile header cannot park a retry
 * loop for hours. The ceiling is 15 minutes rather than something tighter
 * because real token-bucket resets genuinely run to several minutes (OpenAI
 * routinely returns `6m0s` on a tier-1 token limit) — clamping below that
 * would report a delay we already know is too short, and the caller would just
 * earn a second 429.
 */
function extractRetryAfterMs(err: unknown): number | undefined {
  const MAX = 15 * 60_000;
  const clamp = (ms: number) => Math.max(0, Math.min(Math.round(ms), MAX));

  const retryAfter = readHeader(err, 'retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return clamp(seconds * 1000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return clamp(at - Date.now());
  }

  // A provider can report independent request and token buckets. When it does
  // not identify which bucket was exhausted, the only safe retry is after the
  // latest applicable reset; choosing the first/shortest can immediately earn
  // another 429.
  const resets: number[] = [];
  for (const header of [
    'anthropic-ratelimit-requests-reset',
    'anthropic-ratelimit-tokens-reset',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens',
    'x-ratelimit-reset',
  ]) {
    const raw = readHeader(err, header);
    if (!raw) continue;
    const duration = parseDuration(raw);
    if (duration !== undefined) {
      resets.push(clamp(duration));
      continue;
    }
    const at = Date.parse(raw);
    if (Number.isFinite(at)) {
      resets.push(clamp(at - Date.now()));
      continue;
    }
    const epoch = Number(raw);
    if (Number.isFinite(epoch) && epoch > 1_000_000_000) {
      resets.push(clamp(epoch * 1000 - Date.now()));
    }
  }
  return resets.length > 0 ? Math.max(...resets) : undefined;
}

/** Parse OpenAI-style compound durations: `120ms`, `1s`, `6m0s`, `1h2m3s`. */
function parseDuration(raw: string): number | undefined {
  const text = raw.trim().toLowerCase();
  if (!/^(\d+(\.\d+)?(ms|s|m|h))+$/.test(text)) return undefined;
  let total = 0;
  const unit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  for (const [, value, , suffix] of text.matchAll(/(\d+(\.\d+)?)(ms|s|m|h)/g)) {
    total += Number(value) * unit[suffix];
  }
  return total;
}

// ── Signal tables ────────────────────────────────────────────────────────────
// Provider discriminants grouped by the category they imply. Matched against
// the extracted `code` first (precise), then against free text (last resort).

const CODES: Array<[ChatErrorKind, readonly string[]]> = [
  ['rate_limit', ['rate_limit_exceeded', 'rate_limit_error', 'resource_exhausted', 'too_many_requests', 'throttlingexception']],
  // Hard quota/billing exhaustion requires operator action; retrying the same
  // request cannot succeed and risks a paid retry loop.
  ['auth', ['invalid_api_key', 'authentication_error', 'invalid_authentication', 'permission_denied', 'unauthenticated', 'permission_error', 'account_deactivated', 'insufficient_quota', 'quota_exceeded', 'ai_loadapikeyerror']],
  ['content_policy', ['content_filter', 'content_policy_violation', 'safety', 'blocked', 'prohibited_content', 'recitation']],
  ['model', ['context_length_exceeded', 'string_above_max_length', 'model_not_found', 'ai_nosuchmodelerror', 'ai_unsupportedfunctionalityerror', 'ai_toomanyembeddingvaluesforcallerror']],
  ['prompt', ['invalid_request_error', 'invalid_argument', 'ai_invalidprompterror', 'ai_invalidargumenterror', 'ai_typevalidationerror', 'ai_invalidmessageroleerror', 'ai_messageconversionerror', 'failed_precondition']],
  ['tool', ['ai_toolexecutionerror', 'ai_invalidtoolinputerror', 'ai_notoolgeneratederror', 'ai_toolcallrepairerror']],
  ['transient', ['overloaded_error', 'econnreset', 'econnrefused', 'etimedout', 'esockettimedout', 'enotfound', 'eai_again', 'epipe', 'und_err_connect_timeout', 'und_err_socket', 'und_err_headers_timeout', 'server_error', 'api_error', 'internal', 'unavailable', 'service_unavailable', 'deadline_exceeded', 'ai_retryerror']],
];

/** Status → category, for the (common) case where there is no usable code. */
function kindFromStatus(status: number): ChatErrorKind | undefined {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403 || status === 402) return 'auth';
  if (status === 408 || status === 409 || status === 425 || status === 529) return 'transient';
  if (status >= 500) return 'transient';
  if (status === 413 || status === 422) return 'prompt';
  if (status === 400 || status === 404) return undefined; // far too ambiguous alone
  return undefined;
}

/**
 * Last-resort free-text probes.
 *
 * Ordered most- to least-specific and matched against message + response body.
 * These exist because providers regularly ship a 400 whose only distinguishing
 * feature is prose ("maximum context length is 200000 tokens"). Phrases are
 * chosen to be narrow enough that a normal user message quoted back in an
 * error cannot plausibly trip them.
 */
const TEXT_SIGNALS: Array<[ChatErrorKind, RegExp]> = [
  ['model', /maximum context length|context[_ ]length[_ ]exceeded|too many tokens|prompt is too long|exceeds the maximum|reduce the length of the messages/],
  ['content_policy', /content[_ ](policy|filter)|safety (system|settings|filter)|flagged (as|by)|violat(es|ing) (our )?(usage )?polic|refus(al|ed) to (respond|generate)/],
  ['auth', /invalid[_ ]api[_ ]key|incorrect api key|api key (not|is not) (found|valid|provided)|unauthorized|authentication fail|missing (the )?credential/],
  ['rate_limit', /rate[_ ]limit|too many requests|quota (exceeded|reached)|exceeded your current quota/],
  ['transient', /overloaded|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|socket hang up|fetch failed|network (error|timeout)|connection (reset|refused|closed)|upstream connect error/],
];

const RETRYABLE: ReadonlySet<ChatErrorKind> = new Set<ChatErrorKind>(['rate_limit', 'transient']);

/**
 * Classify a thrown value into an actionable category.
 *
 * Precedence, most to least trustworthy:
 *   1. abort              — a signal we raised ourselves; never a failure
 *   2. the SDK's own `isRetryable: true` on an APICall-shaped error
 *   3. the provider's machine-readable code / type / status discriminant
 *   4. the HTTP status
 *   5. narrow free-text probes
 *   6. `unknown`
 *
 * Never throws: any internal failure degrades to an `unknown` classification
 * carrying the original error.
 */
export function classifyError(err: unknown): ClassifiedChatError {
  try {
    return classifyInner(err);
  } catch {
    return { kind: 'unknown', retryable: false, message: MESSAGES.unknown, cause: err };
  }
}

function classifyInner(err: unknown): ClassifiedChatError {
  if (isAbortError(err)) {
    return { kind: 'abort', retryable: false, message: MESSAGES.abort, cause: err };
  }

  const status = extractStatus(err);
  const code = extractCode(err);
  const normalizedCode = code?.toLowerCase().trim();
  const finish = (kind: ChatErrorKind): ClassifiedChatError => ({
    kind,
    retryable: RETRYABLE.has(kind),
    ...(RETRYABLE.has(kind) ? { retryAfterMs: extractRetryAfterMs(err) } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(code ? { code } : {}),
    message: MESSAGES[kind],
    cause: err,
  });

  // 2 — the SDK already decided this is worth retrying. Trust it, but only
  // when nothing more specific is available: `isRetryable` is a boolean, and a
  // 429 is better reported as `rate_limit` than as generic `transient`.
  const sdkRetryable = causeChain(err).some((link) => asRecord(link)?.isRetryable === true);

  // 3 — the provider's own discriminant, the most precise signal we get.
  if (normalizedCode) {
    for (const [kind, codes] of CODES) {
      if (codes.includes(normalizedCode)) return finish(kind);
    }
  }
  // The SDK prefixes its error classes (`AI_InvalidPromptError`); `name` is a
  // discriminant even when no provider code came back.
  const names = causeChain(err)
    .map((link) => str(asRecord(link)?.name).toLowerCase())
    .filter(Boolean);
  for (const [kind, codes] of CODES) {
    if (names.some((n) => codes.includes(n))) return finish(kind);
  }

  // 4 — HTTP status.
  if (status !== undefined) {
    const byStatus = kindFromStatus(status);
    if (byStatus) return finish(byStatus);
  }

  // 5 — narrow prose probes for the providers that only distinguish in text.
  const text = searchableText(err);
  if (text) {
    for (const [kind, pattern] of TEXT_SIGNALS) {
      if (pattern.test(text)) return finish(kind);
    }
  }

  // 2 (deferred) — nothing specific matched, so fall back to the SDK's hint.
  if (sdkRetryable) return finish('transient');

  // A 400 that matched nothing above really is a malformed request.
  if (status === 400) return finish('prompt');

  return finish('unknown');
}
