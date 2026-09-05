import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '@ai-sdk/react';
import { createUIMessageStream, createUIMessageStreamResponse, DefaultChatTransport } from 'ai';
import { createChatErrorRecovery, getChatErrorRecovery } from '../src/utils/chat-error-recovery';
import { CHAT_ERROR_HEADER, messageForErrorKind } from '../src/utils/chat-error-protocol';

const metadata = { version: 1, kind: 'rate_limit', retryable: true, retryAfterMs: 2000, traceId: 'trace-12345678' };
const part = { type: 'data-chat-error', data: metadata, transient: true };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('per-Chat recovery seam', () => {
  it('associates data with the exact Error and preserves legacy callback text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const seam = createChatErrorRecovery();
    const error = new Error('Localized callback copy');
    seam.onData(part);
    seam.onError(error);
    expect(getChatErrorRecovery(error)).toEqual({ metadata, retryAt: 12_000 });
    expect(error.message).toBe('Localized callback copy');
    const next = new Error('next turn');
    seam.onError(next);
    expect(getChatErrorRecovery(next)).toBeUndefined();
  });

  it('isolates tabs and clears pending metadata on the next request', () => {
    const a = createChatErrorRecovery();
    const b = createChatErrorRecovery();
    a.onData(part);
    const errorB = new Error('tab B');
    b.onError(errorB);
    expect(getChatErrorRecovery(errorB)).toBeUndefined();
    a.reset();
    const errorA = new Error('next turn in A');
    a.onError(errorA);
    expect(getChatErrorRecovery(errorA)).toBeUndefined();
  });

  it('ignores malformed/future/unrelated data without replacing the Error', () => {
    const seam = createChatErrorRecovery();
    seam.onData({ ...part, data: { ...metadata, version: 2 } });
    seam.onData({ type: 'data-thread-title', data: metadata });
    seam.onData(null);
    const error = new Error('legacy');
    seam.onError(error);
    expect(getChatErrorRecovery(error)).toBeUndefined();
  });

  it('passes legacy HTTP failures and successful streaming responses through unchanged', async () => {
    const seam = createChatErrorRecovery();
    for (const status of [200, 400]) {
      const response = new Response('legacy body', { status });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      expect(await seam.fetch('/chat')).toBe(response);
      expect(await response.text()).toBe('legacy body');
    }
  });

  it('maps typed HTTP failures without reading or exposing raw response bodies', async () => {
    const response = new Response('Authorization: Bearer secret', {
      status: 429, headers: { [CHAT_ERROR_HEADER]: JSON.stringify(metadata) },
    });
    const text = vi.spyOn(response, 'text');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const seam = createChatErrorRecovery();
    const error = await seam.fetch('/chat').catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(messageForErrorKind('rate_limit'));
    expect(getChatErrorRecovery(error as Error)?.metadata).toEqual(metadata);
    expect(text).not.toHaveBeenCalled();
  });

  it('exercises real SDK onData → onError → error state without persisting metadata or auto-retrying', async () => {
    const seam = createChatErrorRecovery();
    const callback = vi.fn<(error: Error) => void>();
    const fetchMock = vi.fn(async () => createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute({ writer }) {
          writer.write({ type: 'start', messageId: 'assistant-1' });
          writer.write({ type: 'data-chat-error', data: metadata, transient: true });
          writer.write({ type: 'error', errorText: 'Localized safe error copy' });
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const chat = new Chat({
      id: 'tab-a', transport: seam.wrapTransport(new DefaultChatTransport({ api: 'https://example.test/chat', fetch: seam.fetch })),
      onError: callback,
      // Even with an eager host auto-send rule, SDK error paths must not replay.
      sendAutomaticallyWhen: () => true,
    });
    await chat.sendMessage({ text: 'hello' });
    expect(chat.status).toBe('error');
    expect(chat.error?.message).toBe('Localized safe error copy');
    expect(getChatErrorRecovery(chat.error)?.metadata).toEqual(metadata);
    expect(callback).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(chat.messages)).not.toContain('data-chat-error');
    chat.clearError();
    expect(chat.error).toBeUndefined();
  });

  it('exercises real SDK HTTP failure state and callback with safe metadata', async () => {
    const seam = createChatErrorRecovery();
    const onError = vi.fn<(error: Error) => void>();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret backend payload', {
      status: 500, headers: { [CHAT_ERROR_HEADER]: JSON.stringify({ ...metadata, kind: 'auth', retryable: false }) },
    })));
    const chat = new Chat({
      id: 'tab-http', transport: seam.wrapTransport(new DefaultChatTransport({ api: 'https://example.test/chat', fetch: seam.fetch })),
      onError,
    });
    await chat.sendMessage({ text: 'hello' });
    expect(chat.status).toBe('error');
    expect(chat.error?.message).toBe(messageForErrorKind('auth'));
    expect(getChatErrorRecovery(chat.error)?.metadata.kind).toBe('auth');
    expect(onError).toHaveBeenCalledOnce();
  });
});
