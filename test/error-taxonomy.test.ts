import { describe, it, expect } from 'vitest';
import { classifyError, isAbortError, messageForErrorKind } from '../src/server/errors';

/**
 * Fixtures modelled on the shapes these errors ACTUALLY arrive in — an AI SDK
 * `APICallError` carrying `statusCode` + `responseBody` + `responseHeaders`,
 * with the provider's own payload nested inside. Classifying a hand-rolled
 * `new Error('rate limit')` would prove nothing; the whole point of the module
 * is that it survives real provider shapes.
 */
function apiCallError(init: {
  message?: string;
  statusCode?: number;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  isRetryable?: boolean;
  name?: string;
}): Error {
  const err = new Error(init.message ?? 'API call failed');
  err.name = init.name ?? 'AI_APICallError';
  return Object.assign(err, {
    statusCode: init.statusCode,
    responseBody: typeof init.responseBody === 'string' ? init.responseBody : JSON.stringify(init.responseBody),
    responseHeaders: init.responseHeaders,
    isRetryable: init.isRetryable,
  });
}

describe('isAbortError', () => {
  it('recognises a DOMException-style AbortError', () => {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('recognises a TimeoutError', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    expect(isAbortError(err)).toBe(true);
  });

  it('recognises an abort nested behind cause', () => {
    const inner = new Error('The operation was aborted.');
    inner.name = 'AbortError';
    const outer = new Error('tool execution failed');
    outer.name = 'AI_ToolExecutionError';
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(isAbortError(outer)).toBe(true);
  });

  it('recognises Node aborts by standard code', () => {
    expect(isAbortError(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' }))).toBe(true);
  });

  it('does not suppress a real upstream failure merely because its message says aborted', () => {
    expect(isAbortError(new Error('request was aborted by the upstream gateway'))).toBe(false);
  });

  it('does NOT treat an ordinary failure as an abort', () => {
    expect(isAbortError(new Error('rate limit exceeded'))).toBe(false);
    expect(isAbortError(new Error('aborting is not mentioned here'))).toBe(false); // "aborting" != "aborted"
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('survives a self-referential cause without hanging', () => {
    const err = new Error('boom') as Error & { cause?: unknown };
    err.cause = err;
    expect(isAbortError(err)).toBe(false);
  });
});

describe('classifyError — rate limits', () => {
  it('classifies an OpenAI 429', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 429,
        responseBody: { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } },
      }),
    );
    expect(result.kind).toBe('rate_limit');
    expect(result.retryable).toBe(true);
    expect(result.status).toBe(429);
  });

  it('classifies an Anthropic rate_limit_error', () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: { type: 'error', error: { type: 'rate_limit_error' } } }),
    );
    expect(result.kind).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it("classifies Google's RESOURCE_EXHAUSTED", () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: { error: { status: 'RESOURCE_EXHAUSTED' } } }),
    );
    expect(result.kind).toBe('rate_limit');
  });

  it('parses Retry-After as delta-seconds', () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: { 'retry-after': '30' } }),
    );
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('parses Retry-After as an HTTP-date', () => {
    const at = new Date(Date.now() + 45_000).toUTCString();
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: { 'Retry-After': at } }),
    );
    // Second-resolution date, so allow a little slack.
    expect(result.retryAfterMs).toBeGreaterThan(42_000);
    expect(result.retryAfterMs).toBeLessThanOrEqual(46_000);
  });

  it("parses OpenAI's compound duration reset header", () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: { 'x-ratelimit-reset-tokens': '6m0s' } }),
    );
    expect(result.retryAfterMs).toBe(360_000);
  });

  it('clamps an absurd Retry-After to the 15-minute ceiling', () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: { 'retry-after': '999999' } }),
    );
    expect(result.retryAfterMs).toBe(900_000);
  });

  it('does NOT clamp a realistic multi-minute token-bucket reset', () => {
    // Regression guard: a 5-minute ceiling silently truncated OpenAI's very
    // common `6m0s` token reset, reporting a delay we already knew was short.
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: { 'x-ratelimit-reset-tokens': '6m0s' } }),
    );
    expect(result.retryAfterMs).toBe(360_000);
  });

  it('uses the latest reset when independent request and token buckets are reported', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 429,
        responseBody: {},
        responseHeaders: {
          'x-ratelimit-reset-requests': '1s',
          'x-ratelimit-reset-tokens': '6m0s',
        },
      }),
    );
    expect(result.retryAfterMs).toBe(360_000);
  });

  it('reads headers from a real Headers instance', () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: {}, responseHeaders: new Headers({ 'retry-after': '12' }) as never }),
    );
    expect(result.retryAfterMs).toBe(12_000);
  });
});

