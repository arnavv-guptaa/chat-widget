/**
 * API Helpers for Chat Widget
 *
 * ⚠️ DEPRECATED LEGACY SURFACE ⚠️
 *
 * These utilities (exported as `@mordn/chat-widget/api`) re-export the legacy
 * standalone data layer from `../db/chat-store`. They predate the user-bound
 * `ChatStore` design and are kept only for migration.
 *
 * Every re-exported function now REQUIRES a verified `userId` and scopes/
 * validates ownership on every read, write, and delete (see the security notes
 * on each function in `../db/chat-store`). Even so, this surface puts ownership
 * enforcement back in the caller's hands — exactly the footgun the bound-store
 * design removes.
 *
 * @deprecated Build routes with `createChatHandler` and the user-bound
 * `DrizzleChatStore` (`createDrizzleChatStore`) from `@mordn/chat-widget/server`
 * / `@mordn/chat-widget/server/drizzle` instead. The bound store makes
 * cross-user access (IDOR) unrepresentable because no method accepts a
 * `userId`. This subpath will be removed in a future release.
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
