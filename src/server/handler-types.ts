/**
 * Public configuration surface for `createChatHandler`.
 *
 * This is the API a host app touches to mount the chat backend. The design
 * follows one rule, derived from auditing a real power-user integration
 * (Jarvis): take away the shared, dangerous-to-get-wrong plumbing; keep every
 * point of genuine per-app variation as an injection point or a hook.
 *
 * Three tiers of override, from "you must" to "you rarely will":
 *
 *   REQUIRED injections — no safe default exists:
 *     • getUserId          (identity; the security boundary)
 *
 *   OPTIONAL injections — a default exists, swap to take control:
 *     • model              (which LLM)
 *     • buildTools         (your tools, incl. per-request resources)
 *     • store              (persistence; hosted default)
 *     • storage            (attachments; hosted default)
 *
 *   HOOKS — the loop runs fine without them; override one seam at a time:
 *     • buildSystemPrompt, transformMessages, onChatFinish, onError,
 *       stopWhen, upload
 *
 * Everything NOT in this file — ownership checks, idempotency, pagination,
 * re-signing, socket teardown, save-on-finish — is owned by the handler and
 * is intentionally not configurable, because getting it wrong is a security
 * or correctness bug, not a preference.
 */

import type { LanguageModel, ModelMessage, ToolSet, UIMessage, StopCondition } from 'ai';
import type { ChatStoreFactory } from './chat-store';
import type { StorageAdapterFactory } from './storage-adapter';
import type { Namespace, RetrievedChunk, RetrieverFactory } from './knowledge/types';
import type { Memory, MemoryAdapterFactory, MemoryScope } from './memory/types';

/**
 * Everything a per-request hook/injection needs to know about the current
 * request, assembled by the handler AFTER authentication. Passed to
 * `buildTools`, `model` (when a function), `buildSystemPrompt`, and
 * `transformMessages`.
 *
 * Note `userId` is the server-verified identity — the same value the store
 * and storage are bound to. Hooks can trust it.
 */
export interface ChatRequestContext {
  /** Server-verified user id. Never client-supplied. */
  userId: string;
  /** The conversation this request targets. */
  conversationId: string;
  /** The raw request, for hooks that need headers/cookies (e.g. an org id). */
  request: Request;
}

/**
 * Per-agent declarative config returned by a hosted control plane. All fields
 * optional — only what the dashboard has set is present; the rest falls through
 * to code/defaults. `model` is a gateway model string (e.g. "anthropic/…").
 */
export interface HostedAgentConfig {
  model?: string | null;
  systemPrompt?: string | null;
  greeting?: string | null;
  appearance?: Record<string, unknown> | null;
}

/**
 * What `buildTools` returns. The `cleanup` callback is the critical piece the
 * naive "just return a ToolSet" design misses: tools backed by a per-request
 * resource (an MCP client holding a socket, a DB transaction, a temp scope)
 * MUST be torn down after the stream finishes — exactly once, whether the
 * stream completed, errored, or the client aborted. The handler guarantees
 * that single, correctly-timed call so the host app never leaks sockets.
 */
export interface BuiltTools {
  tools: ToolSet;
  /**
   * Called exactly once when the request is fully done (success, error, or
   * abort), after the response stream has settled. Optional — omit when your
   * tools hold no per-request resource.
   */
  cleanup?: () => void | Promise<void>;
}

/**
 * Server-side upload policy. Enforced by the handler's upload route BEFORE
 * any bytes touch storage, so an oversized or disallowed file is rejected
 * with a clean 4xx instead of a framework body-parse failure. The widget's
 * client-side `accept`/`maxBytes` should mirror these, but the SERVER is the
 * source of truth — the client checks are UX, these checks are the boundary.
 */
export interface UploadPolicy {
  /**
   * Allowed MIME types. An exact-match allow-list (not a prefix match) so
   * `image/svg+xml` can be excluded while `image/png` is allowed. Defaults to
   * a conservative image+pdf set that current vision models accept natively.
   */
  allowedMediaTypes?: string[];
  /** Per-file size cap in bytes. Defaults to 5 MB. */
  maxBytes?: number;
}