describe('classifyError — auth', () => {
  it('classifies an OpenAI invalid_api_key 401', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 401,
        responseBody: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } },
      }),
    );
    expect(result.kind).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('classifies an Anthropic authentication_error', () => {
    const result = classifyError(
      apiCallError({ statusCode: 401, responseBody: { error: { type: 'authentication_error' } } }),
    );
    expect(result.kind).toBe('auth');
  });

  it("classifies the SDK's LoadAPIKeyError by class name alone", () => {
    const err = new Error('OpenAI API key is missing');
    err.name = 'AI_LoadAPIKeyError';
    expect(classifyError(err).kind).toBe('auth');
  });

  it('classifies hard quota exhaustion as operator-actionable and non-retryable', () => {
    const result = classifyError({
      statusCode: 429,
      error: { type: 'insufficient_quota' },
    });
    expect(result.kind).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('never marks auth retryable — retrying a bad key just burns quota', () => {
    expect(classifyError(apiCallError({ statusCode: 403, responseBody: {} })).retryable).toBe(false);
  });
});

describe('classifyError — transient', () => {
  it('classifies an Anthropic 529 overloaded_error', () => {
    const result = classifyError(
      apiCallError({ statusCode: 529, responseBody: { error: { type: 'overloaded_error' } } }),
    );
    expect(result.kind).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies raw Anthropic error payloads without an SDK wrapper', () => {
    expect(classifyError({ type: 'error', error: { type: 'overloaded_error' } }).kind).toBe('transient');
  });

  it('classifies raw Google error payloads without an SDK wrapper', () => {
    expect(classifyError({ error: { status: 'RESOURCE_EXHAUSTED' } }).kind).toBe('rate_limit');
  });

  it('classifies a bare 503', () => {
    expect(classifyError(apiCallError({ statusCode: 503, responseBody: '' })).kind).toBe('transient');
  });

  it('classifies a Node socket failure by code', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const result = classifyError(err);
    expect(result.kind).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('classifies an undici "fetch failed" by prose', () => {
    expect(classifyError(new Error('fetch failed')).kind).toBe('transient');
  });

  it("falls back to the SDK's isRetryable hint when nothing else matches", () => {
    const result = classifyError(apiCallError({ message: 'inscrutable', responseBody: '', isRetryable: true }));
    expect(result.kind).toBe('transient');
    expect(result.retryable).toBe(true);
  });

  it('prefers rate_limit over the generic isRetryable hint', () => {
    const result = classifyError(
      apiCallError({ statusCode: 429, responseBody: { error: { code: 'rate_limit_exceeded' } }, isRetryable: true }),
    );
    expect(result.kind).toBe('rate_limit');
  });
});

describe('classifyError — content policy', () => {
  it('classifies an OpenAI content_policy_violation', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 400,
        responseBody: { error: { code: 'content_policy_violation', message: 'Your request was rejected' } },
      }),
    );
    expect(result.kind).toBe('content_policy');
    expect(result.retryable).toBe(false);
  });

  it("classifies Google's SAFETY block", () => {
    const result = classifyError(apiCallError({ statusCode: 400, responseBody: { error: { status: 'SAFETY' } } }));
    expect(result.kind).toBe('content_policy');
  });

  it('is never retryable — the same input yields the same refusal', () => {
    const result = classifyError(new Error('Request flagged by our content filter'));
    expect(result.kind).toBe('content_policy');
    expect(result.retryable).toBe(false);
  });
});

