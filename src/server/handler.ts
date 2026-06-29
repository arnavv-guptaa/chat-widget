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
  generateId,
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
import { compressModelMessages, resolveCompression } from './compression';

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

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// For responses that carry user chat data (conversation lists, messages):
// never let a browser/proxy/disk cache retain them, and mark them private so
// a shared cache can't serve one user's history to another.
function jsonNoStore(body: unknown, status = 200): Response {
  return json(body, status, { 'Cache-Control': 'no-store, private' });
}

/**
 * Split the request path into the segments *after* the handler's mount point —
 * the trailing sub-route the handler dispatches on (`[]`, `['upload']`,
 * `['history']`, `['history', ':id']`).
 *
 * The handler is mount-agnostic: it can sit at `/api/chat`, `/api/preview-chat/:agentId`,
 * or anywhere. We detect the sub-route by the trailing KNOWN_SEGMENT
 * (`upload`/`history`) rather than a hardcoded mount marker:
 *   • `…/history`        → ['history']
 *   • `…/history/:id`    → ['history', ':id']
 *   • `…/upload`         → ['upload']
 *   • anything else      → []  (the root chat turn — POST, or empty GET)
 */
function subSegments(url: URL): string[] {
  const parts = url.pathname.split('/').filter(Boolean);
  // Scan from the end for the last known sub-route head. Everything from there
  // on is our sub-route; everything before it is the (arbitrary) mount path.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (KNOWN_SEGMENTS.has(parts[i])) {
      return parts.slice(i);
    }
  }
  return [];
}

/**
 * True when the final message set ends with an assistant message that actually
 * produced something — non-empty text/reasoning, or any tool call. Used to
 * decide whether an ABORTED turn is worth persisting: a stop AFTER content
 * arrived should be kept; a stop BEFORE the first token produced nothing and
 * must not leave an empty assistant bubble in history.
 */
function hasAssistantContent(messages: ReadonlyArray<{ role: string; parts?: unknown }>): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || !Array.isArray(last.parts)) return false;
  return (last.parts as Array<{ type?: string; text?: string }>).some((p) => {
    if (!p || typeof p.type !== 'string') return false;
    if (p.type === 'text' || p.type === 'reasoning') return Boolean(p.text && p.text.trim());
    // Any tool call / source / file part counts as real output.
    return p.type.startsWith('tool-') || p.type === 'dynamic-tool' || p.type === 'source-url' || p.type === 'file';
  });
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
    getHostedConfig,
    transformMessages,
    compression,
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

  // Precedence: code option > hosted config > throw. A hosted model is a
  // gateway string, which `streamText` accepts directly.
  async function resolveModel(
    ctx: ChatRequestContext,
    hostedModel?: string | null,
  ): Promise<LanguageModel> {
    if (typeof modelOption === 'function') return modelOption(ctx);
    if (modelOption) return modelOption;
    if (hostedModel) return hostedModel;
    throw new Error(
      '[chat-widget] No `model` provided. Pass a `model` (a LanguageModel or a ' +
        'function returning one), or configure one via hosted config.',
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

    // Sanitise the incoming array: drop anything that isn't a well-formed
    // message (null/undefined, missing role, missing parts). A malformed entry
    // must never crash the turn — skip it rather than throw downstream.
    const incoming = (Array.isArray(body.messages) ? body.messages : []).filter(
      (m): m is UIMessage =>
        !!m && typeof m === 'object' && typeof m.role === 'string' && Array.isArray(m.parts),
    );
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

    // Build tools (with their per-request resource).
    const built = buildTools ? await buildTools(ctx) : { tools: {} as ToolSet };
    const tools = built.tools ?? ({} as ToolSet);

    // Fetch hosted config once (best-effort — a failure must never break the
    // turn). The inner try/catch swallows BOTH a synchronous throw and an async
    // rejection, honouring the "throwing falls through to code/defaults"
    // contract for arbitrary consumers. Used only to fill model / system that
    // code didn't provide.
    const hosted = getHostedConfig
      ? await (async () => {
          try {
            return await getHostedConfig(ctx);
          } catch {
            return null;
          }
        })()
      : null;

    // Model: code option > hosted > throw.
    const model = await resolveModel(ctx, hosted?.model);
    // String label of the model for persistence (the `model` column). A
    // LanguageModel is either a gateway string ("anthropic/claude-…") or a
    // provider object exposing `.modelId`.
    const modelLabel =
      typeof model === 'string' ? model : (model as { modelId?: string }).modelId;

    // System prompt: code (buildSystemPrompt) > hosted > package default.
    const system = buildSystemPrompt
      ? await buildSystemPrompt(ctx)
      : hosted?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    // Optional Headroom token compression — the very last transform before the
    // model sees the messages, so it acts on exactly what would be sent.
    // Precedence: code > hosted > off. `compressModelMessages` never throws and
    // returns the originals on any failure, so a compression hiccup (endpoint
    // down, timeout, odd response) can't break the turn.
    const compressionConfig = resolveCompression(compression, hosted?.compression ?? null);
    if (compressionConfig) {
      const outcome = await compressModelMessages(
        modelMessages,
        compressionConfig,
        ctx,
        typeof modelLabel === 'string' ? modelLabel : undefined,
      );
      modelMessages = outcome.messages;
      if (compressionConfig.onResult) {
        try {
          compressionConfig.onResult(outcome.result, ctx);
        } catch (err) {
          console.error('[chat-widget] compression onResult hook threw:', err);
        }
      }
    }

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
      // REQUIRED for correct persistence. Without `generateMessageId` the
      // assistant message comes back with an empty id, so every assistant turn
      // in a conversation collides on the same '' primary key and only the
      // first one survives `saveTurn`'s idempotent insert. `originalMessages`
      // lets the SDK reuse existing ids (preventing duplicates) and return the
      // full original+response set in onFinish.
      originalMessages: incoming,
      generateMessageId: generateId,
      onFinish: async ({ messages: finalMessages, isAborted }) => {
        // Persist the assistant turn on EVERY settled path — finish AND client
        // abort (stop button). When a user stops a long answer they did so
        // because they had what they needed; discarding the partial reply makes
        // it vanish on reload, which reads as data loss. So we save the partial
        // too — it's a normal message with fewer parts.
        //
        // The one case we must NOT persist is an abort that produced no content
        // (stopped before the first token): that would leave an empty assistant
        // bubble in history. Guard on the turn actually having assistant output.
        const shouldPersist =
          finalMessages.length > 0 && (!isAborted || hasAssistantContent(finalMessages));
        if (shouldPersist) {
          // Persist the assistant turn. Errors here are logged loudly — a
          // silently-dropped turn is the exact failure we designed against —
          // but never thrown, because the user already has their answer.
          try {
            await store.saveTurn({ conversationId, messages: finalMessages, model: modelLabel });
          } catch (err) {
            console.error(
              JSON.stringify({
                event: 'chat.save_failed',
                userId: ctx.userId,
                conversationId,
                aborted: isAborted,
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
    return jsonNoStore({
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

    return jsonNoStore({
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
    if (!msg || !Array.isArray(msg.parts)) return msg;
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
