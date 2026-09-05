import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import {
  CHAT_ERROR_DATA_TYPE,
  CHAT_ERROR_HEADER,
  messageForErrorKind,
  parseChatErrorHeader,
  parseChatErrorMetadata,
  type ChatErrorMetadata,
} from './chat-error-protocol';

interface ErrorRecovery {
  readonly metadata: Readonly<ChatErrorMetadata>;
  /** Absolute deadline captured on receipt, so re-renders/tab switches do not
   * restart a server-specified wait. Never schedules a network request. */
  readonly retryAt?: number;
}
const recoveryByError = new WeakMap<Error, ErrorRecovery>();

export function getChatErrorRecovery(error: Error | null | undefined): ErrorRecovery | undefined {
  return error ? recoveryByError.get(error) : undefined;
}

function recovery(metadata: ChatErrorMetadata): ErrorRecovery {
  return Object.freeze({
    metadata: Object.freeze(metadata),
    ...(metadata.retryAfterMs !== undefined ? { retryAt: Date.now() + metadata.retryAfterMs } : {}),
  });
}

/** Use wrapTransport for a Chat: recovery must belong to each response stream,
 * not to a Chat-wide callback slot. A stopped response can still have queued
 * callbacks after the next request begins, and aborts skip the SDK onError hook.
 * The low-level onData/onError pair is only for a single, isolated stream.
 * Nothing is persisted in message parts or automatically retried.
 */
export function createChatErrorRecovery() {
  let pending: ErrorRecovery | undefined;
  const reset = () => { pending = undefined; };
  return {
    reset,
    /** Preserve the transport's method receiver and SDK request signatures. Each
     * send/reconnect has its own accumulator, including overlapping responses. */
    wrapTransport<UI_MESSAGE extends UIMessage>(transport: ChatTransport<UI_MESSAGE>): ChatTransport<UI_MESSAGE> {
      const wrap = (stream: ReadableStream<UIMessageChunk>) => {
        const local = createChatErrorRecovery();
        return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            if (chunk.type === CHAT_ERROR_DATA_TYPE) {
              // This reserved control part must never become transcript data,
              // even when a custom server mistakenly omits transient:true.
              if (!('transient' in chunk) || chunk.transient !== true) return;
              local.onData(chunk);
            }
            if (chunk.type === 'error') {
              const error = new Error(chunk.errorText);
              local.onError(error);
              // The SDK passes stream failures to onError and stores this exact
              // Error. No unscoped callback association or prose matching needed.
              controller.error(error);
              return;
            }
            controller.enqueue(chunk);
          },
        }));
      };
      return {
        async sendMessages(options) { return wrap(await transport.sendMessages(options)); },
        async reconnectToStream(options) {
          const stream = await transport.reconnectToStream(options);
          return stream === null ? null : wrap(stream);
        },
      };
    },
    onData(part: unknown) {
      try {
        if (!part || typeof part !== 'object') return;
        const candidate = part as { type?: unknown; data?: unknown; transient?: unknown };
        if (candidate.type !== CHAT_ERROR_DATA_TYPE || candidate.transient !== true) return;
        const metadata = parseChatErrorMetadata(candidate.data);
        if (metadata && !pending) pending = recovery(metadata);
      } catch {
        // Non-JSON callers can supply throwing getters. Ignore bad metadata.
      }
    },
    onError(error: Error) {
      if (pending && !recoveryByError.has(error)) recoveryByError.set(error, pending);
      reset();
    },
    /** DefaultChatTransport fetch seam. Non-OK HTTP bodies remain untouched for
     * old servers. New-server metadata yields an Error with package-owned copy;
     * no arbitrary HTTP body/provider secret is promoted to a UI message. */
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      reset();
      const response = await globalThis.fetch(input, init);
      if (!response.ok) {
        const metadata = parseChatErrorHeader(response.headers.get(CHAT_ERROR_HEADER));
        if (metadata) {
          const error = new Error(messageForErrorKind(metadata.kind));
          recoveryByError.set(error, recovery(metadata));
          // We replace the transport's error path, so release its unread body.
          void response.body?.cancel().catch(() => {});
          throw error;
        }
      }
      return response;
    }) satisfies typeof fetch,
  };
}
