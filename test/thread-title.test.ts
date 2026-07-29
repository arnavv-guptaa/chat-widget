import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import { normalizeThreadTitle, MAX_THREAD_TITLE_CHARS } from '../src/server/thread-title';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/**
 * A model that streams a fixed answer AND answers the post-response
 * `generateObject` title call (generateThreadTitle uses doGenerate).
 */
function mockModel(generatedTitle = 'Widget Setup Help') {
  return new MockLanguageModelV3({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'A complete answer.' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage,
          },
        ],
      }),
    },
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ title: generatedTitle }) }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

function mockStore(title: string): ChatStore {
  return {
    userId: 'verified-user',
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    ensureConversation: vi.fn(async (id: string) => ({
      id,
      title,
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => true),
    listMessages: vi.fn(async () => []),
    saveTurn: vi.fn(async () => {}),
  };
}

function chatRequest() {
  return new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'conversation-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Help me set up the widget' }] }],
    }),
  });
}

describe('thread title normalization', () => {
  it('collapses whitespace and strips wrapping quotes and trailing periods', () => {
    expect(normalizeThreadTitle('  "Widget   Setup\nHelp".  ')).toBe('Widget Setup Help');
    expect(normalizeThreadTitle('“Debugging CORS errors”')).toBe('Debugging CORS errors');
    expect(normalizeThreadTitle('# Markdown Title')).toBe('Markdown Title');
  });

  it('caps overlong titles at a word boundary', () => {
    const long = 'A very long generated title that keeps going well past the display cap for lists';
    const result = normalizeThreadTitle(long)!;
    expect(result.length).toBeLessThanOrEqual(MAX_THREAD_TITLE_CHARS);
    expect(result.endsWith(' ')).toBe(false);
    expect(long.startsWith(result)).toBe(true);
  });

  it('rejects junk that must fall back to the placeholder', () => {
    expect(normalizeThreadTitle('')).toBeNull();
    expect(normalizeThreadTitle('   "  " ')).toBeNull();
    expect(normalizeThreadTitle('New Chat')).toBeNull();
    expect(normalizeThreadTitle(42)).toBeNull();
  });
});

describe('handler thread-title generation', () => {
  it('renames an unnamed conversation and emits data-thread-title by default', async () => {
    const store = mockStore('New Chat');
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model: mockModel(),
      store: () => store,
    });

    const response = await handler.POST(chatRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('data-thread-title');
    expect(body).toContain('Widget Setup Help');
    expect(body.indexOf('data-thread-title')).toBeLessThan(body.lastIndexOf('"type":"finish"'));
    expect(vi.mocked(store.renameConversation)).toHaveBeenCalledWith(
      'conversation-1',
      'Widget Setup Help',
    );
  });

  it('does not rename a conversation that already has a title', async () => {
    const store = mockStore('Existing Title');
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model: mockModel(),
      store: () => store,
    });

    const response = await handler.POST(chatRequest());
    await response.text();

    expect(vi.mocked(store.renameConversation)).not.toHaveBeenCalled();
  });

  it('honors titles: false', async () => {
    const store = mockStore('New Chat');
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model: mockModel(),
      store: () => store,
      titles: false,
    });

    const response = await handler.POST(chatRequest());
    const body = await response.text();

    expect(body).not.toContain('data-thread-title');
    expect(vi.mocked(store.renameConversation)).not.toHaveBeenCalled();
  });

  it('keeps the placeholder when generation fails', async () => {
    const store = mockStore('New Chat');
    const model = new MockLanguageModelV3({
      doStream: mockModel().doStream,
      doGenerate: async () => {
        throw new Error('title model unavailable');
      },
    });
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model,
      store: () => store,
    });

    const response = await handler.POST(chatRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('data-thread-title');
    expect(body).toContain('"type":"finish"');
    expect(vi.mocked(store.renameConversation)).not.toHaveBeenCalled();
  });
});
