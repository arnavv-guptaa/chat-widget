import type { streamText, ToolSet } from 'ai';
import type { TurnLogger } from './observability';

// Derive the callback contract from the SDK rather than shadowing its event
// shapes. These experimental hooks are present in the locked ai@6.0.175.
type ToolCallbacks = Pick<
  Parameters<typeof streamText>[0],
  'experimental_onToolCallStart' | 'experimental_onToolCallFinish' | 'onChunk'
>;

/**
 * Observe SDK execution, never replace Tool.execute. In particular, wrapping an
 * async generator in an async function would change its return contract; adding
 * execute to a schema-only tool would silently move client work to the server.
 *
 * Only identifiers/scalars are retained. Never spread SDK events into a logger:
 * they contain input, output, messages, provider metadata and arbitrary errors.
 */
export function createToolObservability(log: TurnLogger, tools: ToolSet): ToolCallbacks {
  const started = new Set<string>();
  const finished = new Set<string>();
  const observed = new Set<string>();
  const key = (stepNumber: number | undefined, toolCallId: string) =>
    JSON.stringify([stepNumber ?? null, toolCallId]);

  return {
    experimental_onToolCallStart: ({ toolCall, stepNumber }) => {
      const id = key(stepNumber, toolCall.toolCallId);
      if (started.has(id) || finished.has(id)) return;
      started.add(id);
      log.info('tool.start', {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        executionLocation: 'server',
        outcome: 'started',
        ...(stepNumber !== undefined ? { stepNumber } : {}),
      });
    },
    experimental_onToolCallFinish: (event) => {
      const { toolCall, stepNumber, durationMs, success } = event;
      const id = key(stepNumber, toolCall.toolCallId);
      if (finished.has(id)) return;
      finished.add(id);
      started.delete(id);
      // A finish callback is authoritative even if a start wasn't observed.
      // Do not invent a start timestamp or compute latency from a model chunk.
      log[success ? 'info' : 'warn'](success ? 'tool.finish' : 'tool.error', {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        executionLocation: 'server',
        outcome: success ? 'success' : 'error',
        ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
        ...(stepNumber !== undefined ? { stepNumber } : {}),
        // Conservative closed taxonomy: even error.name/message/code can contain
        // arguments, results, credentials or prompt excerpts. Read none of them.
        ...(!success ? { kind: 'tool' as const } : {}),
      });
    },
    onChunk: ({ chunk }) => {
      if (chunk.type !== 'tool-call') return;
      // A schema-only tool may be client-executed, deferred, or intentionally
      // non-executing. Absence of execute is NOT proof that a client ran it.
      // Provider-executed tools also do not pass through the server hooks.
      const location = chunk.providerExecuted === true
        ? 'provider'
        : typeof tools[chunk.toolName]?.execute === 'function' ? 'server' : 'external';
      if (location === 'server' || observed.has(chunk.toolCallId)) return;
      observed.add(chunk.toolCallId);
      log.info('tool.call', {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        executionLocation: location,
        outcome: 'observed',
      });
    },
  };
}
