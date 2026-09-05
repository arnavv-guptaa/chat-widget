import { describe, expect, it } from 'vitest';
import {
  CHAT_ERROR_VERSION, MAX_RETRY_AFTER_MS, parseChatErrorHeader,
  parseChatErrorMetadata, toChatErrorMetadata,
} from '../src/utils/chat-error-protocol';
import { classifyError } from '../src/server/errors';

const valid = { version: CHAT_ERROR_VERSION, kind: 'rate_limit', retryable: true, retryAfterMs: 2500, traceId: 'trace-12345678' };

describe('chat error wire protocol', () => {
  it('projects only safe fields from a real provider classification', () => {
    const cause = Object.assign(new Error('Authorization: Bearer sk-secret'), {
      statusCode: 429, responseBody: '{"error":{"code":"rate_limit_exceeded"}}',
      responseHeaders: { 'retry-after': '2.5' },
    });
    const metadata = toChatErrorMetadata(classifyError(cause), valid.traceId);
    expect(metadata).toEqual(valid);
    expect(JSON.stringify(metadata)).not.toMatch(/secret|Authorization|responseBody|cause|status|code|message/);
    expect(parseChatErrorHeader(JSON.stringify(metadata))).toEqual(metadata);
  });

  it.each([null, undefined, [], 'text', 1, {}, { ...valid, version: 2 },
    { ...valid, kind: 'future' }, { ...valid, kind: '__proto__' },
    { ...valid, kind: 'constructor' }, { ...valid, retryable: 'true' },
    { ...valid, version: '1' },
  ])('rejects malformed or unsupported core: %j', (value) => {
    expect(parseChatErrorMetadata(value)).toBeUndefined();
  });

  it('ignores unknown fields and never retains a caller-owned object', () => {
    const input = { ...valid, message: '<script>secret</script>', cause: 'secret', nested: {} };
    const parsed = parseChatErrorMetadata(input);
    expect(parsed).toEqual(valid);
    expect(parsed).not.toBe(input);
    input.kind = 'auth';
    expect(parsed?.kind).toBe('rate_limit');
  });

  it.each(['abort', 'auth', 'content_policy', 'prompt', 'model', 'tool', 'unknown'])('cannot enable retry for %s', (kind) => {
    expect(parseChatErrorMetadata({ ...valid, kind })).toEqual({ version: 1, kind, retryable: false, traceId: valid.traceId });
  });

  it.each([-1, NaN, Infinity, '100', null])('drops invalid delay %s', (retryAfterMs) => {
    expect(parseChatErrorMetadata({ ...valid, retryAfterMs })?.retryAfterMs).toBeUndefined();
  });

  it('retains zero and clamps/rounds positive delays', () => {
    expect(parseChatErrorMetadata({ ...valid, retryAfterMs: 0 })?.retryAfterMs).toBe(0);
    expect(parseChatErrorMetadata({ ...valid, retryAfterMs: 1.2 })?.retryAfterMs).toBe(2);
    expect(parseChatErrorMetadata({ ...valid, retryAfterMs: Number.MAX_VALUE })?.retryAfterMs).toBe(MAX_RETRY_AFTER_MS);
    expect(parseChatErrorMetadata({ ...valid, retryable: false })?.retryAfterMs).toBeUndefined();
  });

  it.each(['short', 'https://secret.example', 'trace-secret\n', 'x'.repeat(129)])('drops invalid trace reference %s', (traceId) => {
    expect(parseChatErrorMetadata({ ...valid, traceId })?.traceId).toBeUndefined();
  });

  it('survives hostile getters, bad JSON and oversized headers', () => {
    const hostile = Object.defineProperty({}, 'version', { get() { throw new Error('secret'); } });
    expect(parseChatErrorMetadata(hostile)).toBeUndefined();
    expect(parseChatErrorHeader('{')).toBeUndefined();
    expect(parseChatErrorHeader('x'.repeat(2049))).toBeUndefined();
  });
});
