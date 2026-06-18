/**
 * createChatHandler — the request router and the "OWN loop".
 *
 * This is the heart of the redesign. It owns every piece of shared,
 * dangerous-to-get-wrong plumbing so a host app never writes it:
 *
 *   • authentication gate (401 when getUserId returns null)
 *   • conversation ownership (create-or-reject; never write a foreign row)
 *   • idempotent user-message persistence
 *   • sliding-window context pruning + defensive per-message capping
 *   • per-request tool resources with guaranteed single teardown
 *   • streaming the model response
 *   • save-on-finish persistence of the assistant turn
 *   • history list + history-by-id with attachment re-signing
 *   • uploads to private storage with server-side policy enforcement
 *
 * It exposes only the seams in `CreateChatHandlerOptions`. Nothing security-
 * or correctness-critical is configurable, by design.
 *
 * Mounting: the returned `{ GET, POST }` is designed to sit on a single
 * catch-all route, `app/api/chat/[[...chat]]/route.ts`, so one file mounts the
 * whole backend. The handler dispatches on the trailing path segments:
 *
 *   POST   /api/chat                      → chat (stream)
 *   POST   /api/chat/upload               → attachment upload
 *   GET    /api/chat/history              → conversation list
 *   GET    /api/chat/history/:id          → one conversation + messages
 *   DELETE /api/chat/history/:id          → delete a conversation
 */

import 'server-only';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from 'ai';

import { ConversationOwnershipError, type ChatStore } from './chat-store';
import type { StorageAdapter } from './storage-adapter';
import type {
  ChatRequestContext,
  CreateChatHandlerOptions,
  UploadPolicy,
} from './handler-types';

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY_MESSAGES = 30;
const DEFAULT_MAX_MESSAGE_CHARS = 4000;
const DEFAULT_STEP_BUDGET = 10;
const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_ALLOWED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
];
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

// Internal: the base path the handler is mounted under, used to compute the
// sub-route from the request URL. Derived from the request, not hardcoded, so
// the handler works whether mounted at /api/chat or somewhere else.
const KNOWN_SEGMENTS = new Set(['upload', 'history']);

// ── Small helpers ─────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Split the request path into the segments *after* the handler's mount point.
 * We locate the mount point by finding the last "chat" segment that's followed
 * only by known sub-routes (or nothing). This keeps the handler agnostic to
 * the exact mount path.
 */
function subSegments(url: URL): string[] {
  const parts = url.pathname.split('/').filter(Boolean);
  // Find the final "chat" segment — everything after it is our sub-route.
  const chatIdx = parts.lastIndexOf('chat');
  if (chatIdx === -1) return [];
  return parts.slice(chatIdx + 1);
}

// ── The handler ─────────────────────────────────────────────────────────────

