/** Browser-safe, versioned error contract. Never add provider payloads, messages,
 * codes, stacks or causes here. Metadata is a UI hint, NOT server authorization
 * or permission to replay a request (tools may already have had side effects).
 */
export const CHAT_ERROR_VERSION = 1 as const;
export const CHAT_ERROR_DATA_TYPE = 'data-chat-error' as const;
/** JSON metadata in a header preserves the existing HTTP status and body. */
export const CHAT_ERROR_HEADER = 'x-chat-error';
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

export type ChatErrorKind =
  | 'abort'
  | 'rate_limit'
  | 'auth'
  | 'transient'
  | 'content_policy'
  | 'prompt'
  | 'model'
  | 'tool'
  | 'unknown';

export interface ChatErrorMetadata {
  version: typeof CHAT_ERROR_VERSION;
  kind: ChatErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
  /** Opaque correlation reference, not user-facing copy or a URL. */
  traceId?: string;
}

const MESSAGES: Record<ChatErrorKind, string> = {
  abort: 'The response was aborted.',
  rate_limit: 'The assistant is handling a lot of requests right now. Please try again in a moment.',
  auth: 'The assistant is not configured correctly. Please contact support.',
  transient: 'The assistant is temporarily unavailable. Please try again.',
  content_policy: "I can't help with that request.",
  prompt: "That request couldn't be processed. Try rephrasing or shortening your message.",
  model: 'The configured model could not complete this request. Try a different request or contact support.',
  tool: 'A tool the assistant was using failed. Please try again.',
  unknown: 'An error occurred while generating the response.',
};

export function messageForErrorKind(kind: ChatErrorKind): string {
  return Object.prototype.hasOwnProperty.call(MESSAGES, kind) ? MESSAGES[kind] : MESSAGES.unknown;
}

/** Fail closed on unknown versions/kinds and malformed core fields. Return a
 * fresh allowlisted projection, never spread untrusted data into an Error/DOM.
 * Optional invalid hints are dropped. Contradictory retry hints cannot enable
 * retries for auth/policy/tool/etc. No caller should use this as server policy.
 */
export function parseChatErrorMetadata(value: unknown): ChatErrorMetadata | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    // Read each property once, including for non-JSON callers with getters.
    const { version, kind: rawKind, retryable: rawRetryable, retryAfterMs, traceId } = value as Record<string, unknown>;
    if (version !== CHAT_ERROR_VERSION || typeof rawKind !== 'string' ||
        !Object.prototype.hasOwnProperty.call(MESSAGES, rawKind) ||
        typeof rawRetryable !== 'boolean') return undefined;
    const kind = rawKind as ChatErrorKind;
    const retryable = rawRetryable && (kind === 'rate_limit' || kind === 'transient');
    const metadata: ChatErrorMetadata = { version: CHAT_ERROR_VERSION, kind, retryable };
    if (retryable && typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      metadata.retryAfterMs = Math.min(Math.ceil(retryAfterMs), MAX_RETRY_AFTER_MS);
    }
    if (typeof traceId === 'string' && traceId.length >= 8 && traceId.length <= 128 &&
        !/[^A-Za-z0-9._-]/.test(traceId)) {
      metadata.traceId = traceId;
    }
    return metadata;
  } catch {
    return undefined;
  }
}

export function parseChatErrorHeader(value: string | null): ChatErrorMetadata | undefined {
  if (!value || value.length > 2048) return undefined;
  try { return parseChatErrorMetadata(JSON.parse(value)); } catch { return undefined; }
}

/** Server-side projection. Deliberately accepts only the public fields, not
 * `cause`, `code`, `status` or `message` from ClassifiedChatError. */
export function toChatErrorMetadata(
  classified: Pick<ChatErrorMetadata, 'kind' | 'retryable' | 'retryAfterMs'>,
  traceId: string,
): ChatErrorMetadata {
  return parseChatErrorMetadata({
    version: CHAT_ERROR_VERSION,
    kind: classified.kind,
    retryable: classified.retryable,
    retryAfterMs: classified.retryAfterMs,
    traceId,
  }) ?? { version: CHAT_ERROR_VERSION, kind: 'unknown', retryable: false };
}
