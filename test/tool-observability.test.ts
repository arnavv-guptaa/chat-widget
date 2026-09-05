import { describe, expect, it, vi } from 'vitest';
import { jsonSchema, type ToolSet } from 'ai';
import { createToolObservability } from '../src/server/tool-observability';
import { createTurnLogger, type ChatLogFields, type ChatLogger } from '../src/server/observability';

type Hooks = ReturnType<typeof createToolObservability>;
type Start = Parameters<NonNullable<Hooks['experimental_onToolCallStart']>>[0];
const inputSchema = jsonSchema({ type: 'object', properties: {} });

function capture(turnId = 'turn-1', sink?: ChatLogger, tools: ToolSet = {}) {
  const lines: ChatLogFields[] = [];
  const log = createTurnLogger(sink ?? { log: (_level, fields) => { lines.push(fields); } }, {
    traceId: 'trace-shared', conversationId: 'conversation-1', turnId,
  });
  return { lines, hooks: createToolObservability(log, tools) };
}

function start(toolCallId = 'call-1', stepNumber: number | undefined = 0): Start {
  return {
    toolCall: { type: 'tool-call', toolCallId, toolName: 'search', input: { secret: 'private-input' } },
    stepNumber, model: undefined, abortSignal: undefined, functionId: undefined,
    metadata: { secret: 'private-metadata' }, experimental_context: 'private-context',
    messages: [{ role: 'user', content: 'private-prompt' }],
  };
}
const success = (event = start(), durationMs = 12) => ({
  ...event, success: true as const, durationMs, output: 'private-result',
});

