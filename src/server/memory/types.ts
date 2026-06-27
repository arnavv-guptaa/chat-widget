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
}

/** Options for the hot-path retrieve (before generation). */
export interface RetrieveOptions {
  /** Query to rank against — almost always the latest user message text. */
  query: string;
  /** Max memories to return. Adapters clamp to a ceiling (default 8). */
  limit?: number;
  /** Drop memories below this relevance (when the backend scores). Default 0. */
  minScore?: number;
}

/** Input for post-turn extraction. */
export interface RecordOptions {
  /** Final messages of the just-completed turn (UI messages with parts). */
  messages: unknown[];
  /** The conversation these came from — stamped for provenance / cascade. */
  conversationId: string;
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

  /** List the bound user's stored memories (transparency UI). Newest-first, unscored. */
  list(): Promise<Memory[]>;

  /** Delete one memory by id, scoped to the bound user. No-op if not theirs. */
  forget(id: string): Promise<void>;

  /** Delete ALL of the bound user's memories (GDPR erasure). Idempotent. */
  forgetAll(): Promise<void>;
}

/**
 * Constructs a `MemoryAdapter` bound to a specific, already-verified user —
 * same trust rules as `ChatStoreFactory`. `userId` must come from the SERVER
 * session (the handler's `getUserId`), never request input. Construction is
 * cheap (DB pool / HTTP client shared), so a fresh adapter per request is normal.
 */
export type MemoryAdapterFactory = (userId: string) => MemoryAdapter;