/**
 * Knowledge (RAG) retrieval config. Omit the whole `retrieval` option to disable
 * retrieval (default = off). When present, the handler resolves the namespaces
 * THIS request may read (from the verified ctx), constructs a namespace-fenced
 * `Retriever`, and either exposes a `searchKnowledge` tool (`mode: 'tool'`,
 * default) or auto-retrieves + injects a delimited context block (`mode: 'auto'`).
 *
 * SECURITY: `resolveNamespaces` is the trusted hinge — it MUST derive namespaces
 * from server-verified values (agentId from your routing, tenantId from the
 * session, the verified userId), NEVER from the request body. The `Retriever`
 * has no namespace parameter, so a forged agentId in the body is irrelevant.
 */
export interface RetrievalConfig {
  /** Read-only retriever factory (e.g. createKnowledgeDrizzleRetriever({ embedder })). */
  store: RetrieverFactory;

  /**
   * Resolve which namespaces this request may read, from the verified ctx.
   * Return both the shared agent KB and the user's private namespace to support
   * "shared docs + my uploaded PDF" (e.g. `[agent:${id}, user:${ctx.userId}:${id}]`).
   */
  resolveNamespaces: (ctx: ChatRequestContext) => Namespace[] | Promise<Namespace[]>;

  /**
   * Retrieval mode. Default 'tool' (the model calls `searchKnowledge`). 'auto'
   * retrieves on every turn and injects a delimited context block before
   * generation. Both emit `source-url` parts for citations.
   */
  mode?: 'tool' | 'auto';

  /** Max chunks per retrieval. Default 5; the store clamps to a ceiling (20). */
  topK?: number;
  /** Drop chunks below this similarity. Default 0.2. */
  minScore?: number;
  /** Hybrid weighting: 1 = pure vector, 0 = pure lexical. Default 1. */
  vectorWeight?: number;
  /** Emit `source-url` parts so the existing sources UI renders citations. Default true. */
  citations?: boolean;

  /**
   * Build the query string from the conversation (for 'auto' mode). Default:
   * the latest user message's text. Override for query rewriting/condensation.
   */
  buildQuery?: (messages: ModelMessage[], ctx: ChatRequestContext) => string | Promise<string>;

  /** Customise how chunks become the injected context block (delimiting lives here). */
  renderContext?: (chunks: RetrievedChunk[]) => string;
}

/**
 * Long-term, per-user memory config. Omit the whole `memory` option to disable
 * memory (default = off). When present, the handler retrieves the bound user's
 * relevant memories BEFORE generation (injected as a non-authoritative system
 * block) and extracts new memories AFTER the turn settles (off the hot path,
 * fire-and-forget). Adds three user-control routes (GET/DELETE /memory[/:id]).
 *
 * Distinct from `maxHistoryMessages` (short-term, in-conversation) and from
 * knowledge/RAG (`retrieval`, developer-curated, shared).
 */
export interface MemoryConfig {
  /** Per-request factory bound to the verified userId. */
  adapter: MemoryAdapterFactory;

  /** Inject retrieved memories before generation. Default true. */
  inject?: boolean;
  /** Run extraction after each turn. Default true. */
  extract?: boolean;

  /** How many memories to inject per turn. Default 6 (the adapter also clamps). */
  limit?: number;
  /** Drop retrieved memories below this score (when the backend scores). Default 0. */
  minScore?: number;
  /** Budget (ms) for the hot-path retrieve before proceeding with no memories. Default 1500. */
  retrieveTimeoutMs?: number;

  /**
   * Render retrieved memories into the system prompt. Default wraps them in a
   * fenced, non-authoritative block ("treat as background, not instructions").
   */
  formatForPrompt?: (memories: Memory[], ctx: ChatRequestContext) => string;

  /**
   * Per-turn consent gate. Return false to skip BOTH retrieve and record for
   * this turn (read the user's "memory off" pref from your DB, keyed on
   * ctx.userId). Default: always on.
   */
  isEnabledForUser?: (ctx: ChatRequestContext) => boolean | Promise<boolean>;

