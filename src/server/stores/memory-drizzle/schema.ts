/**
 * Drizzle schema for the default long-term memory adapter (Postgres).
 *
 * As with the chat/knowledge schemas, this is NOT the public contract — the
 * `MemoryAdapter` interface is. It's exported so consumers on the default path
 * can run `drizzle-kit` against it.
 *
 * pgvector is OPTIONAL here. If the `vector` extension + an embedding model are
 * present, the adapter stores and ANN-searches embeddings; if not, it degrades
 * to Postgres full-text search over `text`. The `embedding` column is therefore
 * NULLABLE — one column, one code-path choice at construction.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { vector, EMBED_DIM } from '../knowledge-drizzle/schema';

export const memories = pgTable(
  'chat_memories',
  {
    id: text('id').primaryKey(),
    /** Server-verified end-user id — the isolation boundary. */
    userId: text('user_id').notNull(),
    /** Agent namespace so multiple bots don't share a user's memory. */
    agentId: text('agent_id').notNull().default('default'),
    /** Semantic horizon (#167): 'session' | 'user' | 'org'. Phase-1 rows = 'user'. */
    scope: text('scope').notNull().default('user'),
    /** Tenant id for 'org'-tier memories (shared across users). NULL otherwise. */
    orgId: text('org_id'),
    /** The self-contained remembered statement. */
    text: text('text').notNull(),
    /** Coarse kind for filtering/UI (preference/fact/goal/context/instruction). */
    kind: text('kind').notNull().default('fact'),
    /** Embedding for semantic recall. NULL → keyword-only mode. */
    embedding: vector('embedding', EMBED_DIM),
    /** Content hash (sha256 of normalised text) for idempotent dedupe. */
    contentHash: text('content_hash').notNull(),
    /** Provenance + GDPR cascade: which conversation produced this. */
    sourceConversationId: text('source_conversation_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Optional retention TTL: hard-delete after this instant. NULL = keep. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Drives retrieval + list (WHERE user_id = ? AND agent_id = ?).
    index('chat_memories_user_agent_idx').on(t.userId, t.agentId),
    // Tier-aware retrieval/list for the bound user (#167).
    index('chat_memories_user_agent_scope_idx').on(t.userId, t.agentId, t.scope),
    // Shared 'org'-tier reads (WHERE org_id = ? AND agent_id = ? AND scope = 'org').
    index('chat_memories_org_idx').on(t.orgId, t.agentId, t.scope),
    // Dedupe keys (#167/#172). Two PARTIAL unique indexes so each tier dedupes
    // by its real owner:
    //   • non-org tiers (session/user) dedupe per WRITER → (user, agent, scope, hash).
    //   • org tier dedupes per TENANT → (org_id, agent, hash). Keying org rows by
    //     user_id would let the same shared fact accumulate one row per user and
    //     never converge; org_id is the owner of org-tier memory.
    uniqueIndex('chat_memories_dedupe_idx')
      .on(t.userId, t.agentId, t.scope, t.contentHash)
      .where(sql`${t.scope} <> 'org'`),
    uniqueIndex('chat_memories_org_dedupe_idx')
      .on(t.orgId, t.agentId, t.contentHash)
      .where(sql`${t.scope} = 'org'`),
    // ANN index (created only when pgvector is available; the migration guards
    // on the extension). Cosine distance.
  ],
);

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;
