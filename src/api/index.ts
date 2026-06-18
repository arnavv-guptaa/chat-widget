/**
 * API Helpers for Chat Widget
 *
 * These utilities help you create the required API routes for the chat widget.
 * Copy the route examples to your Next.js app/api folder.
 */

export {
  createChat,
  loadChat,
  saveChat,
  getConversations,
  updateConversationTitle,
  deleteConversation
} from '../db/chat-store';

export { db, conversations, messages } from '../db';
export type { Conversation, Message, NewConversation, NewMessage } from '../db/schema';

// Re-export drizzle utilities for convenience
export { eq, and, or, desc, asc, sql } from 'drizzle-orm';