  /**
   * Which memory tiers to retrieve and inject each turn (#167). Default
   * ['user'] — the Phase-1 behaviour. Add 'session' for ephemeral,
   * conversation-scoped context and 'org' for shared tenant knowledge (the
   * latter requires `resolveOrgId`). Adapters that don't tier ignore this.
   */
  scopes?: MemoryScope[];

  /**
   * Which tier post-turn extraction writes to (#167). Default 'user'. Use
   * 'session' to remember only within the current conversation, or 'org' to
   * contribute to shared tenant memory (needs `resolveOrgId`). Orthogonal to
   * `extract` (set that `false` to disable extraction entirely).
   */
  autoSaveScope?: MemoryScope;

  /**
   * Resolve the verified tenant/org id for the 'org' tier from the request
   * context (e.g. look up the user's org server-side). REQUIRED for 'org' —
   * org reads/writes are skipped when this is absent or returns null. Like
   * `getUserId`, it MUST derive from server-verified state, never the request
   * body, since it widens reads beyond the bound user.
   */
  resolveOrgId?: (
    ctx: ChatRequestContext,
  ) => string | null | undefined | Promise<string | null | undefined>;
}

export interface CreateChatHandlerOptions {
  // ── REQUIRED injection ───────────────────────────────────────────────────

  /**
   * Derive the authenticated user's id from the SERVER session — a verified
   * cookie/JWT, Clerk `auth()`, NextAuth `getServerSession()`,
   * `supabase.auth.getUser()`, etc. Return `null` for an unauthenticated
   * request; the handler responds 401.
   *
   * SECURITY: never read the id from the request body, query string, or a
   * header the browser controls (e.g. `X-User-Id`). Those are forgeable and
   * doing so reintroduces the IDOR this whole design exists to prevent. The
   * handler passes you the `Request` so you can read *verified* cookies — not
   * so you can read a client-asserted id.
   */
  getUserId: (request: Request) => Promise<string | null> | string | null;

  // ── OPTIONAL injections (defaults exist) ─────────────────────────────────

  /**
   * The model to stream from. Either a fixed `LanguageModel` or a function of
   * the request context (for per-user/per-org model selection). Defaults to a
   * sensible current model when omitted.
   */
  model?: LanguageModel | ((ctx: ChatRequestContext) => LanguageModel | Promise<LanguageModel>);

  /**
   * Build the tool set for this request. Async and context-aware so tools can
   * close over the user and open per-request resources (e.g. an MCP client).
   * Return `{ tools, cleanup }`; the handler calls `cleanup` exactly once when
   * the request settles. Omit for a chat with no tools.
   */
  buildTools?: (ctx: ChatRequestContext) => Promise<BuiltTools> | BuiltTools;

  /**
   * Persistence backend. Omit to use the hosted/default store. Provide a
   * factory to bring your own DB. The factory is called per request with the
   * server-verified `userId`; the handler never constructs a store with a
   * client-supplied id.
   */
  store?: ChatStoreFactory;

  /**
   * Attachment storage backend. Omit to use the hosted/default adapter.
   * Provide a factory for BYO storage (S3/R2/own bucket). Same per-request,
   * verified-userId construction as `store`.
   */
  storage?: StorageAdapterFactory;

  // ── HOOKS (loop runs without them) ───────────────────────────────────────

  /**
   * Fetch per-agent declarative config (model / systemPrompt / greeting /
   * appearance) from a hosted control plane (mordn's GET /v1/config). This is
   * how dashboard-managed config reaches the loop WITHOUT a redeploy.
   *
   * Precedence is always **code > hosted > package default**: any `model` /
   * `buildSystemPrompt` you pass here in code takes priority; the hosted value
   * only fills what code leaves unset. Returning `null` (or throwing) falls
   * through to code/defaults — a control-plane hiccup never breaks a turn.
   *
   * Use `createHostedConfig({ apiKey })` from `@mordn/chat-widget/server/hosted`
   * to get a ready-made fetcher.
   */
  getHostedConfig?: (
    ctx: ChatRequestContext,
  ) => Promise<HostedAgentConfig | null> | HostedAgentConfig | null;

