import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { AgentConfig } from '../src/config';
import type { ChatStore } from '../src/server/chat-store';
import { createChatHandler } from '../src/server/handler';

function store(): ChatStore {
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

const published: AgentConfig = {
  schemaVersion: 1,
  runtime: {
    model: 'published/model',
    systemPrompt: 'Published system prompt',
    temperature: 0.1,
    maxOutputTokens: 111,
  },
  client: { capabilitiesPrompt: 'Published client config' },
};

const preview: AgentConfig = {
  schemaVersion: 1,
  runtime: {
    model: 'preview/model',
    systemPrompt: 'Preview system prompt',
    temperature: 0.9,
  },
  client: {},
};

describe('preview config trust boundary', () => {
  it('uses an accepted preview as a full replacement rather than merging published fields', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Preview answer' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        };
      },
    });
    const resolvePreviewConfig = vi.fn(async (candidate: AgentConfig) => candidate);
    const handler = createChatHandler({
      getUserId: () => 'verified-user',
      model,
      store: () => store(),
      getHostedConfig: async () => ({ agent: 'agent-1', revision: 'published', config: published }),
      resolvePreviewConfig,
    });

    const response = await handler.POST(new Request('https://app.example/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conversation-1',
        messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
        config: preview,
      }),
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(resolvePreviewConfig).toHaveBeenCalledWith(
      preview,
      expect.objectContaining({ userId: 'verified-user', conversationId: 'conversation-1' }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].temperature).toBe(0.9);
    expect(calls[0].maxOutputTokens).toBeUndefined();
    expect(JSON.stringify(calls[0].prompt)).toContain('Preview system prompt');
    expect(JSON.stringify(calls[0].prompt)).not.toContain('Published system prompt');
  });
});