describe('classifyError — model limitations', () => {
  it('classifies context_length_exceeded', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 400,
        responseBody: { error: { code: 'context_length_exceeded', message: "This model's maximum context length is 128000 tokens" } },
      }),
    );
    expect(result.kind).toBe('model');
    expect(result.retryable).toBe(false);
  });

  it('classifies a prose-only context overflow', () => {
    expect(
      classifyError(new Error('prompt is too long: 250000 tokens > 200000 maximum')).kind,
    ).toBe('model');
  });

  it("classifies the SDK's NoSuchModelError", () => {
    const err = new Error('No such model: gpt-9');
    err.name = 'AI_NoSuchModelError';
    expect(classifyError(err).kind).toBe('model');
  });
});

describe('classifyError — prompt and tool', () => {
  it('classifies an unmatched 400 as a prompt problem', () => {
    expect(classifyError(apiCallError({ statusCode: 400, responseBody: '' })).kind).toBe('prompt');
  });

  it('classifies a 413 payload-too-large as a prompt problem', () => {
    expect(classifyError(apiCallError({ statusCode: 413, responseBody: '' })).kind).toBe('prompt');
  });

  it("classifies the SDK's InvalidPromptError", () => {
    const err = new Error('Invalid prompt');
    err.name = 'AI_InvalidPromptError';
    expect(classifyError(err).kind).toBe('prompt');
  });

  it('classifies a tool execution failure', () => {
    const err = new Error('Error executing tool searchDocs');
    err.name = 'AI_ToolExecutionError';
    const result = classifyError(err);
    expect(result.kind).toBe('tool');
    expect(result.retryable).toBe(false);
  });
});

describe('classifyError — aborts and unknowns', () => {
  it('classifies an abort as kind "abort", not an error', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const result = classifyError(err);
    expect(result.kind).toBe('abort');
    expect(result.retryable).toBe(false);
  });

  it('abort copy stays abort-shaped so the client banner suppresses it', () => {
    // Load-bearing coupling with chat-error-banner.tsx, which hides
    // abort-shaped messages. If this assertion is changed, that banner must
    // change with it or a stopped turn starts rendering as a red error.
    expect(messageForErrorKind('abort')).toMatch(/abort/i);
  });

  it('admits when it does not know', () => {
    const result = classifyError(new Error('something deeply weird happened'));
    expect(result.kind).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('never throws on hostile or malformed input', () => {
    for (const value of [null, undefined, 0, '', 'a string', [], {}, Symbol('x'), new Date()]) {
      expect(() => classifyError(value)).not.toThrow();
      expect(classifyError(value).kind).toBeTypeOf('string');
    }
  });

  it('survives an unparseable responseBody', () => {
    const result = classifyError(apiCallError({ statusCode: 500, responseBody: '<html>502 Bad Gateway</html>' }));
    expect(result.kind).toBe('transient');
  });

  it('always preserves the original error as cause', () => {
    const original = new Error('original');
    expect(classifyError(original).cause).toBe(original);
  });

  it('never leaks provider internals into the user-facing message', () => {
    const result = classifyError(
      apiCallError({
        statusCode: 401,
        responseBody: { error: { message: 'Incorrect API key provided: sk-abc123xyz' } },
      }),
    );
    expect(result.message).not.toMatch(/sk-abc123xyz/);
  });
});

describe('messageForErrorKind', () => {
  it('has distinct, non-empty copy for every kind', () => {
    const kinds = ['abort', 'rate_limit', 'auth', 'transient', 'content_policy', 'prompt', 'model', 'tool', 'unknown'] as const;
    const seen = new Set<string>();
    for (const kind of kinds) {
      const message = messageForErrorKind(kind);
      expect(message.length, kind).toBeGreaterThan(0);
      seen.add(message);
    }
    expect(seen.size).toBe(kinds.length);
  });
});