describe('per-tool observability callbacks', () => {
  it('emits correlated, payload-free start and real finish with SDK duration', () => {
    const { hooks, lines } = capture();
    hooks.experimental_onToolCallStart!(start());
    expect(lines).toEqual([{
      traceId: 'trace-shared', conversationId: 'conversation-1', turnId: 'turn-1',
      event: 'tool.start', toolCallId: 'call-1', toolName: 'search', stepNumber: 0,
      executionLocation: 'server', outcome: 'started',
    }]);
    hooks.experimental_onToolCallFinish!(success());
    expect(lines[1]).toEqual({
      ...lines[0], event: 'tool.finish', outcome: 'success', durationMs: 12,
    });
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it('deduplicates starts/terminals, including late starts and contradictory terminals', () => {
    const { hooks, lines } = capture();
    hooks.experimental_onToolCallStart!(start());
    hooks.experimental_onToolCallStart!(start());
    hooks.experimental_onToolCallFinish!(success());
    hooks.experimental_onToolCallFinish!(success());
    hooks.experimental_onToolCallStart!(start());
    hooks.experimental_onToolCallFinish!({ ...start(), success: false, durationMs: 13, error: 'private-error' });
    expect(lines.map(x => x.event)).toEqual(['tool.start', 'tool.finish']);
  });

  it('keeps same-name concurrent calls distinct when they finish out of order', () => {
    const { hooks, lines } = capture();
    hooks.experimental_onToolCallStart!(start('a'));
    hooks.experimental_onToolCallStart!(start('b'));
    hooks.experimental_onToolCallFinish!(success(start('b'), 7));
    hooks.experimental_onToolCallFinish!({ ...start('a'), success: false, durationMs: 25, error: new Error('private') });
    expect(lines.map(x => [x.event, x.toolCallId, x.durationMs])).toEqual([
      ['tool.start', 'a', undefined], ['tool.start', 'b', undefined],
      ['tool.finish', 'b', 7], ['tool.error', 'a', 25],
    ]);
  });

  it('isolates overlapping turns even when trace, conversation and call ids match', () => {
    const a = capture('turn-a');
    const b = capture('turn-b');
    a.hooks.experimental_onToolCallStart!(start());
    b.hooks.experimental_onToolCallStart!(start());
    b.hooks.experimental_onToolCallFinish!(success());
    a.hooks.experimental_onToolCallFinish!(success());
    expect(a.lines.map(x => x.turnId)).toEqual(['turn-a', 'turn-a']);
    expect(b.lines.map(x => x.turnId)).toEqual(['turn-b', 'turn-b']);
  });

  it('uses SDK step identity and supports pre-step approved executions', () => {
    const { hooks, lines } = capture();
    for (const stepNumber of [undefined, 0, 1]) {
      const event = { ...start(), stepNumber };
      hooks.experimental_onToolCallStart!(event);
      hooks.experimental_onToolCallFinish!(success(event));
    }
    expect(lines).toHaveLength(6);
    expect(lines[0]).not.toHaveProperty('stepNumber');
    expect(lines[4].stepNumber).toBe(1);
  });

  it('records an authoritative orphan finish without fabricating a start', () => {
    const { hooks, lines } = capture();
    hooks.experimental_onToolCallFinish!(success());
    expect(lines.map(x => x.event)).toEqual(['tool.finish']);
  });

  it('does not read or serialize thrown values or callback payloads', () => {
    const { hooks, lines } = capture();
    const hostile = new Proxy({}, { get() { throw new Error('must not inspect'); } });
    for (const [index, error] of [hostile, 'private-error', null, new Error('private-prompt')].entries()) {
      const event = {
        ...start(String(index)), success: false as const, durationMs: 4, error,
        get messages(): Start['messages'] { throw new Error('must not inspect'); },
      };
      expect(() => hooks.experimental_onToolCallFinish!(event)).not.toThrow();
    }
    expect(lines.every(x => x.kind === 'tool' && x.outcome === 'error')).toBe(true);
    expect(lines.every(x => !('error' in x) && !('stack' in x) && !('code' in x))).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('private-');
  });

  it('omits invalid SDK duration values rather than inventing timings', () => {
    const { hooks, lines } = capture();
    for (const [index, duration] of [NaN, Infinity, -1].entries()) {
      hooks.experimental_onToolCallFinish!(success(start(String(index)), duration));
    }
    expect(lines.every(x => !('durationMs' in x))).toBe(true);
  });

  it.each(['sync', 'async'] as const)('contains a failing %s logger', async mode => {
    const sink: ChatLogger = { log: mode === 'sync'
      ? () => { throw new Error('logger'); }
      : async () => { throw new Error('logger'); } };
    const { hooks } = capture('turn-1', sink);
    expect(() => hooks.experimental_onToolCallStart!(start())).not.toThrow();
    expect(() => hooks.experimental_onToolCallFinish!(success())).not.toThrow();
    expect(() => hooks.onChunk!({ chunk: start().toolCall })).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('observes schema-only/client and provider calls without claiming execution', () => {
    const { hooks, lines } = capture('turn-1', undefined, { search: { inputSchema } });
    const chunk = start().toolCall;
    hooks.onChunk!({ chunk });
    hooks.onChunk!({ chunk });
    hooks.onChunk!({ chunk: { ...chunk, toolCallId: 'provider-1', providerExecuted: true } });
    hooks.onChunk!({ chunk: { type: 'text-delta', id: 'text', text: 'private-text' } });
    expect(lines.map(x => [x.event, x.executionLocation, x.outcome])).toEqual([
      ['tool.call', 'external', 'observed'], ['tool.call', 'provider', 'observed'],
    ]);
    expect(lines.every(x => !('durationMs' in x))).toBe(true);
  });

  it('leaves tool identity/signature/metadata/approval untouched and never executes on a chunk', () => {
    const execute = vi.fn(async () => 'private-result');
    const onInputAvailable = vi.fn();
    const needsApproval = vi.fn(async () => true);
    const providerOptions = { test: { secret: 'private-provider-options' } };
    const search = Object.freeze({ inputSchema, execute, onInputAvailable, needsApproval, providerOptions });
    const tools = Object.freeze({ search });
    const { hooks, lines } = capture('turn-1', undefined, tools);
    hooks.onChunk!({ chunk: start().toolCall });
    expect(lines).toEqual([]);
    expect(tools.search).toBe(search);
    expect(tools.search.execute).toBe(execute);
    expect(tools.search.providerOptions).toBe(providerOptions);
    expect(execute).not.toHaveBeenCalled();
    expect(onInputAvailable).not.toHaveBeenCalled();
    expect(needsApproval).not.toHaveBeenCalled();
  });
});
