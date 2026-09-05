import { describe, expect, it, vi } from 'vitest';
import { stepCountIs, streamText, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { z } from 'zod';
import { createToolObservability } from '../src/server/tool-observability';
import { createTurnLogger, type ChatLogFields, type ChatLogger } from '../src/server/observability';
import { createChatHandler } from '../src/server/handler';
import type { ChatStore } from '../src/server/chat-store';

// These contract tests use the real SDK with an in-memory model, not mocked
// callbacks. No provider network calls. They are intended for CI; see docs for
// the separate live-runtime/abort verification still required.
const schema = z.object({ value: z.string() });
const call = (toolCallId: string, toolName = 'search'): Extract<LanguageModelV3StreamPart, { type: 'tool-call' }> => ({
  type: 'tool-call', toolCallId, toolName, input: '{"value":"private-input"}',
});
const finish: LanguageModelV3StreamPart = {
  type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
};
function model(parts: LanguageModelV3StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of [...parts, finish]) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
}
function capture(tools: ToolSet, sink?: ChatLogger) {
  const lines: ChatLogFields[] = [];
  const logger = sink ?? { log: (_level: unknown, fields: ChatLogFields) => { lines.push(fields); } };
  const hooks = createToolObservability(createTurnLogger(logger, { traceId: 'trace-1', turnId: 'turn-1' }), tools);
  return { lines, hooks };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('tool telemetry — real AI SDK v6 contract', () => {
  it('starts before execute, finishes after it, and preserves execute context/options and provider metadata', async () => {
    const tools = {
      search: tool({
        inputSchema: schema,
        execute: async function (this: unknown, input, options) {
          expect(this).toBe(tools.search);
          expect(input.value).toBe('private-input');
          expect(options.toolCallId).toBe('call-1');
          expect(options.messages).toEqual(expect.any(Array));
          expect(lines.map(x => x.event)).toEqual(['tool.start']);
          return 'private-result';
        },
      }),
    };
    const originalExecute = tools.search.execute;
    const { lines, hooks } = capture(tools);
    const result = streamText({
      model: model([{ ...call('call-1'), providerMetadata: { test: { marker: 'private-metadata' } } }]),
      prompt: 'private-prompt', tools, ...hooks,
    });
    await result.consumeStream();
    expect(lines.map(x => x.event)).toEqual(['tool.start', 'tool.finish']);
    expect(lines[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(tools.search.execute).toBe(originalExecute);
    expect((await result.toolResults)[0]).toMatchObject({
      output: 'private-result', providerMetadata: { test: { marker: 'private-metadata' } },
    });
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it('observes parallel same-name executions independently, including a tool error', async () => {
    const bothStarted = gate();
    let count = 0;
    const failure = new Error('private-prompt private-input');
    const tools = {
      search: tool({ inputSchema: schema, execute: async (_input, options) => {
        if (++count === 2) bothStarted.resolve();
        await bothStarted.promise;
        if (options.toolCallId === 'a') throw failure;
        return 'private-result';
      } }),
    };
    const { lines, hooks } = capture(tools);
    const result = streamText({ model: model([call('a'), call('b')]), prompt: 'private-prompt', tools, ...hooks });
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    expect(lines.filter(x => x.event === 'tool.start')).toHaveLength(2);
    expect(lines.filter(x => x.event === 'tool.error')).toEqual([
      expect.objectContaining({ toolCallId: 'a', kind: 'tool', outcome: 'error' }),
    ]);
    expect(lines.filter(x => x.event === 'tool.finish')).toEqual([
      expect.objectContaining({ toolCallId: 'b', outcome: 'success' }),
    ]);
    expect(chunks.find(x => x.type === 'tool-error')).toMatchObject({ error: failure });
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it.each([false, true])('does not finish on generator creation or preliminary output (throws=%s)', async throws => {
    const proceed = gate();
    const failure = new Error('private-generator-error');
    const tools = {
      search: tool({ inputSchema: schema, execute: async function* () {
        yield 'private-preliminary';
        await proceed.promise;
        if (throws) throw failure;
        yield 'private-final';
      } }),
    };
    const execute = tools.search.execute;
    const { lines, hooks } = capture(tools);
    const result = streamText({ model: model([call('generator')]), prompt: 'private-prompt', tools, ...hooks });
    let sawPreliminary = false;
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'tool-result' && chunk.preliminary && !sawPreliminary) {
        sawPreliminary = true;
        expect(lines.map(x => x.event)).toEqual(['tool.start']);
        proceed.resolve();
      }
    }
    expect(sawPreliminary).toBe(true);
    expect(tools.search.execute).toBe(execute);
    expect(lines.map(x => x.event)).toEqual(['tool.start', throws ? 'tool.error' : 'tool.finish']);
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it('does not execute or invent a success for schema-only, missing, invalid or approval-pending tools', async () => {
    const execute = vi.fn(async () => 'private-result');
    const tools = {
      client: tool({ inputSchema: schema }),
      approval: tool({ inputSchema: schema, needsApproval: true, execute }),
      invalid: tool({ inputSchema: schema, execute }),
    };
    const { lines, hooks } = capture(tools);
    const result = streamText({
      model: model([
        call('client', 'client'), call('approval', 'approval'), call('missing', 'missing'),
        { type: 'tool-call', toolCallId: 'invalid', toolName: 'invalid', input: '{}' },
      ]), prompt: 'private-prompt', tools, ...hooks,
    });
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    expect(execute).not.toHaveBeenCalled();
    expect(chunks.some(x => x.type === 'tool-approval-request')).toBe(true);
    expect(lines.every(x => x.event === 'tool.call' && x.outcome === 'observed')).toBe(true);
    expect(lines).toContainEqual(expect.objectContaining({ toolCallId: 'client', executionLocation: 'external' }));
    expect(lines.every(x => !('durationMs' in x))).toBe(true);
  });

  it.each([false, true])('respects a resumed approval decision (approved=%s)', async approved => {
    const execute = vi.fn(async () => 'private-result');
    const tools = { search: tool({ inputSchema: schema, needsApproval: true, execute }) };
    const { lines, hooks } = capture(tools);
    const result = streamText({
      model: model([]), tools, ...hooks,
      messages: [
        { role: 'user', content: 'private-prompt' },
        { role: 'assistant', content: [
          { type: 'tool-call', toolCallId: 'approved-call', toolName: 'search', input: { value: 'private-input' } },
          { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'approved-call' },
        ] },
        { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'approval-1', approved }] },
      ],
    });
    await result.consumeStream();
    expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(lines.map(x => x.event)).toEqual(approved ? ['tool.start', 'tool.finish'] : []);
    expect(lines.every(x => x.toolCallId === 'approved-call')).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it('does not treat a provider-executed call as server execution even if a local execute exists', async () => {
    const execute = vi.fn(async () => 'not-run');
    const tools = { search: tool({ inputSchema: schema, execute }) };
    const { lines, hooks } = capture(tools);
    const result = streamText({
      model: model([
        { type: 'tool-call', toolCallId: 'provider', toolName: 'search', input: '{"value":"private-input"}', providerExecuted: true },
        { type: 'tool-result', toolCallId: 'provider', toolName: 'search', result: 'private-result' },
      ]), prompt: 'private-prompt', tools, ...hooks,
    });
    await result.consumeStream();
    expect(execute).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.objectContaining({ event: 'tool.call', executionLocation: 'provider', outcome: 'observed' })]);
  });

  it.each(['sync', 'async'] as const)('preserves actual tool results with a failing %s logger', async mode => {
    const sink: ChatLogger = { log: mode === 'sync'
      ? () => { throw new Error('sink'); }
      : async () => { throw new Error('sink'); } };
    const tools = { search: tool({ inputSchema: schema, execute: async () => 'actual-result' }) };
    const { hooks } = capture(tools, sink);
    const result = streamText({ model: model([call('call-1')]), prompt: 'prompt', tools, ...hooks });
    await result.consumeStream();
    expect((await result.toolResults)[0].output).toBe('actual-result');
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('wires telemetry through the handler with a fresh turn id under a shared trace', async () => {
    const lines: ChatLogFields[] = [];
    const conversation = { id: 'c1', title: 'Existing title', metadata: null, createdAt: new Date(0), updatedAt: new Date(0) };
    const store: ChatStore = {
      userId: 'user-1', listConversations: async () => [conversation], getConversation: async () => conversation,
      ensureConversation: async () => conversation, renameConversation: async () => {}, deleteConversation: async () => true,
      listMessages: async () => [], saveTurn: async () => {},
    };
    const handler = createChatHandler({
      getUserId: async () => 'user-1', store: () => store,
      model: model([call('same-call')]), titles: false, stopWhen: stepCountIs(1),
      buildTools: async () => ({ tools: { search: tool({ inputSchema: schema, execute: async () => 'private-result' }) } }),
      logger: { log: (_level, fields) => { lines.push(fields); } },
    });
    await Promise.all([1, 2].map(async n => {
      const response = await handler.POST(new Request('https://app.example/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'trace-shared' },
        body: JSON.stringify({ id: 'c1', messages: [{ id: `user-${n}`, role: 'user', parts: [{ type: 'text', text: 'private-prompt' }] }] }),
      }));
      expect(response.status).toBe(200);
      await response.text();
    }));
    const starts = lines.filter(x => x.event === 'turn.start');
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map(x => x.turnId)).size).toBe(2);
    for (const start of starts) {
      const toolLines = lines.filter(x => x.turnId === start.turnId && x.event.startsWith('tool.'));
      expect(toolLines.map(x => x.event)).toEqual(['tool.start', 'tool.finish']);
      expect(toolLines.every(x => x.traceId === 'trace-shared' && x.conversationId === 'c1' && x.toolCallId === 'same-call')).toBe(true);
    }
    expect(JSON.stringify(lines.filter(x => x.event.startsWith('tool.')))).not.toContain('private-');
  });
});
