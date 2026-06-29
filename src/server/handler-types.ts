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
   *
   * Note: providing this does NOT silence the server-side error log. Stream
   * errors are logged by default (see `logErrors`) so a production failure
   * (bad key, rate limit, wrong URL) never disappears into empty logs — the
   * #1 documented streaming pitfall. This hook only controls the user-facing
   * copy; use `logErrors: false` to opt out of the log.
   */
  onError?: (error: unknown) => string;

  /**
   * Log stream errors to the server console by default. The AI SDK swallows
   * stream errors (to avoid crashing the server), which is exactly how broken
   * production deployments end up with silent, empty logs. We surface them by
   * default — independently of `onError`, which only maps the user-facing
   * message. Set `false` only if you forward errors elsewhere and want to
   * suppress the built-in console log.
   *
   * Default: `true`.
   */
  logErrors?: boolean;

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
}
