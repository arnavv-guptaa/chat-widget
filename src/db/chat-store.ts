import { generateId, UIMessage } from 'ai';
import { db, conversations, messages } from './index';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { ConversationOwnershipError } from '../server/chat-store';

/**
 * ⚠️ DEPRECATED LEGACY DATA LAYER ⚠️
 *
 * These standalone functions predate the user-bound `ChatStore` design and are
 * retained only for migration. They are exported via the `@mordn/chat-widget/db`
 * and `@mordn/chat-widget/api` subpaths.
 *
 * Historically several of them queried by raw `conversationId`/`chatId` with NO
 * `userId` and NO ownership check, which made the IDOR class of bug (cross-user
 * read/write/delete) representable — directly contradicting the headline
 * "IDOR is unrepresentable" guarantee. Every function below now REQUIRES a
 * verified `userId` (derived server-side from the session, never client input)
 * and scopes/validates ownership on every read, write, and delete, mirroring
 * {@link DrizzleChatStore} (src/server/stores/drizzle/store.ts).
 *
 * @deprecated Prefer the secure persistence path: build routes with
 * `createChatHandler` and the user-bound `DrizzleChatStore`
 * (`createDrizzleChatStore`) from `@mordn/chat-widget/server` /
 * `@mordn/chat-widget/server/drizzle`. The bound store cannot be made to cross
 * users because no method accepts a `userId`. These legacy functions will be
 * removed in a future release.
 */

