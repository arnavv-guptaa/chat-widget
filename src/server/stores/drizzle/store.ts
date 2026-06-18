/**
 * Default ChatStore implementation, on Postgres via Drizzle.
 *
 * This is the "hosted/default" persistence the widget ships with. It is just
 * one implementation of the `ChatStore` interface — the interface, not this
 * file, is the contract. Every method here upholds the interface's security
 * invariants:
 *
 *   • The store is bound to one `userId` (constructor arg from the verified
 *     server session). No method takes a userId.
 *   • Reads are implicitly scoped to that user. `getConversation` /
 *     `listMessages` return null/[] for rows the user doesn't own — never
 *     another user's data, and not distinguishable from "not found".
 *   • Mutations verify ownership and throw `ConversationOwnershipError` on a
 *     foreign row.
 *   • `saveTurn` is idempotent on message id and bumps `updatedAt`.
 */

import 'server-only';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { UIMessage } from 'ai';

import {
  ConversationOwnershipError,
  type ChatStore,
} from '../../chat-store';
import type {
  ListMessagesOptions,
  SaveTurnInput,
  StoredConversation,
  StoredMessage,
} from '../../types';
import { getDrizzleDb, type DrizzleClientOptions, type DrizzleDb } from './client';
import { conversations, messages, type MessageRow, type ConversationRow } from './schema';

const MAX_PAGE = 100;

/** Project the plain-text of a UIMessage's parts for the `text` column. */
function textFromParts(parts: UIMessage['parts']): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: 'text'; text: string } =>
      (p as { type?: string }).type === 'text' &&
      typeof (p as { text?: unknown }).text === 'string',
    )
    .map((p) => p.text)
    .join('')
    .trim();
}

function toStoredConversation(row: ConversationRow, messageCount?: number): StoredConversation {
  return {
    id: row.id,
    title: row.title,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount,
  };
}

function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.parts,
    text: row.text,
    model: row.model ?? undefined,
    createdAt: row.createdAt,
  };
}

class DrizzleChatStore implements ChatStore {
  constructor(
    public readonly userId: string,
    private readonly db: DrizzleDb,
  ) {}

  async listConversations(): Promise<StoredConversation[]> {
    const rows = await this.db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
        metadata: conversations.metadata,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${messages}
          WHERE ${messages.conversationId} = ${conversations.id}
        )`,
      })
      .from(conversations)
      .where(eq(conversations.userId, this.userId))
      .orderBy(desc(conversations.updatedAt));

    return rows.map((r) => toStoredConversation(r as ConversationRow, r.messageCount));
  }

  async getConversation(id: string): Promise<StoredConversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)))
      .limit(1);
    return rows.length ? toStoredConversation(rows[0]) : null;
  }

  async ensureConversation(id: string, init?: { title?: string }): Promise<StoredConversation> {
    // Look up WITHOUT the user filter so we can distinguish "doesn't exist"
    // (safe to create) from "exists but owned by someone else" (must reject).
    // Filtering by user here would make a forged foreign id look identical to
    // a brand-new id and we'd silently create a duplicate under this user.
    const existing = await this.db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (existing.length) {
      if (existing[0].userId !== this.userId) throw new ConversationOwnershipError(id);
      const full = await this.getConversation(id);
      // getConversation can't return null here (we just confirmed ownership),
      // but satisfy the type and guard against a race-delete.
      if (full) return full;
    }

    // Insert; tolerate a concurrent create of the same id (idempotent).
    await this.db
      .insert(conversations)
      .values({ id, userId: this.userId, title: init?.title ?? 'New Chat', metadata: {} })
      .onConflictDoNothing({ target: conversations.id });

    const created = await this.getConversation(id);
    if (created) return created;
    // If we still can't read it back, a concurrent transaction created it under
    // a different user between our check and insert — treat as ownership error.
    throw new ConversationOwnershipError(id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)));
  }

  async deleteConversation(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, this.userId)))
      .returning({ id: conversations.id });
    return deleted.length > 0;
  }

  async listMessages(conversationId: string, opts?: ListMessagesOptions): Promise<StoredMessage[]> {
    // Scope to the user FIRST: confirm ownership before reading messages, so a
    // foreign conversation id yields [] rather than someone else's messages.
    const owned = await this.getConversation(conversationId);
    if (!owned) return [];

    const limit = Math.min(Math.max(opts?.limit ?? MAX_PAGE, 1), MAX_PAGE);
    const where = opts?.before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, opts.before))
      : eq(messages.conversationId, conversationId);

    // Fetch newest-first for the limit, then reverse to chronological order so
    // the UI renders oldest → newest without holding the whole history.
    const rows = await this.db
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return rows.reverse().map(toStoredMessage);
  }

  async saveTurn(input: SaveTurnInput): Promise<void> {
    const { conversationId, messages: turnMessages, model } = input;

    // Defence in depth: verify ownership even though the router already called
    // ensureConversation. saveTurn must never trust its caller did so.
    const owned = await this.getConversation(conversationId);
    if (!owned) throw new ConversationOwnershipError(conversationId);

    if (turnMessages.length === 0) return;

    // Idempotent insert keyed on message id. The AI SDK delivers stable ids;
    // replays/retries re-deliver them. onConflictDoNothing makes re-saving a
    // seen message a no-op instead of a duplicate.
    const values = turnMessages.map((m) => ({
      id: m.id,
      conversationId,
      role: m.role as 'user' | 'assistant' | 'system',
      parts: m.parts,
      text: textFromParts(m.parts),
      model: m.role === 'assistant' ? model ?? null : null,
    }));

    await this.db.insert(messages).values(values).onConflictDoNothing({ target: messages.id });

    // Auto-title from the first user message while the title is still default.
    if (owned.title === 'New Chat') {
      const firstUserText = turnMessages
        .filter((m) => m.role === 'user')
        .map((m) => textFromParts(m.parts))
        .find((t) => t.length > 0);
      if (firstUserText) {
        await this.renameConversation(conversationId, firstUserText.slice(0, 100));
      }
    }

    // Bump updatedAt so the conversation surfaces at the top of the history list.
    await this.db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, this.userId)));
  }
}

/**
 * Create a `ChatStoreFactory` backed by the default Drizzle/Postgres store.
 *
 * Pass to `createChatHandler({ store: createDrizzleChatStore() })`. The
 * factory binds each store instance to the verified `userId` the handler
 * provides per request. The underlying connection pool is shared.
 */
export function createDrizzleChatStore(options?: DrizzleClientOptions) {
  const db = getDrizzleDb(options);
  return (userId: string): ChatStore => new DrizzleChatStore(userId, db);
}
