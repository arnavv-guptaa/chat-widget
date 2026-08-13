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
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { generateId, type UIMessage } from 'ai';

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
    sequence: row.sequence,
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
        // Selected only to keep the row assignable to `ConversationRow` below.
        // `seq_counter` is NOT NULL, so it is a REQUIRED field of
        // `$inferSelect` — omit it and the `as ConversationRow` cast stops
        // being a narrowing (neither type would contain the other: the row
        // would lack `seqCounter`, `ConversationRow` lacks `messageCount`) and
        // tsc fails with TS2352. Any future NOT NULL column added to
        // `chat_conversations` has to be added here too.
        seqCounter: conversations.seqCounter,
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

    // Ceiling is MAX_PAGE + 1, not MAX_PAGE.
    //
    // The router asks for `limit + 1` to detect whether an older page exists
    // without paying for a second COUNT query. Clamping at exactly MAX_PAGE
    // silently ate that probe row at the maximum page size: a caller asking for
    // 100 got 101 clamped back to 100, `page.length > limit` was never true,
    // `hasMore` was always false, and the conversation appeared to end at
    // message 100 with no way to scroll further (#55).
    //
    // One row of headroom keeps the probe working while the ceiling still does
    // its real job — bounding what a hostile or careless caller can pull in a
    // single query.
    const limit = Math.min(Math.max(opts?.limit ?? MAX_PAGE, 1), MAX_PAGE + 1);
    const where = opts?.before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, opts.before))
      : eq(messages.conversationId, conversationId);

    // Fetch newest-first for the limit, then reverse to chronological order so
    // the UI renders oldest → newest without holding the whole history.
    //
    // Sorted by `(created_at, sequence)`, not `created_at` alone. `created_at`
    // comes from the database clock, so there is no skew between writers — but
    // there IS finite resolution, and two tabs answering the same conversation
    // can land inside the same tick. Ordering was then whatever the planner
    // happened to return, and a transcript could render with the reply above
    // the question. `sequence` is a strict per-conversation ordinal, so the
    // composite sort is total.
    //
    // The composite is deliberate rather than sorting on `sequence` alone:
    // rows backfilled by the migration and rows written before this change
    // both order correctly under `(created_at, sequence)`, so no cutover
    // window exists where old and new rows interleave wrongly.
    const rows = await this.db
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.createdAt), desc(messages.sequence))
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

    // Idempotent insert keyed on message id. The handler configures the AI SDK
    // to assign a stable id to every message (generateMessageId), and replays/
    // retries re-deliver the same id — so onConflictDoNothing dedupes safely.
    //
    // Defence in depth: if a message arrives without an id (empty string),
    // mint one rather than inserting it. Multiple id-less messages would
    // otherwise all collide on the '' primary key and silently vanish — the
    // exact bug an empty assistant id caused before generateMessageId was set.
    // ── Reserve a contiguous block of ordinals ────────────────────────────
    // One atomic statement: increment the conversation's counter by the number
    // of messages in this turn and read back the new value. Postgres holds a
    // row lock for the duration of the UPDATE, so concurrent turns on the same
    // conversation serialise here — each gets a disjoint block, and neither can
    // observe a stale counter the way a SELECT-then-UPDATE pair could.
    //
    // The returned value is the ordinal of the LAST message in the block, so
    // the block starts at `nextSequence - turnMessages.length + 1`.
    //
    // Ordinals are allocated even if the insert below dedupes some rows away.
    // Gaps in the sequence are harmless — it is an ordering key, not a count —
    // and burning an ordinal is far cheaper than reusing one.
    const [counter] = await this.db
      .update(conversations)
      .set({ seqCounter: sql`${conversations.seqCounter} + ${turnMessages.length}` })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, this.userId)))
      .returning({ seqCounter: conversations.seqCounter });
    const blockStart = (counter?.seqCounter ?? turnMessages.length) - turnMessages.length + 1;

    const values = turnMessages.map((m, i) => ({
      id: m.id && m.id.length > 0 ? m.id : generateId(),
      conversationId,
      role: m.role as 'user' | 'assistant' | 'system',
      parts: m.parts,
      text: textFromParts(m.parts),
      model: m.role === 'assistant' ? model ?? null : null,
      sequence: blockStart + i,
    }));

    // The PK is `id` alone, so onConflictDoNothing's dedup is GLOBAL, not
    // per-conversation. A same-conversation id collision (a retry/replay
    // re-delivering the same generateMessageId) is the intended idempotent
    // path — onConflictDoNothing is exactly right for that. But a CLIENT
    // -supplied user-message id can collide with a message id that already
    // exists in a DIFFERENT conversation; if that happens, onConflictDoNothing
    // would silently swallow the new message (data loss) and doubles as an
    // existence oracle (the client can probe whether an id exists elsewhere).
    // That's a client bug or a probe, not a replay — detect it and re-mint the
    // id so the message is still persisted, rather than trusting a
    // client-controlled PK across conversation boundaries.
    const incomingIds = values.map((v) => v.id);
    if (incomingIds.length > 0) {
      const existing = await this.db
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(inArray(messages.id, incomingIds));
      const foreignIds = new Set(
        existing.filter((row) => row.conversationId !== conversationId).map((row) => row.id),
      );
      for (const v of values) {
        if (foreignIds.has(v.id)) v.id = generateId();
      }
    }

    await this.db.insert(messages).values(values).onConflictDoNothing({ target: messages.id });

    // No prefix auto-title here (removed): the title stays 'New Chat' until the
    // handler's generated thread title lands via renameConversation. Keeping the
    // default is load-bearing — it is the handler's "still needs a title" signal,
    // so a failed generation retries naturally on the thread's next turn.

    // Bump updatedAt so the conversation surfaces at the top of the history
    // list. (Kept separate from the counter reservation above: that one must
    // happen BEFORE the insert to mint ordinals, this one must happen after so
    // it reflects a turn that actually landed.)
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
