import { generateId, safeValidateUIMessages, type UIMessage } from 'ai';

// Structural work limits, independent of the handler's byte cap and model-context
// pruning. Validate the WHOLE history before pruning, persistence or SDK conversion.
export const CHAT_REQUEST_LIMITS = {
  idChars: 256,
  messages: 1000,
  partsPerMessage: 1024,
  totalParts: 4096,
  depth: 32,
  nodes: 50000,
} as const;

interface ChatRequestBody {
  id: string;
  messages: UIMessage[];
  context?: unknown;
  config?: unknown;
}

type ValidationResult =
  | { ok: true; body: ChatRequestBody }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= CHAT_REQUEST_LIMITS.idChars && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Iterative: hostile JSON nesting must not overflow our stack or the SDK's. */
function isWithinStructureLimits(root: unknown): boolean {
  const pending = [{ value: root, depth: 0 }];
  let nodes = 1;
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (depth > CHAT_REQUEST_LIMITS.depth) return false;
    if (value === null || typeof value !== 'object') continue;
    for (const child of Object.values(value)) {
      if (++nodes > CHAT_REQUEST_LIMITS.nodes) return false;
      pending.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
}

/**
 * Validate parsed, byte-bounded JSON, NOT the authenticity of client history.
 * Assistant/tool results, approvals, metadata and file URLs remain untrusted.
 * Tool authorization and attachment ownership/network policy belong server-side.
 *
 * Use the installed AI SDK v6's own part schema instead of a text-only allowlist:
 * tool continuations/approvals, dynamic tools, files, sources and data parts must
 * round-trip. No tool/data/metadata schemas are supplied here: their application
 * payloads are opaque JSON, bounded structurally, not application-validated.
 */
export async function validateChatRequest(value: unknown): Promise<ValidationResult> {
  if (!isRecord(value)) return { ok: false, error: 'Invalid chat request' };
  if (!isId(value.id)) return { ok: false, error: 'Invalid conversation id' };
  if (!Array.isArray(value.messages)) return { ok: false, error: 'Invalid messages' };
  if (value.messages.length > CHAT_REQUEST_LIMITS.messages || !isWithinStructureLimits(value)) {
    return { ok: false, error: 'Chat request exceeds structural limits' };
  }

  let totalParts = 0;
  const messages: Record<string, unknown>[] = [];
  for (const message of value.messages) {
    // Never silently drop a malformed entry or allow a client system/developer
    // role, including one outside the sliding context window.
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant') ||
        !Array.isArray(message.parts) || (message.id !== undefined && !isId(message.id))) {
      return { ok: false, error: 'Invalid messages' };
    }
    totalParts += message.parts.length;
    if (message.parts.length > CHAT_REQUEST_LIMITS.partsPerMessage || totalParts > CHAT_REQUEST_LIMITS.totalParts) {
      return { ok: false, error: 'Chat request exceeds structural limits' };
    }
    for (const part of message.parts) {
      if (!isRecord(part)) return { ok: false, error: 'Invalid message parts' };
      // Reserved server-to-client transient control data is never valid history.
      // Reject forged/replayed copies before persistence or model conversion.
      if (part.type === 'data-chat-error') return { ok: false, error: 'Invalid message parts' };
      // storagePath is a widget extension, absent from the SDK schema. Preserve
      // it for re-signing/deletion, but never interpret it as proof of ownership.
      if (part.type === 'file' && part.storagePath !== undefined &&
          (typeof part.storagePath !== 'string' || part.storagePath.length === 0)) {
        return { ok: false, error: 'Invalid message parts' };
      }
    }
    // Legacy integrations omit message ids. Supply one rather than narrowing
    // that existing contract; clients need stable ids for retry deduplication.
    messages.push({ ...message, id: message.id ?? generateId() });
  }

  // An explicitly empty history was already accepted (e.g. initial turns).
  // Missing/non-array messages are NOT equivalent to an intentional empty list.
  if (messages.length > 0) {
    const validated = await safeValidateUIMessages({ messages });
    if (!validated.success) return { ok: false, error: 'Invalid message parts' };
  }

  // The SDK validates but strips unknown extension fields. Keep the checked
  // originals, notably file.storagePath and consumer metadata, not that projection.
  return {
    ok: true,
    body: { ...value, id: value.id, messages: messages as unknown as UIMessage[] },
  };
}
