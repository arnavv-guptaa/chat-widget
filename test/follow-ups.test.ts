import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import {
  mergeLanguageModelUsage,
  mergeProviderMetadata,
  toFollowUpMessages,
} from '../src/server/follow-ups';
import {
  normalizeFollowUpSuggestions,
  resolveFollowUpCount,
} from '../src/utils/follow-ups';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function mockModel() {
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
  });
}

function mockStore(): ChatStore {
  return {
    userId: 'verified-user',
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    ensureConversation: vi.fn(async (id: string) => ({
      id,
      title: 'Chat',
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

describe('follow-up normalization', () => {
  it('trims, de-duplicates, flattens whitespace, and clamps the public count', () => {
    expect(resolveFollowUpCount(99)).toBe(5);
    expect(resolveFollowUpCount(0)).toBe(1);
    expect(resolveFollowUpCount(undefined)).toBe(3);
    expect(
      normalizeFollowUpSuggestions(
        ['  Show me\n an example  ', 'show me an example', '', 42, 'What should I do next?'],
        5,
      ),
    ).toEqual(['Show me an example', 'What should I do next?']);
  });

  it('extracts only textual message content for a custom generator', () => {
    expect(
      toFollowUpMessages([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Question' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            { type: 'text', text: 'Answer' },
            { type: 'data-follow-ups', data: { suggestions: ['Ignored'] } },
          ],
        },
      ]),
    ).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
    ]);
  });
});

describe('follow-up usage accounting', () => {
  it('adds the secondary call tokens to the primary turn', () => {
    expect(
      mergeLanguageModelUsage(
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          inputTokenDetails: { cacheReadTokens: 20 },
          outputTokenDetails: { reasoningTokens: 10 },
        },
        {
          inputTokens: 20,
          outputTokens: 8,
          totalTokens: 28,
          cachedInputTokens: 4,
          reasoningTokens: 2,
          inputTokenDetails: { noCacheTokens: 16, cacheReadTokens: 4, cacheWriteTokens: 0 },
          outputTokenDetails: { textTokens: 6, reasoningTokens: 2 },
        },
      ),
    ).toMatchObject({
      inputTokens: 120,
      outputTokens: 58,
      totalTokens: 178,
      cachedInputTokens: 4,
      inputTokenDetails: { cacheReadTokens: 24 },
      outputTokenDetails: { reasoningTokens: 12 },
    });
  });

  it('adds gateway decimal costs exactly and retains the secondary metadata', () => {
    expect(
      mergeProviderMetadata(
        { gateway: { cost: '0.0009', inputInferenceCost: '0.0004', generationId: 'main' } },
        { gateway: { cost: '0.0002', inputInferenceCost: '0.0001', generationId: 'follow-up' } },
      ),
    ).toMatchObject({
      gateway: { cost: '0.0011', inputInferenceCost: '0.0005', generationId: 'main' },
      _mordnFollowUps: { gateway: { generationId: 'follow-up' } },
    });
  });
});

describe('handler follow-up data part', () => {
  it('streams and persists static follow-ups after the assistant response', async () => {
    const store = mockStore();
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model: mockModel(),
      store: () => store,
      followUps: {
        suggestions: ['Show me an example', 'What should I do next?', 'Show me an example'],
        max: 3,
      },
    });

    const response = await handler.POST(
      new Request('https://app.example/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'conversation-1',
          messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Help me' }] }],
        }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('data-follow-ups');
    expect(body).toContain('Show me an example');
    expect(body).toContain('What should I do next?');
    expect(body.indexOf('data-follow-ups')).toBeLessThan(body.lastIndexOf('"type":"finish"'));

    const saveTurn = vi.mocked(store.saveTurn);
    const finalCall = saveTurn.mock.calls.at(-1)?.[0];
    const assistant = finalCall?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.parts).toContainEqual({
      type: 'data-follow-ups',
      id: 'follow-ups',
      data: { suggestions: ['Show me an example', 'What should I do next?'] },
    });
  });
});
