import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readUIMessageStream, streamText, type UIMessage, type UIMessageChunk } from 'ai';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';
import type { StoredMessage } from '../src/server/types';

// Keep real SDK assembly, response framing and onFinish. Only the inner model
// producer is replaced. The stock handler does NOT expose its writer to host
// callbacks and its empty-text fallback prevents normal custom-data-only
// generation. Injected custom chunks test the existing inner-stream seam and
// persistence gate, NOT a public custom writer API or a real provider feature.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: vi.fn() };
});

function emitInnerStream(chunks: UIMessageChunk[], modelText?: string) {
  vi.mocked(streamText).mockImplementation((options) => ({
    toUIMessageStream: () => {
      const pending: UIMessageChunk[] = [{ type: 'start', messageId: 'assistant-server' }, ...chunks];
      return new ReadableStream<UIMessageChunk>({
        async pull(controller) {
          const next = pending.shift();
          if (next) {
            controller.enqueue(next);
            return;
          }
          if (modelText !== undefined) {
            // Exercise the actual stock onFinish writer (follow-ups / fallback /
            // finish), with model generation mocked rather than calling a vendor.
            await options.onFinish?.({
              text: modelText,
              finishReason: 'stop',
              steps: [],
            } as Parameters<NonNullable<typeof options.onFinish>>[0]);
          } else {
            controller.enqueue({ type: 'finish', finishReason: 'stop' });
          }
          controller.close();
        },
      });
    },
  }) as ReturnType<typeof streamText>);
}

function setup(followUps = false) {
  const rows = new Map<string, StoredMessage>();
  const conversation = {
    id: 'c-1', title: 'Account', metadata: null, createdAt: new Date(0), updatedAt: new Date(0),
  };
  const store: ChatStore = {
    userId: 'verified-user',
    ensureConversation: vi.fn(async () => conversation),
    getConversation: vi.fn(async () => conversation),
    listConversations: vi.fn(async () => [conversation]),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => true),
    listMessages: vi.fn(async () => [...rows.values()]),
    saveTurn: vi.fn(async ({ messages }) => {
      // Model the store contract: idempotent rows, JSON round-trip of parts.
      for (const message of messages) {
        rows.set(message.id, {
          id: message.id,
          role: message.role,
          parts: JSON.parse(JSON.stringify(message.parts)),
          text: message.parts.filter((part) => part.type === 'text').map((part) => part.text).join(''),
          createdAt: new Date(0),
        });
      }
    }),
  };
  const onChatFinish = vi.fn();
  const handler = createChatHandler({
    getUserId: async () => 'verified-user',
    model: 'test/model',
    store: () => store,
    titles: false,
    followUps: followUps ? { generate: async () => ['Show another account?'] } : false,
    logErrors: false,
    onChatFinish,
  });
  return { handler, store, rows, onChatFinish };
}

async function runTurn(handler: ReturnType<typeof createChatHandler>) {
  const response = await handler.POST(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'c-1',
      messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Look up my account' }] }],
    }),
  }));
  expect(response.status).toBe(200);
  const wire = await response.text(); // Drains the stream and awaits real onFinish/saveTurn.
  const chunks = wire.split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as UIMessageChunk);
  let live: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  })) live = message;
  const history = await handler.GET(new Request('https://app.example/api/chat/history/c-1'));
  expect(history.status).toBe(200);
  return { live, chunks, history: await history.json() };
}

beforeEach(() => vi.clearAllMocks());

describe('handler custom-data persistence at the inner UI stream seam', () => {
  it('persists a server-stream data-only reply and replays identical parts via history', async () => {
    const part = { type: 'data-account-lookup' as const, id: 'lookup-1', data: { accountId: 'a-1', balance: 0 } };
    emitInnerStream([part]);
    const { handler, store, rows, onChatFinish } = setup();
    const { live, history } = await runTurn(handler);
    expect(live?.parts).toEqual([part]);
    expect(store.saveTurn).toHaveBeenCalledTimes(2); // Latest user, then final assistant turn.
    const saved = [...rows.values()].find((message) => message.role === 'assistant');
    expect(saved?.id).toBeTruthy();
    expect(saved?.parts).toEqual([part]);
    expect(saved?.text).toBe('');
    expect(history.messages.find((message: UIMessage) => message.role === 'assistant')).toMatchObject({
      id: saved!.id, role: 'assistant', content: '', parts: live!.parts,
    });
    expect(onChatFinish).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ type: 'data-account-lookup', transient: true, data: { status: 'loading' } }],
    [{ type: 'data-follow-ups', data: { suggestions: ['Next?'] } }],
    [{ type: 'data-thread-title', data: { title: 'Account' } }],
    [{ type: 'data-chat-error', data: { message: 'Failed' } }],
    [
      { type: 'data-account-lookup', transient: true, data: {} },
      { type: 'data-follow-ups', data: { suggestions: ['Next?'] } },
      { type: 'data-thread-title', data: { title: 'Account' } },
      { type: 'data-chat-error', data: {} },
    ],
  ] satisfies UIMessageChunk[][])('does not persist transient/control-only output: %j', async (...chunks) => {
    emitInnerStream(chunks);
    const { handler, store } = setup();
    const { history } = await runTurn(handler);
    expect(store.saveTurn).toHaveBeenCalledTimes(1); // The user still persists.
    expect(history.messages.map((message: UIMessage) => message.role)).toEqual(['user']);
  });

  it('lets the SDK discard transient data while preserving durable custom output', async () => {
    const durable = { type: 'data-account-lookup' as const, data: null };
    emitInnerStream([{ type: 'data-progress', transient: true, data: 50 }, durable]);
    const { handler } = setup();
    const { live, history } = await runTurn(handler);
    expect(live?.parts).toEqual([durable]);
    expect(history.messages.find((message: UIMessage) => message.role === 'assistant').parts).toEqual([durable]);
  });
});

describe('existing stock server writer seam (mocked model generation)', () => {
  it('still persists text with real onFinish-generated follow-ups', async () => {
    emitInnerStream([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Found your account.' },
      { type: 'text-end', id: 'text-1' },
    ], 'Found your account.');
    const { handler, store } = setup(true);
    const { live, history } = await runTurn(handler);
    expect(store.saveTurn).toHaveBeenCalledTimes(2);
    expect(live?.parts).toContainEqual({
      type: 'data-follow-ups', id: 'follow-ups', data: { suggestions: ['Show another account?'] },
    });
    expect(history.messages.find((message: UIMessage) => message.role === 'assistant').parts).toEqual(live?.parts);
  });

  it('retains the stock empty-model fallback rather than claiming a custom-data-only writer API', async () => {
    emitInnerStream([], '');
    const { handler, store } = setup();
    const { live, history } = await runTurn(handler);
    expect(store.saveTurn).toHaveBeenCalledTimes(2);
    expect(live?.parts.some((part) => part.type === 'text' && part.text.includes('ran out of room'))).toBe(true);
    expect(history.messages.find((message: UIMessage) => message.role === 'assistant').parts).toEqual(live?.parts);
  });
});
