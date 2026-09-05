import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import { createChatErrorRecovery, getChatErrorRecovery } from '../src/utils/chat-error-recovery';

// Real SDK and in-memory provider; authored for remote CI, not live-runtime proof.
// Unlike a mocked toUIMessageStream.onError path, abortSignal emits an abort
// chunk in the locked SDK. The handler must explicitly turn a timeout into an
// error while retaining the abort marker for partial-turn persistence.
afterEach(() => { vi.unstubAllGlobals(); });
describe('handler -> real SDK -> Chat typed timeout', () => {
  it('surfaces a manual-retryable timeout without replay or persistent error data', async () => {
    const conversation = { id: 'c1', title: 'Existing', metadata: null, createdAt: new Date(0), updatedAt: new Date(0) };
    const saveTurn = vi.fn(async () => {});
    const cleanup = vi.fn(async () => {});
    const onError = vi.fn(() => 'not called for owned abort');
    const store: ChatStore = {
      userId: 'u1', listConversations: async () => [conversation], getConversation: async () => conversation,
      ensureConversation: async () => conversation, renameConversation: async () => {}, deleteConversation: async () => true,
      listMessages: async () => [], saveTurn,
    };
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Partial answer' });
            controller.enqueue({ type: 'text-end', id: 'text-1' });
            const abort = () => controller.error(abortSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
            if (abortSignal?.aborted) abort();
            else abortSignal?.addEventListener('abort', abort, { once: true });
          },
        }),
      }),
    });
    const handler = createChatHandler({
      getUserId: async () => 'u1', store: () => store, model, titles: false,
      buildTools: async () => ({ tools: {}, cleanup }), streamTimeoutMs: 50, onError, logErrors: false,
    });
    let wirePromise: Promise<string> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await handler.POST(new Request(input, init));
      wirePromise = response.clone().text();
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const seam = createChatErrorRecovery();
    const chat = new Chat({
      id: 'c1', transport: seam.wrapTransport(new DefaultChatTransport({ api: 'https://test.example/api/chat', fetch: seam.fetch })),
      sendAutomaticallyWhen: () => true,
    });
    await chat.sendMessage({ text: 'hello' });
    const wire = await wirePromise!;
    expect(chat.status).toBe('error');
    expect(getChatErrorRecovery(chat.error)?.metadata).toMatchObject({ kind: 'transient', retryable: true });
    expect(chat.error?.message).toBe('The response timed out and was aborted.');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(wire).toContain('"type":"abort"');
    expect(wire.indexOf('"type":"data-chat-error"')).toBeLessThan(wire.indexOf('"type":"error"'));
    expect(JSON.stringify(chat.messages)).not.toContain('data-chat-error');
    expect(JSON.stringify(saveTurn.mock.calls)).not.toContain('data-chat-error');
  });
});
