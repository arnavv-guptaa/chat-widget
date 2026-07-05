/**
 * Server-core domain types.
 *
 * This is the shared vocabulary for the server side of the widget — the
 * persistence interfaces (`ChatStore`, `StorageAdapter`), the request
 * router, and the lifecycle hooks all speak in these types.
 *
 * Design notes
 * ------------
 * 1. These types are deliberately decoupled from any specific database or
 *    ORM. `ChatStore` is an interface; the Drizzle/Postgres implementation
 *    that ships as the default is just *one* implementation of it. A hosted
 *    backend, a Prisma store, or an in-memory test double are equally valid.
 *
 * 2. Messages are stored as AI SDK `UIMessage`s — specifically their `parts`
 *    array — not as a flattened `content` string. The `parts` array is the
 *    canonical representation the AI SDK round-trips (text, reasoning, tool
 *    calls, sources, files). Storing anything less loses information on
 *    rehydration. We keep a denormalised `text` alongside it purely for
 *    cheap previews / titles / search — never as the source of truth.
 *
 * 3. Identity (`userId`) never appears as a *parameter* on read/write
 *    methods. A `ChatStore` is constructed already bound to one verified
 *    user (see `ChatStoreFactory`). This makes cross-user access
 *    unrepresentable at the type level — you cannot ask a store for another
 *    user's data because no method accepts a foreign id. That is the
 *    security property, encoded in the shape of the API rather than left to
 *    each caller's discipline.
 */

import type { UIMessage } from 'ai';

/**
 * A single attachment as persisted on a message part.
 *
 * The `url` is a *freshly signed, short-lived* URL when this object is
 * handed to the client — never a permanent public link. `storagePath` is
 * the durable pointer the `StorageAdapter` uses to re-sign on demand when an
 * old conversation is reloaded. Only `storagePath` is guaranteed stable
 * across reads; treat `url` as ephemeral.
 */
export interface StoredAttachment {
  /** Durable, opaque pointer into the storage backend. Stable across reads. */
  storagePath: string;
  /** Freshly-signed, expiring URL for the client to fetch. Ephemeral. */
  url: string;
  /** Original filename as uploaded (for display + download). */
  filename: string;
  /** MIME type (e.g. `image/png`, `application/pdf`). */
  mediaType: string;
  /** Size in bytes. */
  size: number;
}

/**
 * A conversation row, as the store returns it. Summary-level — does not
 * include messages. Use `listConversations` for the sidebar/history list and
 * `getConversation` + `listMessages` to open one.
 */
export interface StoredConversation {
  id: string;
  /**
   * Human-readable title. Defaults to "New Chat" until the first user
   * message lands, at which point the router auto-titles from it. Consumers
   * can override via `renameConversation`.
   */
  title: string;
  /** Free-form metadata bag the host app may stamp (never read by the core). */
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Number of messages in the conversation. Populated by `listConversations`
   * for the history list; may be omitted (`undefined`) by single-row reads
   * where the count isn't needed.
   */
  messageCount?: number;
}

/**
 * A message row, as the store returns it.
 *
 * `parts` is the canonical AI SDK representation and the source of truth for
 * rendering. `text` is a denormalised convenience for previews/search and
 * may be empty for messages whose content is entirely non-text (e.g. a
 * tool-only assistant turn).
 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Canonical AI SDK parts. Source of truth for rendering + model replay. */
  parts: UIMessage['parts'];
  /** Denormalised plain text for previews/titles/search. Not authoritative. */
  text: string;
  /** Which model produced this message, when known (assistant turns). */
  model?: string;
  createdAt: Date;
}

/**
 * Pagination request for message history. The store returns the most-recent
 * `limit` messages so a freshly-opened conversation shows the latest turns;
 * `before` lets the client page backwards into older history.
 */
export interface ListMessagesOptions {
  /** Max messages to return. The store clamps this to a sane ceiling. */
  limit?: number;
  /**
   * Return only messages created strictly before this instant. Used for
   * "load older messages" infinite-scroll. Omit for the most-recent page.
   */
  before?: Date;
}

/**
 * What `saveTurn` persists at the end of a streamed response: the final,
 * complete set of UI messages for the turn (user message + assistant
 * message, including any tool/reasoning/source parts the SDK emitted).
 *
 * The store is responsible for idempotency — re-saving messages whose ids
 * already exist must be a no-op, never a duplicate. (Replays, retries, and
 * the AI SDK's own resumability all deliver already-seen ids.)
 */
/**
 * Token usage + dollar cost for one assistant turn, normalised from streamText's
 * `onFinish` (`usage`/`totalUsage` + `providerMetadata.gateway`). The Vercel AI
 * Gateway PRE-COMPUTES the cost, so we record it verbatim — no price table. All
 * money fields are decimal STRINGS (e.g. "0.000114") to avoid float drift; the
 * store persists them as exact `numeric`. Every field is optional because a
 * provider may not return it (only the gateway gives cost); a turn with no
 * usable usage simply isn't recorded.
 */
export interface UsageRecord {
  /** Assistant message id this turn produced (links the usage row to the message). */
  messageId?: string;
  model?: string;
  /** gateway.routing.resolvedProvider — who actually served it (vs requested). */
  resolvedProvider?: string;
  finishReason?: string;
  /** Number of LLM round-trips in the turn (steps.length). */
  stepCount?: number;

  // Tokens (from totalUsage — the whole turn, summed across tool steps).
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;

  // Cost in USD — decimal strings from the gateway (exact money, never float).
  costUsd?: string;
  inputCostUsd?: string;
  outputCostUsd?: string;
  marketCostUsd?: string;
  surchargeUsd?: string;

  latencyMs?: number;
  /** gateway.generationId — unique per generation; the store's idempotency key. */
  generationId?: string;

  /** The full provider metadata, verbatim, so nothing is lost. */
  raw?: Record<string, unknown>;
}

export interface SaveTurnInput {
  conversationId: string;
  messages: UIMessage[];
  /** Model that produced the assistant message(s) in this turn. */
  model?: string;
  /**
   * Optional token-usage + cost for this turn (normalised from the gateway's
   * onFinish). Stores that support usage analytics persist it; others ignore it.
   * Never load-bearing for chat correctness — a missing/failed usage record must
   * not affect message persistence.
   */
  usage?: UsageRecord;
}
