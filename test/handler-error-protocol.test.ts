import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import type { CreateChatHandlerOptions } from '../src/server/handler-types';
import { CHAT_ERROR_HEADER, messageForErrorKind, parseChatErrorHeader } from '../src/utils/chat-error-protocol';

// Keep the real SDK UI stream writer/SSE serialization, replace only generation.
const streamTextMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('ai')>(), streamText: streamTextMock,
}));

const secret = 'sk-test-provider-secret';
const upstream = Object.assign(new Error(`Authorization: Bearer ${secret}`), {
  statusCode: 429, responseHeaders: { 'retry-after': '3' },
  responseBody: '{"error":{"code":"rate_limit_exceeded"}}',
});

function setup(options: Partial<CreateChatHandlerOptions> = {}) {
  const cleanup = vi.fn(async () => {});
  const store: ChatStore = {
    userId: 'verified',
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    ensureConversation: vi.fn(async (id: string) => ({ id, title: 'Existing', metadata: null, createdAt: new Date(0), updatedAt: new Date(0) })),
    renameConversation: vi.fn(async () => {}), deleteConversation: vi.fn(async () => true),
    listMessages: vi.fn(async () => []), saveTurn: vi.fn(async () => {}),
  };
  const handler = createChatHandler({
    getUserId: async () => 'verified', model: 'test/model', store: () => store,
    buildTools: async () => ({ tools: {}, cleanup }), titles: false,
    logErrors: false, ...options,
  });
  return { handler, store, cleanup };
}
function request(body: unknown = { id: 'c1', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }, signal?: AbortSignal) {
  return new Request('https://example.test/api/chat', {
    method: 'POST', body: JSON.stringify(body), signal,
    headers: { 'content-type': 'application/json', 'origin': 'https://widget.example' },
  });
}
function chunks(sse: string): Array<Record<string, any>> {
  return sse.split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)));
}
function mockFailure(error: unknown = upstream, beforeMap?: () => void) {
  streamTextMock.mockImplementation(() => ({
    toUIMessageStream({ onError }: { onError: (error: unknown) => string }) {
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: 'start', messageId: 'a1' });
          beforeMap?.();
          const errorText = onError(error);
          // A wrapped stream can map the same failure twice. Callback/data/cleanup
          // must remain once-per-turn even when the SDK calls both seams.
          expect(onError(error)).toBe(errorText);
          controller.enqueue({ type: 'error', errorText });
          controller.close();
        },
      });
    },
  }));
}
beforeEach(() => { streamTextMock.mockReset(); mockFailure(); });

