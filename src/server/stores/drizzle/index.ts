/**
 * Default Drizzle/Postgres ChatStore — public entry.
 *
 * Imported via `@mordn/chat-widget/server/drizzle` so a BYO consumer who
 * passes their own `store` never pulls `postgres`/`drizzle-orm` into their
 * bundle. Consumers on the default path:
 *
 *   import { createDrizzleChatStore } from '@mordn/chat-widget/server/drizzle';
 *   createChatHandler({ store: createDrizzleChatStore(), ... });
 *
 * The schema is exported so `drizzle-kit` can generate/push migrations.
 */
import 'server-only';

export { createDrizzleChatStore } from './store';
export { getDrizzleDb, type DrizzleClientOptions, type DrizzleDb } from './client';
export * as schema from './schema';
export type {
  ConversationRow,
  NewConversationRow,
  MessageRow,
  NewMessageRow,
} from './schema';