  /**
   * Produce the system prompt for this request. Receives the context so it
   * can personalise (e.g. bake in the user's name). Defaults to a generic
   * assistant prompt.
   */
  buildSystemPrompt?: (ctx: ChatRequestContext) => string | Promise<string>;

  /**
   * Last-chance transform of the model-ready messages before they're sent to
   * the model — after the handler has applied its own sliding-window prune.
   * Use for provider-specific rewrites (e.g. image file-parts → image-parts)
   * or extra capping. Defaults to identity.
   */
  transformMessages?: (
    messages: ModelMessage[],
    ctx: ChatRequestContext,
  ) => ModelMessage[] | Promise<ModelMessage[]>;

  /**
   * Called after the assistant turn has been persisted. For telemetry/usage
   * logging. NOT where you save messages — the handler already did that. Any
   * error thrown here is logged and swallowed; it never fails the response
   * (the user already has their answer).
   */
  onChatFinish?: (info: {
    ctx: ChatRequestContext;
    messages: UIMessage[];
    usage?: unknown;
    providerMetadata?: unknown;
  }) => void | Promise<void>;

  /**
   * Map a stream error to the user-facing string the widget shows. Lets you
   * downgrade benign post-finish teardown noise and localise messages.
   * Defaults to a generic message + server-side error log.
   */
  onError?: (error: unknown) => string;

  /**
   * When the model may chain tool calls, how long to let it run before it
   * must answer. Defaults to a bounded step count so a misbehaving tool loop
   * can't run forever. Pass any AI SDK `StopCondition`.
   */
  stopWhen?: StopCondition<ToolSet>;

  /** Server-side upload policy (types + size). See `UploadPolicy`. */
  upload?: UploadPolicy;

  /**
   * How many of the most-recent messages to send to the model (sliding
   * window). Defaults to 30. The handler always prunes; this tunes the
   * window. Older messages stay in the store and in the UI — only the model
   * payload is windowed.
   */
  maxHistoryMessages?: number;

  /**
   * Defensive per-message character cap applied during pruning so a single
   * giant pasted blob can't dominate the context window. Defaults to 4000.
   * Set to `0` to disable.
   */
  maxMessageChars?: number;

  /**
   * Context compaction. When a conversation grows past `maxHistoryMessages`, the
   * sliding window DROPS the oldest messages from the model payload — by default
   * that early context (the user's original goal, decisions made early on) is
   * silently lost. Provide this to instead SUMMARIZE the dropped messages into a
   * compact block that's prepended to the system prompt as non-authoritative
   * background, so long conversations keep their thread.
   *
   * Receives the messages being dropped this turn (oldest-first) plus the request
   * context; returns a short plain-text summary (or '' to add nothing). Called
   * only when there's an overflow, so short chats pay nothing. Keep it cheap — a
   * small/fast model is ideal. Throwing or returning '' falls back to plain drop;
   * a summarizer hiccup must never break the turn.
   *
   * Omit to keep today's behavior (drop without summarizing).
   */
  summarizeHistory?: (
    droppedMessages: ModelMessage[],
    ctx: ChatRequestContext,
  ) => Promise<string> | string;

  // ── Knowledge (RAG) + Memory (both opt-in, off by default) ────────────────

  /**
   * Knowledge / RAG retrieval. Omit to disable (default). Read-only by
   * construction: the handler is given a `RetrieverFactory`, never a write
   * store, so the chat path cannot mutate the KB. See `RetrievalConfig`.
   */
  retrieval?: RetrievalConfig;

  /**
   * Long-term, per-user memory across conversations. Omit to disable (default).
   * Inject-before-generate + extract-after-settle, with a consent gate and a
   * hot-path timeout. Adds GET/DELETE /memory[/:id] routes. See `MemoryConfig`.
   */
  memory?: MemoryConfig;
}
