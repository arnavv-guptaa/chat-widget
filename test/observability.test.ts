import { describe, it, expect, vi } from 'vitest';
import {
  createConsoleLogger,
  createTurnLogger,
  errorFields,
  newTraceId,
  noopLogger,
  resolveTraceId,
  TRACE_HEADER,
  type ChatLogFields,
  type ChatLogger,
  type LogLevel,
} from '../src/server/observability';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

/**
 * Some runtimes and proxy shims hand back a plain object with `get()` rather
 * than a spec `Headers`. A real `Headers` rejects newline values outright, so
 * this is the only way to exercise the sanitizer's log-forging defence.
 */
const looseHeaders = (value: string) => ({
  headers: { get: (name: string) => (name === 'x-request-id' ? value : null) } as unknown as Headers,
});

describe('resolveTraceId', () => {
  it('adopts the trace-id field of a W3C traceparent', () => {
    expect(
      resolveTraceId(req({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' })),
    ).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('rejects the all-zero traceparent and mints a fresh id', () => {
    const traceId = resolveTraceId(
      req({ traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01' }),
    );
    expect(traceId).not.toBe('00000000000000000000000000000000');
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('adopts the common gateway correlation headers', () => {
    expect(resolveTraceId(req({ 'x-request-id': 'abc123def456' }))).toBe('abc123def456');
    expect(resolveTraceId(req({ 'x-correlation-id': 'corr-9876-xyz' }))).toBe('corr-9876-xyz');
  });

  it('prefers traceparent over x-request-id', () => {
    expect(
      resolveTraceId(
        req({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', 'x-request-id': 'zzzzzzzz' }),
      ),
    ).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('strips anything that could forge a log line or terminate a header', () => {
    // This value lands in a JSON log line AND on a response header, so a
    // hostile client must not be able to inject either.
    const traceId = resolveTraceId(looseHeaders('abc12345\nlevel=error event=fake'));
    expect(traceId).not.toMatch(/[\n\r]/);
    expect(traceId).toBe('abc12345levelerroreventfake');
    expect(resolveTraceId(looseHeaders('id123; injected=1'))).toBe('id123injected1');
  });

  it('ignores an implausibly short adopted id and caps a long one', () => {
    expect(resolveTraceId(req({ 'x-request-id': 'ab' }))).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveTraceId(req({ 'x-request-id': 'a'.repeat(500) }))).toHaveLength(128);
  });

  it('mints a W3C-shaped id when nothing is inbound', () => {
    expect(resolveTraceId(req({}))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('newTraceId', () => {
  it('is 32 lowercase hex characters', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });
  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 100 }, newTraceId)).size).toBe(100);
  });
});

describe('createTurnLogger', () => {
  function capture() {
    const lines: Array<{ level: LogLevel } & ChatLogFields> = [];
    const logger: ChatLogger = { log: (level, fields) => void lines.push({ level, ...fields }) };
    return { lines, logger };
  }

  it('binds base fields onto every line', () => {
    const { lines, logger } = capture();
    createTurnLogger(logger, { traceId: 't-1', userId: 'u-1' }).info('turn.start', { model: 'anthropic/x' });
    expect(lines[0]).toEqual({ level: 'info', traceId: 't-1', userId: 'u-1', model: 'anthropic/x', event: 'turn.start' });
  });

  it('merges extra fields in a child without mutating the parent', () => {
    const { lines, logger } = capture();
    const parent = createTurnLogger(logger, { traceId: 't-1', userId: 'u-1' });
    parent.child({ conversationId: 'c-9' }).error('save.failed', { error: 'boom' });
    parent.info('turn.finish');
    expect(lines[0].conversationId).toBe('c-9');
    expect(lines[1].conversationId).toBeUndefined();
  });

  it('does not let a caller overwrite the bound traceId', () => {
    const { lines, logger } = capture();
    createTurnLogger(logger, { traceId: 't-1' }).info('turn.start', { traceId: 'HACKED' } as Partial<ChatLogFields>);
    expect(lines[0].traceId).toBe('t-1');
  });

  it('contains a throwing host logger — telemetry must never break a turn', () => {
    const exploding: ChatLogger = {
      log: () => {
        throw new Error('logger exploded');
      },
    };
    expect(() => createTurnLogger(exploding, { traceId: 't-2' }).error('turn.error')).not.toThrow();
  });
});

describe('createConsoleLogger', () => {
  it('filters below the minimum level, and splits stdout/stderr by severity', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const logger = createConsoleLogger();
      logger.log('debug', { traceId: 't', event: 'turn.step' });
      logger.log('info', { traceId: 't', event: 'turn.start' });
      logger.log('warn', { traceId: 't', event: 'turn.abort' });
      logger.log('error', { traceId: 't', event: 'turn.error' });

      expect(out).toHaveBeenCalledTimes(1); // debug filtered out
      expect(out.mock.calls[0][0]).toContain('turn.start');
      // warn + error both go to stderr so they survive stdout-only filters.
      expect(err).toHaveBeenCalledTimes(2);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it('honours an explicit minLevel', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      createConsoleLogger({ minLevel: 'debug' }).log('debug', { traceId: 't', event: 'turn.step' });
      expect(out).toHaveBeenCalledTimes(1);
    } finally {
      out.mockRestore();
    }
  });

  it('never loses a line to a circular extra field', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const circular: Record<string, unknown> = { traceId: 't', event: 'turn.finish' };
      circular.self = circular;
      expect(() => createConsoleLogger().log('info', circular as unknown as ChatLogFields)).not.toThrow();
      expect(out.mock.calls[0][0]).toContain('"serialization":"failed"');
      expect(out.mock.calls[0][0]).toContain('turn.finish');
    } finally {
      out.mockRestore();
    }
  });

  it('emits parseable JSON', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      createConsoleLogger().log('info', { traceId: 't-7', event: 'turn.finish', durationMs: 1234 });
      expect(JSON.parse(out.mock.calls[0][0] as string)).toMatchObject({
        level: 'info',
        traceId: 't-7',
        event: 'turn.finish',
        durationMs: 1234,
      });
    } finally {
      out.mockRestore();
    }
  });
});

describe('noopLogger', () => {
  it('writes nothing at any level', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      noopLogger.log('error', { traceId: 't', event: 'turn.error' });
      noopLogger.log('info', { traceId: 't', event: 'turn.start' });
      expect(out).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('errorFields', () => {
  it('extracts message and stack from an Error', () => {
    const fields = errorFields(new Error('nope'));
    expect(fields.error).toBe('nope');
    expect(typeof fields.stack).toBe('string');
  });

  it('handles non-Error throws without a stack', () => {
    expect(errorFields('plain')).toEqual({ error: 'plain' });
    expect(errorFields({ a: 1 }).error).toBe('[object Object]');
    expect(errorFields(null).error).toBe('null');
  });
});

describe('TRACE_HEADER', () => {
  it('is the documented response header name', () => {
    expect(TRACE_HEADER).toBe('X-Mordn-Trace-Id');
  });
});
