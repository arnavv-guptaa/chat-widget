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

import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import type { UIMessage } from 'ai';

export const conversations = pgTable(
  'chat_conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull().default('New Chat'),
    /** Free-form host-app metadata. Never read by the core. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Drives history load (WHERE conversation_id = ? ORDER BY created_at).
    index('chat_messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  ],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