export function createChatHandler(options: CreateChatHandlerOptions) {
  const {
    getUserId,
    model: modelOption,
    buildTools,
    store: storeFactory,
    storage: storageFactory,
    buildSystemPrompt,
    transformMessages,
    onChatFinish,
    onError,
    stopWhen,
    upload,
    maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
    maxMessageChars = DEFAULT_MAX_MESSAGE_CHARS,
  } = options;

  // The hosted default store/storage are resolved lazily so a BYO consumer who
  // passes their own never triggers our default's env-var requirements.
  function resolveStore(userId: string): ChatStore {
    if (storeFactory) return storeFactory(userId);
    // The hosted/default Drizzle store is wired in a later step. Until then,
    // a BYO `store` is required. Failing loudly here is correct: a silent
    // no-op store would drop every message.
    throw new Error(
      '[chat-widget] No `store` provided and the hosted default store is not ' +
        'configured. Pass a `store` factory (see createDrizzleChatStore).',
    );
  }

  function resolveStorage(userId: string): StorageAdapter | null {
    if (storageFactory) return storageFactory(userId);
    return null; // uploads disabled when no storage configured
  }

  async function resolveModel(ctx: ChatRequestContext): Promise<LanguageModel> {
    if (typeof modelOption === 'function') return modelOption(ctx);
    if (modelOption) return modelOption;
    throw new Error(
      '[chat-widget] No `model` provided. Pass a `model` (a LanguageModel or a ' +
        'function returning one).',
    );
  }

  // Authenticate and build the per-request context. Returns null when the
  // request is unauthenticated — callers turn that into a 401.
  async function authenticate(request: Request, conversationId: string): Promise<ChatRequestContext | null> {
    const userId = await getUserId(request);
    if (!userId) return null;
    return { userId, conversationId, request };
  }

  // ── POST /chat ─────────────────────────────────────────────────────────
  async function handleChat(request: Request): Promise<Response> {
    let body: { messages?: UIMessage[]; id?: string };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const conversationId = typeof body.id === 'string' && body.id ? body.id : undefined;
    if (!conversationId) return json({ error: 'Missing conversation id' }, 400);

    const ctx = await authenticate(request, conversationId);
    if (!ctx) return new Response('Unauthorized', { status: 401 });

    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const store = resolveStore(ctx.userId);

    // Ownership chokepoint: create the conversation for this user, or reject
    // (403) if the id belongs to someone else. Nothing is persisted on reject.
    try {
      await store.ensureConversation(conversationId);
    } catch (err) {
      if (err instanceof ConversationOwnershipError) {
        return new Response('Forbidden', { status: 403 });
      }
      throw err;
    }

    // Persist the latest user message idempotently (the store dedupes on id).
    const lastUser = [...incoming].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      await store.saveTurn({ conversationId, messages: [lastUser] });
    }

    // Sliding-window prune + defensive char-cap, then the host's transform.
    const windowed = incoming.slice(-maxHistoryMessages);
    const capped = maxMessageChars > 0 ? capMessages(windowed, maxMessageChars) : windowed;
    let modelMessages: ModelMessage[] = await convertToModelMessages(capped);
    if (transformMessages) modelMessages = await transformMessages(modelMessages, ctx);

    // Build tools (with their per-request resource) and resolve the model.
    const built = buildTools ? await buildTools(ctx) : { tools: {} as ToolSet };
    const tools = built.tools ?? ({} as ToolSet);
    const model = await resolveModel(ctx);
    const system = buildSystemPrompt ? await buildSystemPrompt(ctx) : DEFAULT_SYSTEM_PROMPT;

    // Single, guarded teardown of the tools' per-request resource. Fires
    // exactly once across all completion paths (finish / error / abort).
    let cleanedUp = false;
    const runCleanup = async (reason: string) => {
      if (cleanedUp || !built.cleanup) return;
      cleanedUp = true;
      try {
        await built.cleanup();
      } catch (err) {
        console.error(`[chat-widget] tool cleanup failed (${reason}):`, err);
      }
    };
    request.signal.addEventListener('abort', () => void runCleanup('client-abort'));

    // streamText's own onFinish is the only place usage + providerMetadata are
    // available (the UI-stream onFinish below exposes neither). Capture them
    // here so the host's onChatFinish hook gets real numbers, not undefined.
    let finalUsage: unknown;
    let finalProviderMetadata: unknown;

    const result = streamText({
      model,
      system,
      messages: modelMessages,
      tools,
      stopWhen: stopWhen ?? stepCountIs(DEFAULT_STEP_BUDGET),
      onFinish: ({ usage, providerMetadata }) => {
        finalUsage = usage;
        finalProviderMetadata = providerMetadata;
      },
    });

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      onFinish: async ({ messages: finalMessages, isAborted }) => {
        // Don't persist a turn the client aborted mid-stream — the assistant
        // message is partial and the user didn't receive it. The idempotent
        // user-message save already happened before streaming.
        if (!isAborted && finalMessages.length > 0) {
          // Persist the assistant turn. Errors here are logged loudly — a
          // silently-dropped turn is the exact failure we designed against —
          // but never thrown, because the user already has their answer.
          try {
            await store.saveTurn({ conversationId, messages: finalMessages });
          } catch (err) {
            console.error(
              JSON.stringify({
                event: 'chat.save_failed',
                userId: ctx.userId,
                conversationId,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
        if (onChatFinish) {
          try {
            await onChatFinish({
              ctx,
              messages: finalMessages,
              usage: finalUsage,
              providerMetadata: finalProviderMetadata,
            });
          } catch (err) {
            console.error('[chat-widget] onChatFinish hook threw:', err);
          }
        }
        await runCleanup('on-finish');
      },
      onError: (err) => {
        const message = onError ? onError(err) : defaultErrorMessage(err);
        void runCleanup('on-error');
        return message;
      },
    });
  }

  // ── GET /history ─────────────────────────────────────────────────────────
  async function handleHistoryList(request: Request): Promise<Response> {
    const ctx = await authenticate(request, '');
    if (!ctx) return new Response('Unauthorized', { status: 401 });
    const store = resolveStore(ctx.userId);
    const conversations = await store.listConversations();
    return json({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        metadata: c.metadata,
        message_count: c.messageCount,
      })),
    });
  }

  // ── GET /history/:id  and  DELETE /history/:id ─────────────────────────────
  async function handleConversation(
    request: Request,
    conversationId: string,
    method: 'GET' | 'DELETE',
  ): Promise<Response> {
    const ctx = await authenticate(request, conversationId);
    if (!ctx) return new Response('Unauthorized', { status: 401 });
    const store = resolveStore(ctx.userId);
    const storage = resolveStorage(ctx.userId);

    if (method === 'DELETE') {
      const deleted = await store.deleteConversation(conversationId);
      return new Response(null, { status: deleted ? 204 : 404 });
    }

    const conversation = await store.getConversation(conversationId);
    if (!conversation) return json({ error: 'Conversation not found' }, 404);

    const messages = await store.listMessages(conversationId, { limit: 100 });
    // Re-sign attachment URLs so reopened conversations show live thumbnails.
    const rehydrated = storage
      ? await Promise.all(messages.map((m) => resignMessageAttachments(m, storage)))
      : messages;

    return json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        metadata: conversation.metadata,
      },
      messages: rehydrated.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.text,
        created_at: m.createdAt,
        parts: m.parts,
      })),
    });
  }

  // ── POST /upload ───────────────────────────────────────────────────────────
  async function handleUpload(request: Request): Promise<Response> {
    const ctx = await authenticate(request, '');
    if (!ctx) return new Response('Unauthorized', { status: 401 });
    const storage = resolveStorage(ctx.userId);
    if (!storage) return json({ error: 'File upload is not configured' }, 503);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Invalid multipart body' }, 400);
    }
    const file = form.get('file');
    const conversationId =
      typeof form.get('conversationId') === 'string'
        ? (form.get('conversationId') as string)
        : undefined;

    if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);

    const policy = resolveUploadPolicy(upload);
    if (file.size === 0) return json({ error: 'Empty file' }, 400);
    if (file.size > policy.maxBytes) {
      return json({ error: `File too large (max ${policy.maxBytes / 1024 / 1024} MB)` }, 413);
    }
    const mediaType = file.type || 'application/octet-stream';
    if (!policy.allowedMediaTypes.includes(mediaType)) {
      return json({ error: `Unsupported file type: ${mediaType}` }, 415);
    }

    const data = await file.arrayBuffer();
    const uploaded = await storage.upload({
      data,
      filename: file.name,
      mediaType,
      size: file.size,
      conversationId,
    });
    return json({
      url: uploaded.url,
      storagePath: uploaded.storagePath,
      filename: uploaded.filename,
      mediaType: uploaded.mediaType,
      size: uploaded.size,
      type: 'file',
    });
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────
  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const segments = subSegments(url);
    const method = request.method.toUpperCase();

    try {
      // /chat (no extra segments)
      if (segments.length === 0) {
        if (method === 'POST') return await handleChat(request);
        return methodNotAllowed();
      }
      const [head, ...rest] = segments;
      if (!KNOWN_SEGMENTS.has(head)) return json({ error: 'Not found' }, 404);

      if (head === 'upload') {
        if (method === 'POST') return await handleUpload(request);
        return methodNotAllowed();
      }
      if (head === 'history') {
        if (rest.length === 0) {
          if (method === 'GET') return await handleHistoryList(request);
          return methodNotAllowed();
        }
        const conversationId = rest[0];
        if (method === 'GET') return await handleConversation(request, conversationId, 'GET');
        if (method === 'DELETE') return await handleConversation(request, conversationId, 'DELETE');
        return methodNotAllowed();
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('[chat-widget] handler error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  }

  // Next.js App Router expects named method exports. We point them all at the
  // same dispatcher so one catch-all route file mounts everything.
  return {
    GET: dispatch,
    POST: dispatch,
    DELETE: dispatch,
  };
}

// ── Module-private utilities ────────────────────────────────────────────────

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405);
}

