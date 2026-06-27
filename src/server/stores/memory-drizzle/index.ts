/**
 * Default Drizzle/Postgres memory adapter — public entry.
 *
 *   import { createDrizzleMemory } from '@mordn/chat-widget/server/memory/drizzle';
 *   import { openai } from '@ai-sdk/openai';
 *   createChatHandler({
 *     memory: {
 *       adapter: createDrizzleMemory({
 *         agentId: 'support-bot',
 *         embeddingModel: openai.embedding('text-embedding-3-small'), // omit → keyword mode
 *         extractionModel: openai('gpt-4o-mini'),                     // omit → heuristic mode
 *         retentionDays: 365,                                         // omit → keep forever
 *       }),
 *     },
 *   });
 *
 * The schema is exported so `drizzle-kit` can generate base migrations; the
 * shipped 0001_memory.sql adds the optional pgvector column + ANN index.
 */
import 'server-only';

export { createDrizzleMemory, type DrizzleMemoryOptions } from './adapter';
export * as schema from './schema';
export type { MemoryRow, NewMemoryRow } from './schema';
