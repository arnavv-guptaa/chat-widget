import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { createChatErrorRecovery, getChatErrorRecovery } from '../src/utils/chat-error-recovery';

function source() {
  let writer!: ReadableStreamDefaultController<UIMessageChunk>;
  const stream = new ReadableStream<UIMessageChunk>({ start(controller) { writer = controller; } });
  return { stream, get writer() { return writer; } };
}
async function readError(reader: ReadableStreamDefaultReader<UIMessageChunk>): Promise<Error> {
  try { await reader.read(); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('Expected stream failure');
}
const metadata: UIMessageChunk = {
  type: 'data-chat-error', transient: true,
  data: { version: 1, kind: 'auth', retryable: false },
};
const options = { chatId: 'same-tab', messages: [], trigger: 'submit-message' as const, messageId: undefined, abortSignal: undefined };

describe('error metadata belongs to a response stream, not the Chat callback slot', () => {
  it('cannot label a new failure with late metadata from an aborted/overlapping response', async () => {
    const old = source();
    const next = source();
    const seam = createChatErrorRecovery();
    const base: ChatTransport<UIMessage> = {
      sendMessages: vi.fn().mockResolvedValueOnce(old.stream).mockResolvedValueOnce(next.stream),
      reconnectToStream: async () => null,
    };
    const transport = seam.wrapTransport(base);
    const oldReader = (await transport.sendMessages(options)).getReader();
    const nextReader = (await transport.sendMessages(options)).getReader();
    // Old metadata arrives AFTER the next request starts. Its abort never calls
    // Chat.onError, so a shared pending slot would poison the next error.
    old.writer.enqueue(metadata);
    expect((await oldReader.read()).value).toEqual(metadata);
    old.writer.enqueue({ type: 'abort' });
    old.writer.close();
    expect((await oldReader.read()).value?.type).toBe('abort');
    expect((await oldReader.read()).done).toBe(true);
    next.writer.enqueue({ type: 'error', errorText: 'Unrelated next failure' });
    const error = await nextReader.read().catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(getChatErrorRecovery(error as Error)).toBeUndefined();
  });

  it('keeps overlapping errors distinct and preserves callback copy', async () => {
    const a = source();
    const b = source();
    const transport = createChatErrorRecovery().wrapTransport<UIMessage>({
      sendMessages: vi.fn().mockResolvedValueOnce(a.stream).mockResolvedValueOnce(b.stream),
      reconnectToStream: async () => null,
    });
    const ra = (await transport.sendMessages(options)).getReader();
    const rb = (await transport.sendMessages(options)).getReader();
    a.writer.enqueue(metadata);
    b.writer.enqueue({ type: 'data-chat-error', transient: true, data: { version: 1, kind: 'transient', retryable: true } });
    await Promise.all([ra.read(), rb.read()]);
    b.writer.enqueue({ type: 'error', errorText: 'B copy' });
    a.writer.enqueue({ type: 'error', errorText: 'A copy' });
    const [ea, eb] = await Promise.all([readError(ra), readError(rb)]);
    expect(ea.message).toBe('A copy');
    expect(eb.message).toBe('B copy');
    expect(getChatErrorRecovery(ea)?.metadata.kind).toBe('auth');
    expect(getChatErrorRecovery(eb)?.metadata.kind).toBe('transient');
  });

  it('drops non-transient reserved control data and wraps reconnects without losing the receiver', async () => {
    const s = source();
    const base: ChatTransport<UIMessage> = {
      async sendMessages() { throw new Error('not used'); },
      async reconnectToStream() { expect(this).toBe(base); return s.stream; },
    };
    const transport = createChatErrorRecovery().wrapTransport(base);
    const reader = (await transport.reconnectToStream({ chatId: 'same-tab' }))!.getReader();
    s.writer.enqueue({ type: 'data-chat-error', data: { version: 1, kind: 'auth', retryable: false } });
    s.writer.enqueue({ type: 'error', errorText: 'legacy copy' });
    const error = await reader.read().catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(getChatErrorRecovery(error as Error)).toBeUndefined();
  });
});
