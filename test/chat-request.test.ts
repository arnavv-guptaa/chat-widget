import { describe, expect, it, vi } from 'vitest';
import { convertToModelMessages } from 'ai';
import { CHAT_REQUEST_LIMITS as limits, validateChatRequest } from '../src/server/chat-request';
import { createChatHandler } from '../src/server/handler';
import { ConversationOwnershipError, type ChatStore } from '../src/server/chat-store';

const text = { type: 'text', text: 'Hello' };
const user = { id: 'u1', role: 'user', parts: [text] };
const envelope = (messages: unknown = [user]) => ({ id: 'c1', messages });
const assistant = (parts: unknown[]) => ({ id: 'a1', role: 'assistant', parts });

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i++) value = { value };
  return value;
}

describe('chat request — envelope and work limits', () => {
  it.each([null, [], 'body', 42, true, {}, { id: 'c1' }, envelope(null), envelope({}), envelope('messages')].map((body) => [body]))(
    'rejects malformed envelope %j', async (body) => {
      expect((await validateChatRequest(body)).ok).toBe(false);
    },
  );

  it.each(['', '  ', '\n', 'c\u0000id', 'x'.repeat(limits.idChars + 1), 42, null, {}])(
    'rejects malformed conversation and message id %j', async (id) => {
      expect((await validateChatRequest({ ...envelope(), id })).ok).toBe(false);
      expect((await validateChatRequest(envelope([{ ...user, id }]))).ok).toBe(false);
    },
  );

  it('accepts explicitly empty history and bounded custom envelope fields', async () => {
    expect(await validateChatRequest(envelope([]))).toEqual({ ok: true, body: envelope([]) });
    const body = { ...envelope(), context: { path: '/docs' }, config: { custom: true }, trigger: 'submit-message' };
    expect(await validateChatRequest(body)).toEqual({ ok: true, body });
  });

  it('generates ids for legacy id-less messages without mutating the input', async () => {
    const message = { role: 'user', parts: [text] };
    const result = await validateChatRequest(envelope([message]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid request');
    expect(result.body.messages[0].id).toEqual(expect.any(String));
    expect(result.body.messages[0].id.length).toBeGreaterThan(0);
    expect(message).not.toHaveProperty('id');
    expect(result.body.messages[0].parts).toEqual([text]);
  });

  it('bounds ids and message counts inclusively', async () => {
    expect((await validateChatRequest({ ...envelope(), id: 'x'.repeat(limits.idChars) })).ok).toBe(true);
    const messages = Array.from({ length: limits.messages }, (_, i) => ({ ...user, id: `u${i}` }));
    expect((await validateChatRequest(envelope(messages))).ok).toBe(true);
    expect((await validateChatRequest(envelope([...messages, user]))).ok).toBe(false);
  });

  it('bounds both individual and aggregate part counts', async () => {
    const parts = Array.from({ length: limits.partsPerMessage }, () => ({ type: 'step-start' }));
    expect((await validateChatRequest(envelope([assistant(parts)]))).ok).toBe(true);
    expect((await validateChatRequest(envelope([assistant([...parts, ...parts])]))).ok).toBe(false);
    const messages = Array.from({ length: limits.totalParts / limits.partsPerMessage }, (_, i) => ({
      ...assistant(parts), id: `a${i}`,
    }));
    expect((await validateChatRequest(envelope(messages))).ok).toBe(true);
    expect((await validateChatRequest(envelope([...messages, user]))).ok).toBe(false);
  });

  it('bounds deep and wide opaque JSON before SDK validation', async () => {
    expect((await validateChatRequest({ ...envelope(), context: nested(10) })).ok).toBe(true);
    expect((await validateChatRequest({ ...envelope(), context: nested(limits.depth + 1) })).ok).toBe(false);
    expect((await validateChatRequest(envelope([{ ...user, metadata: nested(limits.depth + 1) }]))).ok).toBe(false);
    expect((await validateChatRequest({ ...envelope(), context: Array(limits.nodes).fill(0) })).ok).toBe(false);
  });
});

describe('chat request — roles and SDK part schemas', () => {
  it.each(['system', 'developer', 'tool', 'function', 'USER', '', null, {}])(
    'rejects client role %j rather than silently dropping it', async (role) => {
      expect((await validateChatRequest(envelope([{ ...user, role }, user]))).ok).toBe(false);
    },
  );

  it.each([null, [], 'message', {}, { role: 'user' }, { role: 'user', parts: {} }].map((message) => [message]))(
    'rejects malformed message %j', async (message) => {
      expect((await validateChatRequest(envelope([message, user]))).ok).toBe(false);
    },
  );

  it.each([
    null, [], 'part', {}, { type: 'unknown' }, { type: 'text', text: 42 },
    { type: 'reasoning', text: {} }, { type: 'text', text: 'x', state: 'invalid' },
    { type: 'file', mediaType: 'image/png', url: {} }, { type: 'file', url: 'https://example.com/a.png' },
    { type: 'file', mediaType: 'image/png', url: 'https://example.com/a.png', storagePath: {} },
    { type: 'source-url', sourceId: 's1', url: 42 },
    { type: 'tool-search', toolCallId: 't1', state: 'bogus', input: {} },
    { type: 'dynamic-tool', toolCallId: 't1', state: 'input-available', input: {} },
    { type: 'tool-search', toolCallId: 't1', state: 'approval-responded', input: {}, approval: { id: 'p1', approved: 'yes' } },
  ].map((part) => [part]))('rejects malformed part %j', async (part) => {
    expect((await validateChatRequest(envelope([assistant([part])]))).ok).toBe(false);
  });

  it('rejects empty parts rather than passing malformed messages to conversion', async () => {
    expect((await validateChatRequest(envelope([assistant([])]))).ok).toBe(false);
  });

  it.each(['tool-search', 'dynamic-tool'])('round-trips all v6 states for %s', async (type) => {
    const base = { type, toolCallId: 't1', ...(type === 'dynamic-tool' ? { toolName: 'search' } : {}) };
    const parts = [
      { ...base, state: 'input-streaming', input: { partial: true } },
      { ...base, state: 'input-available', input: { query: 'hello' } },
      { ...base, state: 'approval-requested', input: {}, approval: { id: 'p1' } },
      { ...base, state: 'approval-responded', input: {}, approval: { id: 'p1', approved: true, reason: 'Go' } },
      { ...base, state: 'output-available', input: {}, output: { results: [1, 2] }, preliminary: true },
      { ...base, state: 'output-error', input: {}, errorText: 'Unavailable' },
      { ...base, state: 'output-denied', input: {}, approval: { id: 'p1', approved: false } },
    ];
    for (const part of parts) {
      const body = envelope([user, assistant([part])]);
      expect(await validateChatRequest(body)).toEqual({ ok: true, body });
    }
  });

  it('preserves files, storage paths, sources, data parts, metadata and provider extensions', async () => {
    const body = envelope([
      { ...user, parts: [text,
        { type: 'file', mediaType: 'image/png', url: 'https://example.com/signed?token=abc', filename: 'a.png', storagePath: 'user/c1/a.png' },
        { type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,JVBERg==', filename: 'a.pdf' },
      ] },
      { ...assistant([
        { type: 'step-start' },
        { type: 'reasoning', text: 'Thinking', state: 'done', providerMetadata: { test: { signature: 'opaque' } } },
        { type: 'text', text: 'Answer', state: 'done' },
        { type: 'source-url', sourceId: 's1', url: 'https://example.com', title: 'Source' },
        { type: 'source-document', sourceId: 's2', mediaType: 'application/pdf', title: 'Document', filename: 'a.pdf' },
        { type: 'data-custom', id: 'd1', data: { arbitrary: ['payload'] } },
      ]), metadata: { custom: { retained: true } } },
    ]);
    expect(await validateChatRequest(body)).toEqual({ ok: true, body });
  });

  it('keeps assistant-final tool continuations convertible by the actual SDK', async () => {
    const result = await validateChatRequest(envelope([user, assistant([
      { type: 'step-start' },
      { type: 'tool-search', toolCallId: 't1', state: 'output-available', input: { query: 'Hello' }, output: { result: 'Found' } },
      { type: 'dynamic-tool', toolName: 'lookup', toolCallId: 't2', state: 'output-available', input: {}, output: 'Found' },
    ])]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid request');
    const converted = await convertToModelMessages(result.body.messages);
    expect(converted.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
  });
});

function setup() {
  // Ownership rejection is a sentinel: valid bodies reach this boundary without
  // calling a provider; invalid ones must never allocate a store or tools.
  const store: ChatStore = {
    userId: 'verified',
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    ensureConversation: vi.fn(async (id: string) => { throw new ConversationOwnershipError(id); }),
    renameConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => true),
    listMessages: vi.fn(async () => []),
    saveTurn: vi.fn(async () => {}),
  };
  const storeFactory = vi.fn(() => store);
  const buildTools = vi.fn(async () => ({ tools: {} }));
  const getHostedConfig = vi.fn(async () => null);
  const handler = createChatHandler({
    getUserId: () => 'verified', store: storeFactory, model: 'test/model',
    buildTools, getHostedConfig, logErrors: false,
  });
  const post = (body: unknown) => handler.POST(new Request('https://app.example/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { post, store, storeFactory, buildTools, getHostedConfig };
}

describe('handler — request validation before effects', () => {
  it.each([
    null, envelope(null), envelope([user, null]),
    envelope([{ ...user, parts: [null] }]),
    envelope([{ ...user, role: 'system' }, ...Array(40).fill(user)]),
    envelope([user, { ...assistant([text]), role: 'developer' }]),
    envelope(Array(limits.messages + 1).fill(user)),
  ])('returns 400 without side effects (case %#)', async (body) => {
    const { post, store, storeFactory, buildTools, getHostedConfig } = setup();
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(storeFactory).not.toHaveBeenCalled();
    expect(store.ensureConversation).not.toHaveBeenCalled();
    expect(store.saveTurn).not.toHaveBeenCalled();
    expect(buildTools).not.toHaveBeenCalled();
    expect(getHostedConfig).not.toHaveBeenCalled();
  });

  it.each([
    envelope([]), envelope(), envelope([{ role: 'user', parts: [text] }]),
    envelope([assistant([{ type: 'tool-search', toolCallId: 't1', state: 'output-available', input: {}, output: 'ok' }])]),
  ])('preserves the ownership gate for valid input %j', async (body) => {
    const { post, store } = setup();
    expect((await post(body)).status).toBe(403);
    expect(store.ensureConversation).toHaveBeenCalledWith('c1');
    expect(store.saveTurn).not.toHaveBeenCalled();
  });

  it('retains the existing actual-byte 413 limit without Content-Length', async () => {
    const { post, storeFactory } = setup();
    expect((await post(envelope([{ ...user, parts: [{ type: 'text', text: 'x'.repeat(1024 * 1024) }] }]))).status).toBe(413);
    expect(storeFactory).not.toHaveBeenCalled();
  });
});