describe('handler typed error integration', () => {
  it('emits one transient metadata part before the legacy safe error chunk', async () => {
    const onError = vi.fn(() => 'Localized safe callback copy');
    const { handler, cleanup, store } = setup({ onError });
    const response = await handler.POST(request());
    expect(response.status).toBe(200);
    const wire = await response.text();
    const parts = chunks(wire);
    const metadata = parts.filter((part) => part.type === 'data-chat-error');
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toEqual({ type: 'data-chat-error', transient: true, data: {
      version: 1, kind: 'rate_limit', retryable: true, retryAfterMs: 3000,
      traceId: response.headers.get('X-Mordn-Trace-Id'),
    } });
    expect(parts.findIndex((part) => part.type === 'data-chat-error')).toBeLessThan(parts.findIndex((part) => part.type === 'error'));
    expect(parts.find((part) => part.type === 'error')?.errorText).toBe('Localized safe callback copy');
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(upstream, expect.objectContaining({ kind: 'rate_limit', retryable: true }));
    expect(wire).not.toContain(secret);
    expect(JSON.stringify(metadata)).not.toMatch(/cause|responseBody|statusCode|message|stack/);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(store.saveTurn).mock.calls)).not.toContain('data-chat-error');
  });

  it('falls back safely if the legacy mapper throws', async () => {
    const onError = vi.fn(() => { throw new Error(`callback ${secret}`); });
    const { handler, cleanup } = setup({ onError });
    const wire = await (await handler.POST(request())).text();
    expect(wire).toContain(messageForErrorKind('rate_limit'));
    expect(wire).not.toContain(secret);
    expect(onError).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not let custom copy change machine recovery semantics', async () => {
    mockFailure(Object.assign(new Error(secret), { statusCode: 401 }));
    const { handler } = setup({ onError: () => messageForErrorKind('transient') });
    const parts = chunks(await (await handler.POST(request())).text());
    expect(parts.find((part) => part.type === 'data-chat-error')?.data).toMatchObject({ kind: 'auth', retryable: false });
    expect(parts.find((part) => part.type === 'error')?.errorText).toBe(messageForErrorKind('transient'));
  });

  it('suppresses only an owned user abort, not upstream abort-shaped failures', async () => {
    const error = Object.assign(new Error('upstream cancelled'), { name: 'AbortError' });
    mockFailure(error);
    const upstreamHandler = setup();
    const upstreamParts = chunks(await (await upstreamHandler.handler.POST(request())).text());
    expect(upstreamParts.find((part) => part.type === 'data-chat-error')?.data.kind).toBe('transient');

    const abort = new AbortController();
    const onError = vi.fn(() => 'should not be called');
    mockFailure(error, () => abort.abort());
    const ownedHandler = setup({ onError });
    const ownedParts = chunks(await (await ownedHandler.handler.POST(request(undefined, abort.signal))).text());
    expect(ownedParts.find((part) => part.type === 'data-chat-error')?.data).toMatchObject({ kind: 'abort', retryable: false });
    expect(ownedParts.find((part) => part.type === 'error')?.errorText).toBe(messageForErrorKind('abort'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('distinguishes the wall-clock timeout from a user stop while preserving legacy copy', async () => {
    streamTextMock.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => ({
      toUIMessageStream({ onError }: { onError: (error: unknown) => string }) {
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: 'timeout-a1' });
            const finish = () => {
              const errorText = onError(Object.assign(new Error('timeout'), { name: 'AbortError' }));
              controller.enqueue({ type: 'error', errorText });
              controller.close();
            };
            if (abortSignal.aborted) finish();
            else abortSignal.addEventListener('abort', finish, { once: true });
          },
        });
      },
    }));
    const onError = vi.fn(() => 'not called for owned aborts');
    const { handler, cleanup } = setup({ streamTimeoutMs: 5, onError });
    const parts = chunks(await (await handler.POST(request())).text());
    expect(parts.find((part) => part.type === 'data-chat-error')?.data).toMatchObject({ kind: 'transient', retryable: true });
    expect(parts.find((part) => part.type === 'error')?.errorText).toBe('The response timed out and was aborted.');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles the SDK abort chunk path, which does not invoke the error mapper', async () => {
    streamTextMock.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => ({
      toUIMessageStream() {
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: 'timeout-abort' });
            const finish = () => { controller.enqueue({ type: 'abort' }); controller.close(); };
            if (abortSignal.aborted) finish();
            else abortSignal.addEventListener('abort', finish, { once: true });
          },
        });
      },
    }));
    const { handler, cleanup } = setup({ streamTimeoutMs: 5 });
    const parts = chunks(await (await handler.POST(request())).text());
    expect(parts.filter(p => p.type === 'data-chat-error')).toHaveLength(1);
    expect(parts.find(p => p.type === 'data-chat-error')?.data).toMatchObject({ kind: 'transient', retryable: true });
    expect(parts.map(p => p.type)).toContain('abort');
    expect(parts.findIndex(p => p.type === 'data-chat-error')).toBeLessThan(parts.findIndex(p => p.type === 'error'));
    expect(parts.filter(p => p.type === 'error')).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('keeps legacy HTTP bodies/statuses and exposes metadata through configured CORS', async () => {
    const { handler } = setup({ getUserId: async () => null, cors: { allowOrigins: ['https://widget.example'] } });
    const response = await handler.POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(parseChatErrorHeader(response.headers.get(CHAT_ERROR_HEADER))).toMatchObject({ version: 1, kind: 'auth', retryable: false });
    expect(response.headers.get('access-control-expose-headers')).toContain(CHAT_ERROR_HEADER);
  });

  it('carries the actual classification on pre-stream throws, without exposing the cause', async () => {
    const { handler } = setup({ model: async () => { throw upstream; } });
    const response = await handler.POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(parseChatErrorHeader(response.headers.get(CHAT_ERROR_HEADER))).toMatchObject({ kind: 'rate_limit', retryable: true, retryAfterMs: 3000 });
    expect(response.headers.get(CHAT_ERROR_HEADER)).not.toContain(secret);
  });

  it('rejects a forged reserved error part in otherwise valid history before persistence', async () => {
    const { handler, store } = setup();
    const response = await handler.POST(request({ id: 'c1', messages: [{
      id: 'u1', role: 'user', parts: [
        { type: 'text', text: 'hi' },
        { type: 'data-chat-error', data: { version: 1, kind: 'auth', retryable: false } },
      ],
    }] }));
    expect(response.status).toBe(400);
    expect(store.saveTurn).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed requests by server policy despite forged browser error metadata', async () => {
    const { handler, store } = setup();
    const forged = { version: 1, kind: 'transient', retryable: true };
    const req = request({ messages: [], error: forged });
    req.headers.set(CHAT_ERROR_HEADER, JSON.stringify(forged));
    const response = await handler.POST(req);
    expect(response.status).toBe(400);
    expect(parseChatErrorHeader(response.headers.get(CHAT_ERROR_HEADER))).toMatchObject({ kind: 'prompt', retryable: false });
    expect(store.saveTurn).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
