/**
 * MemoryAdapter — the long-term, per-end-user memory contract.
 *
 * The widget's THIRD-and-a-half pluggable backend (beside `ChatStore`,
 * `StorageAdapter`, and the knowledge `Retriever`). It owns *cross-conversation,
 * per-user* recall: the evolving facts an agent remembers about ONE user across
 * all their chats. It is NOT the sliding window (short-term), NOT `ChatStore`
 * (conversation-local), and NOT knowledge/RAG (developer-curated, shared).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The security model is in the SHAPE of this API, not its callers.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A `MemoryAdapter` is bound to one verified `userId` at construction (see
 * `MemoryAdapterFactory`). None of its methods accept a `userId`. As with
 * `ChatStore`, this is the core defence against IDOR: you cannot ask the adapter
 * for "user Y's memories" while acting as user X, because there is no parameter
 * through which a foreign id can enter. `retrieve`/`list` return only the bound
 * user's memories; `forget`/`forgetAll`/`record` can only touch their namespace.
 *
 * These invariants are the security boundary — load-bearing, not advisory. The
 * Postgres default upholds them; a BYO adapter (mem0/hosted/your own) must too.
 */

import 'server-only';

/**
 * Semantic memory horizon (#167). Phase 1 was a flat store (everything 'user');
 * tiers separate short-lived session context, medium-lived per-user
 * preferences, and long-lived org/tenant knowledge.
 *
 * - 'session' — one conversation; ephemeral working context ("debugging a
 *   payments bug"). Scoped to (user, conversation).
 * - 'user'    — across a user's sessions; durable preferences / role. The
 *   Phase-1 default, so existing rows and callers keep working unchanged.
 * - 'org'     — shared across all users in a tenant; team conventions / stack.
 *   Requires a server-verified `orgId`.
 */
export type MemoryScope = 'session' | 'user' | 'org';

/** Options for listing stored memories (transparency UI). */
export interface ListOptions {
  /** Restrict to one or more tiers. Default: every tier the bound user owns. */
  scope?: MemoryScope | MemoryScope[];
  /** Verified tenant/org id — required to include 'org'-tier memories. */
  orgId?: string;
}

/** A single durable memory about the bound user. */
export interface Memory {
  /** Opaque, stable id. Used for `forget(id)` and user-facing controls. */
  id: string;
  /**
   * The remembered statement, as a self-contained natural-language fact —
   * "Prefers TypeScript over JavaScript", "Migrating off Firebase to Supabase".
   * Self-contained so it reads correctly with zero surrounding context when
   * injected into a future prompt.
   */
  text: string;
  /**
   * Relevance/confidence in [0,1] when the backend scores (semantic distance for
   * the Postgres default, the provider's score for mem0/hosted). Omitted by `list`.
   */
  score?: number;
  /** ISO creation timestamp. */
  createdAt: string;
  /** Free-form metadata (kind, source conversation id, model, …). */
  metadata?: Record<string, unknown>;
  /** Semantic horizon this memory belongs to (#167). Defaults to 'user'. */
  scope?: MemoryScope;
}

/** Options for the hot-path retrieve (before generation). */
export interface RetrieveOptions {
  /** Query to rank against — almost always the latest user message text. */
  query: string;
  /** Max memories to return. Adapters clamp to a ceiling (default 8). */
  limit?: number;
  /** Drop memories below this relevance (when the backend scores). Default 0. */
  minScore?: number;
  /**
   * Which tiers to search (#167). Default ['user'] — Phase-1 behaviour. Include
   * 'session' (needs `conversationId`) and/or 'org' (needs `orgId`) to recall
   * across horizons. An adapter that doesn't tier may ignore this.
   */
  scopes?: MemoryScope[];
  /** Current conversation — required to scope 'session'-tier recall. */
  conversationId?: string;
  /** Verified tenant/org id — required to recall 'org'-tier memories. */
  orgId?: string;
}

/** Input for post-turn extraction. */
export interface RecordOptions {
  /** Final messages of the just-completed turn (UI messages with parts). */
  messages: unknown[];
  /** The conversation these came from — stamped for provenance / cascade. */
  conversationId: string;
  /**
   * Tier to persist extracted facts under (#167). Default 'user' — Phase-1
   * behaviour. 'session' stamps the conversation; 'org' requires `orgId`.
   */
  scope?: MemoryScope;
  /** Verified tenant/org id — required when `scope` is 'org'. */
  orgId?: string;
}

export interface MemoryAdapter {
  /** The bound user. Read-only; set at construction. Never a caller-changeable param. */
  readonly userId: string;

  /**
   * Retrieve the bound user's most relevant memories for this turn. Runs on the
   * critical path before generation, so it MUST be fast and fail soft — return
   * `[]` (never throw) on error/timeout so a memory hiccup never blocks a reply.
   */
  retrieve(opts: RetrieveOptions): Promise<Memory[]>;

  /**
   * Extract durable facts from a completed turn and persist them for the bound
   * user, deduping/superseding existing memories. Fire-and-forget from the
   * handler's perspective (invoked post-stream). Idempotent — re-recording the
   * same turn must not create duplicates.
   */
  record(opts: RecordOptions): Promise<void>;

  /**
   * List the bound user's stored memories (transparency UI). Newest-first,
   * unscored. Pass `opts.scope` to filter by tier (#167); omit for every tier
   * the bound user owns. Backward compatible — `list()` still works.
   */
  list(opts?: ListOptions): Promise<Memory[]>;

  /** Delete one memory by id, scoped to the bound user. No-op if not theirs. */
  forget(id: string): Promise<void>;

  /**
   * Delete the bound user's memories (GDPR erasure). Idempotent. Pass
   * `opts.scope` to erase a single tier; omit to erase all of the user's own
   * memories. Never bulk-deletes shared 'org' memories created by others.
   */
  forgetAll(opts?: { scope?: MemoryScope }): Promise<void>;
}

/**
 * Constructs a `MemoryAdapter` bound to a specific, already-verified user —
 * same trust rules as `ChatStoreFactory`. `userId` must come from the SERVER
 * session (the handler's `getUserId`), never request input. Construction is
 * cheap (DB pool / HTTP client shared), so a fresh adapter per request is normal.
 */
export type MemoryAdapterFactory = (userId: string) => MemoryAdapter;
