/**
 * Drizzle schema for the default ChatStore (v2, parts-first).
 *
 * This is the schema the *default* store uses. A BYO store may use any schema
 * it likes — this one is not part of the public contract, the `ChatStore`
 * interface is. It's exported so consumers on the default path can run
 * `drizzle-kit` against it and so the migration can reference it.
 *
 * What changed from v0.7.1
 * ------------------------
 * The old schema stored a flattened `content: text` as the apparent source of
 * truth and tucked the real AI SDK `parts` into a `metadata` jsonb blob. That
 * inverted the actual authority — `parts` (text + reasoning + tool calls +
 * sources + files) is what the AI SDK round-trips and what rendering needs;
 * `content` was a lossy shadow.
 *
 * v2 makes that authority explicit:
 *   • `parts`  — jsonb NOT NULL — the canonical AI SDK message parts. Source
 *                of truth for rendering and model replay.
 *   • `text`   — text — a denormalised projection of the text parts, for
 *                cheap previews / titles / search. Never authoritative.
 *
 * A backfill migration populates these from the old columns so existing
 * installs upgrade without data loss (see migrations/).
 */

import { pgTable, text, timestamp, jsonb, index, integer } from 'drizzle-orm/pg-core';
import type { UIMessage } from 'ai';

export const conversations = pgTable(
  'chat_conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull().default('New Chat'),
    /** Free-form host-app metadata. Never read by the core. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /**
     * Monotonic per-conversation message counter.
     *
     * This is the allocator behind `chat_messages.sequence`. `saveTurn` reserves
     * a block of ordinals with a single atomic
     * `UPDATE … SET seq_counter = seq_counter + n RETURNING seq_counter`, which
     * takes a row lock for the duration of the statement — so two browser tabs
     * writing the same conversation at the same instant serialise here and can
     * never be handed the same ordinal. No advisory lock, no SELECT-then-UPDATE
     * race, no extra round trip.
     */
    seqCounter: integer('seq_counter').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Drives the history list (WHERE user_id = ? ORDER BY updated_at DESC).
    index('chat_conversations_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export const messages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<'user' | 'assistant' | 'system'>(),
    /** Canonical AI SDK parts — source of truth. */
    parts: jsonb('parts').$type<UIMessage['parts']>().notNull(),
    /** Denormalised plain-text projection for previews/search. */
    text: text('text').notNull().default(''),
    /** Model that produced this message (assistant turns). */
    model: text('model'),
    /**
     * Strict per-conversation ordinal, minted from `conversations.seq_counter`.
     *
     * `created_at` alone was the ordering key, which left message order at the
     * mercy of clock resolution: two tabs writing in the same millisecond could
     * render in either order, and nothing in the schema said which was right.
     * `sequence` is the tiebreak that makes the order a fact rather than a
     * coincidence.
     *
     * Ordering is `(created_at, sequence)`, not `sequence` alone — see
     * `listMessages`. Legacy rows backfilled by the migration keep a sequence
     * consistent with their existing `created_at` order, so the composite sort
     * is stable across the upgrade boundary.
     */
    sequence: integer('sequence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Drives history load (WHERE conversation_id = ? ORDER BY created_at, sequence).
    // Both sort columns are in the index so the ordered page is an index scan,
    // not a scan + sort.
    index('chat_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.sequence,
    ),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
