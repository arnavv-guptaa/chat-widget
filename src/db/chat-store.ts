import { generateId, UIMessage } from 'ai';
import { db, conversations, messages } from './index';
import { eq, desc, asc, sql } from 'drizzle-orm';

/**
 * Create a new conversation
 */
export async function createChat(userId: string): Promise<string> {
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
 * Load messages for a conversation
 */
export async function loadChat(conversationId: string): Promise<UIMessage[]> {
  try {
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
 * Update conversation title
 */
export async function updateConversationTitle(
  chatId: string,
  title: string
): Promise<void> {
  try {
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, chatId));
  } catch (error) {
    console.error('Error updating conversation title:', error);
  }
}

/**
 * Save messages to a conversation
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
    console.error('userId is required for saveChat');
    return;
  }

  try {
    // Verify conversation exists
    const existingConv = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, chatId))
      .limit(1);

    if (!existingConv.length) {
      console.error('Conversation not found:', chatId);
      return;
    }

    const conv = existingConv[0];

    // Update title if this is the first user message and title is still "New Chat"
    if (conv.title === 'New Chat') {
      const firstUserMessage = chatMessages.find((m) => m.role === 'user');
      if (firstUserMessage) {
        const textPart = firstUserMessage.parts?.find((p) => p.type === 'text') as { text: string } | undefined;
        if (textPart?.text) {
          const newTitle = textPart.text.slice(0, 100);
          await updateConversationTitle(chatId, newTitle);
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

      // Update conversation's updatedAt
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, chatId));
    }
  } catch (error) {
    console.error('Error saving chat:', error);
  }
}

/**
 * Get all conversations for a user
 */
export async function getConversations(userId: string) {
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
 * Delete a conversation and all its messages
 */
export async function deleteConversation(chatId: string): Promise<void> {
  try {
    // Messages are deleted automatically due to cascade
    await db.delete(conversations).where(eq(conversations.id, chatId));
  } catch (error) {
    console.error('Error deleting conversation:', error);
  }
}