/**
 * Create a new conversation owned by `userId`.
 *
 * @deprecated Use the user-bound `DrizzleChatStore.ensureConversation` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function createChat(userId: string): Promise<string> {
  if (!userId) {
    throw new Error('userId is required for createChat');
  }

  const id = generateId();

  await db.insert(conversations).values({
    id,
    userId,
    title: 'New Chat',
    metadata: {},
  });

  return id;
}

/**
 * Load messages for a conversation owned by `userId`.
 *
 * Ownership is asserted FIRST: a conversation id that does not exist OR belongs
 * to a different user yields `[]` — never another user's messages, and the two
 * cases are intentionally indistinguishable to the caller (mirrors
 * `DrizzleChatStore.listMessages`).
 *
 * @param userId Verified, server-derived id of the user that must own the
 *   conversation. Required — never pass a client-supplied value.
 * @param conversationId Conversation whose messages to load.
 * @deprecated Use the user-bound `DrizzleChatStore.listMessages` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function loadChat(
  userId: string,
  conversationId: string
): Promise<UIMessage[]> {
  if (!userId) {
    throw new Error('userId is required for loadChat');
  }

  try {
    // Scope to the user FIRST: confirm ownership before reading any messages,
    // so a foreign/forged conversationId yields [] rather than someone else's
    // history.
    const owned = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )
      .limit(1);

    if (!owned.length) return [];

    const dbMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    if (!dbMessages.length) return [];

    // Convert database messages to UIMessage format
    return dbMessages.map((msg) => {
      // If we have metadata with parts, use those (includes reasoning)
      const metadata = msg.metadata as { parts?: any[] } | null;
      if (metadata?.parts && Array.isArray(metadata.parts)) {
        return {
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          parts: metadata.parts,
          createdAt: msg.createdAt,
        };
      }

      // Fallback to simple text message
      return {
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        parts: [{ type: 'text', text: msg.content }],
        createdAt: msg.createdAt,
      };
    });
  } catch (error) {
    console.error('Error loading chat:', error);
    return [];
  }
}

/**
 * Update a conversation's title, scoped to its owner.
 *
 * The `WHERE` clause includes `userId`, so a foreign/forged `chatId` matches no
 * row and the update is a silent no-op (renaming is not security-sensitive;
 * mirrors `DrizzleChatStore.renameConversation`).
 *
 * @param userId Verified, server-derived owner id. Required.
 * @param chatId Conversation to rename.
 * @param title New title.
 * @deprecated Use the user-bound `DrizzleChatStore.renameConversation` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function updateConversationTitle(
  userId: string,
  chatId: string,
  title: string
): Promise<void> {
  if (!userId) {
    throw new Error('userId is required for updateConversationTitle');
  }

  try {
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(
        and(eq(conversations.id, chatId), eq(conversations.userId, userId))
      );
  } catch (error) {
    console.error('Error updating conversation title:', error);
  }
}

/**
 * Save messages to a conversation owned by `userId`.
 *
 * Ownership is VERIFIED before any mutation: the conversation must exist AND
 * belong to `userId`, otherwise a `ConversationOwnershipError` is thrown and
 * nothing is written (callers should map this to HTTP 403). This closes the
 * write-IDOR where the previous implementation only checked the conversation
 * existed, letting a caller inject messages into a victim's thread. Mirrors
 * `DrizzleChatStore.saveTurn`.
 *
 * @param userId Verified, server-derived owner id. Required.
 * @throws ConversationOwnershipError if the conversation exists under a
 *   different user (or cannot be confirmed owned).
 * @deprecated Use the user-bound `DrizzleChatStore.saveTurn` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function saveChat({
  chatId,
  messages: chatMessages,
  model,
  userId,
}: {
  chatId: string;
  messages: UIMessage[];
  model?: string;
  userId: string;
}): Promise<void> {
  if (!userId) {
    throw new Error('userId is required for saveChat');
  }

  try {
    // Verify the conversation exists AND is owned by this user. Scoping the
    // lookup by userId means a foreign/forged chatId returns no row, so we
    // refuse rather than writing into someone else's conversation.
    const existingConv = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(
        and(eq(conversations.id, chatId), eq(conversations.userId, userId))
      )
      .limit(1);

    if (!existingConv.length) {
      // Either the conversation doesn't exist or it's owned by another user.
      // Both must refuse the write; throw so the route returns 403 and never
      // mutates a foreign thread.
      throw new ConversationOwnershipError(chatId);
    }

    const conv = existingConv[0];

    // Update title if this is the first user message and title is still "New Chat"
    if (conv.title === 'New Chat') {
      const firstUserMessage = chatMessages.find((m) => m.role === 'user');
      if (firstUserMessage) {
        const textPart = firstUserMessage.parts?.find((p) => p.type === 'text') as { text: string } | undefined;
        if (textPart?.text) {
          const newTitle = textPart.text.slice(0, 100);
          await updateConversationTitle(userId, chatId, newTitle);
        }
      }
    }

    // Get existing message IDs from database
    const existingMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, chatId));

    const existingIds = new Set(existingMessages.map((m) => m.id));

    // Insert only new messages
    const newMessages = chatMessages.filter((msg) => !existingIds.has(msg.id));

    if (newMessages.length > 0) {
      for (const msg of newMessages) {
        const textPart = msg.parts?.find((p) => p.type === 'text') as { text: string } | undefined;
        const fileParts = msg.parts?.filter((p) => p.type === 'file') || [];

        // Generate ID for assistant messages, use existing ID for user messages
        const messageId = msg.role === 'assistant' ? generateId() : msg.id;

        await db.insert(messages).values({
          id: messageId,
          conversationId: chatId,
          role: msg.role,
          content: textPart?.text || '',
          files: fileParts,
          model: model || 'openai/gpt-4o-mini',
          metadata: { parts: msg.parts || [] },
        });
      }

      // Update conversation's updatedAt (scoped to owner)
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(
          and(eq(conversations.id, chatId), eq(conversations.userId, userId))
        );
    }
  } catch (error) {
    // Re-throw ownership violations so callers can return 403; the bare
    // function must never silently succeed on a foreign conversation.
    if (error instanceof ConversationOwnershipError) {
      throw error;
    }
    console.error('Error saving chat:', error);
  }
}

/**
 * Get all conversations for a user.
 *
 * Already scoped by `userId` in the original implementation; the parameter is
 * now explicitly required and validated. Trust only a server-derived `userId`.
 *
 * @param userId Verified, server-derived owner id. Required.
 * @deprecated Use the user-bound `DrizzleChatStore.listConversations` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function getConversations(userId: string) {
  if (!userId) {
    throw new Error('userId is required for getConversations');
  }

  try {
    const result = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        metadata: conversations.metadata,
        messageCount: sql<number>`(
          SELECT COUNT(*) FROM ${messages}
          WHERE ${messages.conversationId} = ${conversations.id}
        )`,
      })
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt));

    return result;
  } catch (error) {
    console.error('Error getting conversations:', error);
    return [];
  }
}

/**
 * Delete a conversation (and cascade its messages) owned by `userId`.
 *
 * The `DELETE` is scoped by `userId`, so a foreign/forged `chatId` matches no
 * row and nothing is deleted. Returns `true` only when a row owned by the user
 * was actually removed (mirrors `DrizzleChatStore.deleteConversation`), letting
 * the route distinguish 404 from 200 without a separate ownership check.
 *
 * @param userId Verified, server-derived owner id. Required.
 * @param chatId Conversation to delete.
 * @returns `true` if a conversation owned by `userId` was deleted, else `false`.
 * @deprecated Use the user-bound `DrizzleChatStore.deleteConversation` via
 * `createChatHandler` instead. See the module-level note above.
 */
export async function deleteConversation(
  userId: string,
  chatId: string
): Promise<boolean> {
  if (!userId) {
    throw new Error('userId is required for deleteConversation');
  }

  try {
    // Messages are deleted automatically due to cascade. Scoping the DELETE by
    // userId means a caller cannot destroy another user's conversation.
    const deleted = await db
      .delete(conversations)
      .where(
        and(eq(conversations.id, chatId), eq(conversations.userId, userId))
      )
      .returning({ id: conversations.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return false;
  }
}
