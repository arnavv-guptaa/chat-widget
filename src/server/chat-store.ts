/**
 * ChatStore — the persistence contract for chat conversations and messages.
 *
 * This is one of the two pluggable backends of the widget (the other is
 * `StorageAdapter` for attachments). The package ships a Drizzle/Postgres
 * implementation as the default; a hosted backend or a BYO store (Prisma,
 * raw SQL, DynamoDB, a test double) is simply another implementation of this
 * same interface.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The security model is in the shape of this API, not in its callers.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A `ChatStore` is *bound to one verified user* at construction time (see
 * `ChatStoreFactory`). None of its methods accept a `userId`. This is
 * deliberate and it is the core defence against the IDOR class of bug:
 *
 *   - You cannot ask the store for "conversation X belonging to user Y",
 *     because there is no parameter through which a foreign `userId` could
 *     enter. The only user the store will ever read or write is the one it
 *     was constructed with.
 *
 *   - Every method is therefore *implicitly scoped*. `listConversations()`
 *     returns only the bound user's conversations. `getConversation(id)`
 *     returns `null` — not someone else's row — when `id` exists but belongs
 *     to a different user. `saveTurn(...)` refuses (throws
 *     `ConversationOwnershipError`) if `conversationId` exists under another
 *     user.
 *
 * The route layer's job shrinks to: authenticate the request, derive the
 * real `userId` from the *server* session, construct a store bound to it,
 * and call methods. There is no per-route ownership check to forget, because
 * the store cannot be made to cross users.
 *
 * Implementations MUST uphold the contract documented on each method. The
 * Drizzle default does; if you write your own, these invariants are the
 * security boundary — treat them as load-bearing, not advisory.
 */

import type {
  ListMessagesOptions,
  SaveTurnInput,
  StoredConversation,
  StoredMessage,
} from './types';

/**
 * Thrown by mutating methods when the target conversation exists but is owned
 * by a different user than the one this store is bound to. Callers should map
 * this to an HTTP 403. (Read methods don't throw — they return `null`/`[]` —
 * so that probing for existence can't distinguish "not found" from
 * "forbidden", which would itself leak information.)
 */
export class ConversationOwnershipError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} is not owned by the current user`);
    this.name = 'ConversationOwnershipError';
  }
}

export interface ChatStore {
  /**
   * The user this store instance is bound to. Read-only; set at construction.
   * Exposed so the router can stamp it onto storage paths, logs, etc. — never
   * as something a caller can change.
   */
  readonly userId: string;

  // ── Conversations ──────────────────────────────────────────────────────

  /**
   * List the bound user's conversations, most-recently-updated first.
   * Returns `messageCount` on each row for the history list. Returns `[]`
   * (never throws) when the user has none.
   */
  listConversations(): Promise<StoredConversation[]>;

  /**
   * Fetch a single conversation by id, scoped to the bound user.
   *
   * Returns `null` when the conversation does not exist OR exists but belongs
   * to another user — the two cases are intentionally indistinguishable to
   * the caller (and thus to an attacker). Never returns another user's row.
   */
  getConversation(id: string): Promise<StoredConversation | null>;

  /**
   * Ensure a conversation row exists for `id`, owned by the bound user.
   *
   * - If no row exists for `id`: creates it, owned by the bound user, and
   *   returns it.
   * - If a row exists and is owned by the bound user: returns it unchanged
   *   (idempotent — safe to call at the top of every request).
   * - If a row exists but is owned by a *different* user: throws
   *   `ConversationOwnershipError` and writes nothing.
   *
   * This is the single chokepoint that makes "write into someone else's
   * conversation" impossible: the router calls it before persisting any
   * message, so a forged conversation id is rejected before any data lands.
   */
  ensureConversation(id: string, init?: { title?: string }): Promise<StoredConversation>;

  /**
   * Rename a conversation owned by the bound user. No-op (does not throw) if
   * the conversation doesn't exist or isn't owned by the user — renaming is
   * not security-sensitive and silent failure is friendlier here.
   */
  renameConversation(id: string, title: string): Promise<void>;

  /**
   * Delete a conversation (and cascade its messages + attachment rows) owned
   * by the bound user. No-op if it doesn't exist or isn't owned by the user.
   * Returns `true` if a row was actually deleted, `false` otherwise — lets
   * the route return 404 vs 200 honestly without a separate existence check.
   *
   * Note: this deletes message *rows*. Purging the underlying attachment
   * blobs from storage is the router's job (it has the `StorageAdapter`),
   * driven off the attachments this method returns having referenced.
   */
  deleteConversation(id: string): Promise<boolean>;

  // ── Messages ───────────────────────────────────────────────────────────

  /**
   * Load messages for a conversation, scoped to the bound user, newest-first
   * internally but returned in chronological order (oldest → newest) ready to
   * render. Returns `[]` if the conversation doesn't exist or isn't owned by
   * the user — same non-distinguishing contract as `getConversation`.
   *
   * Honours `ListMessagesOptions` for pagination. Implementations MUST clamp
   * `limit` to a ceiling (default ceiling: 100) so a hostile client can't
   * request an unbounded page.
   */
  listMessages(conversationId: string, opts?: ListMessagesOptions): Promise<StoredMessage[]>;

  /**
   * Persist the final messages of a completed turn.
   *
   * Contract:
   *  - MUST verify the conversation is owned by the bound user first; throws
   *    `ConversationOwnershipError` otherwise (defence in depth — the router
   *    already called `ensureConversation`, but `saveTurn` must not trust
   *    that).
   *  - MUST be idempotent on message id: a message whose id already exists is
   *    skipped, not duplicated. (The AI SDK delivers stable ids; replays and
   *    retries re-deliver them.)
   *  - MUST persist each message's full `parts` array as the source of truth,
   *    plus a denormalised text projection for previews.
   *  - MUST bump the conversation's `updatedAt`.
   *
   * Errors other than ownership (e.g. a transient DB failure) propagate so
   * the router can log them loudly — a silently-dropped assistant turn is
   * exactly the bug we're trying to design out.
   */
  saveTurn(input: SaveTurnInput): Promise<void>;
}

/**
 * Constructs a `ChatStore` bound to a specific, already-verified user.
 *
 * The router calls this *after* it has authenticated the request and derived
 * `userId` from the server session — never from anything client-supplied.
 * Passing a client-controlled value here would reintroduce the very IDOR the
 * bound-store design exists to prevent, so implementations should treat
 * `userId` as a trusted server secret, not as request input.
 *
 * Construction is intended to be cheap (the underlying DB pool/connection is
 * shared across instances) so a fresh store per request is the norm.
 */
export type ChatStoreFactory = (userId: string) => ChatStore;