function defaultErrorMessage(err: unknown): string {
  console.error('[chat-widget] stream error:', err);
  return 'An error occurred while generating the response.';
}

function resolveUploadPolicy(upload?: UploadPolicy): {
  maxBytes: number;
  allowedMediaTypes: string[];
} {
  return {
    maxBytes: upload?.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    allowedMediaTypes: upload?.allowedMediaTypes ?? DEFAULT_ALLOWED_MEDIA_TYPES,
  };
}

/** Cap overlong text parts so one pasted blob can't dominate the window. */
function capMessages(messages: UIMessage[], maxChars: number): UIMessage[] {
  return messages.map((msg) => {
    if (!msg.parts) return msg;
    const parts = msg.parts.map((p) =>
      p.type === 'text' && typeof (p as { text?: string }).text === 'string' && (p as { text: string }).text.length > maxChars
        ? { ...p, text: (p as { text: string }).text.slice(0, maxChars) }
        : p,
    );
    return { ...msg, parts };
  });
}

/**
 * Re-sign every file part on a stored message so a reopened conversation gets
 * live URLs. A failed re-sign leaves the original (stale) url in place rather
 * than dropping the whole message — one missing blob never breaks a load.
 */
async function resignMessageAttachments<T extends { parts: UIMessage['parts'] }>(
  message: T,
  storage: StorageAdapter,
): Promise<T> {
  if (!message.parts?.length) return message;
  const parts = await Promise.all(
    message.parts.map(async (part) => {
      const p = part as { type?: string; storagePath?: string; url?: string };
      if (p.type !== 'file' || typeof p.storagePath !== 'string') return part;
      const fresh = await storage.resign(p.storagePath);
      return fresh ? { ...part, url: fresh } : part;
    }),
  );
  return { ...message, parts };
}
