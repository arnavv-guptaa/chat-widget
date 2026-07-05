/**
 * Default Postgres + pgvector KnowledgeStore — public entry.
 *
 * Imported via `@mordn/chat-widget/server/knowledge/drizzle` so a BYO consumer
 * who passes their own retriever never pulls `postgres`/`drizzle-orm` into their
 * bundle. Two factories, split by trust:
 *
 *   // READ-ONLY — wire into the chat handler:
 *   import { createKnowledgeDrizzleRetriever } from '@mordn/chat-widget/server/knowledge/drizzle';
 *   createChatHandler({ retrieval: { store: createKnowledgeDrizzleRetriever({ embedder }), ... } });
 *
 *   // READ+WRITE — admin/ingestion ONLY (never given to the handler):
 *   import { createKnowledgeDrizzleStore } from '@mordn/chat-widget/server/knowledge/drizzle';
 *   const store = createKnowledgeDrizzleStore({ embedder })(`agent:${agentId}`);
 *
 * The schema is exported so `drizzle-kit` can generate base migrations; the
 * shipped 0001_knowledge.sql adds the pgvector column, the generated tsvector,
 * and the HNSW/GIN indexes (which drizzle-kit can't model).
 */
import 'server-only';

export {
  createKnowledgeDrizzleRetriever,
  createKnowledgeDrizzleStore,
  type PgVectorKnowledgeOptions,
} from './store';
export { getDrizzleDb, type DrizzleClientOptions, type DrizzleDb } from '../drizzle/client';
export * as schema from './schema';
export { EMBED_DIM, vector } from './schema';
export type {
  KnowledgeSourceRow,
  NewKnowledgeSourceRow,
  KnowledgeChunkRow,
  NewKnowledgeChunkRow,
} from './schema';
