/**
 * Drizzle schema for the default Postgres + pgvector KnowledgeStore.
 *
 * As with the chat schema, this is NOT the public contract — the
 * `KnowledgeStore`/`Retriever` interfaces are. It's exported so consumers on the
 * default path can run `drizzle-kit` against it and so the shipped SQL migration
 * can reference it.
 *
 * Two tables:
 *   • knowledge_sources — one row per logical source, holding `contentHash` for
 *     cheap resync diffing (is this source unchanged? → one indexed lookup).
 *   • knowledge_chunks  — the vectors + a generated tsvector for hybrid lexical
 *     search.
 *
 * The `vector(1536)` column and the generated `tsv` column + their indexes are
 * created in the shipped SQL migration (drizzle-kit can't model pgvector or a
 * GENERATED tsvector column directly). The custom `vector` type below lets the
 * store SELECT/INSERT the column through Drizzle.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

/**
 * pgvector column type. Dimension is fixed at migration time and MUST match the
 * embedder. We serialise to the `'[1,2,3]'` text form pgvector accepts, and
 * parse the same form back.
 */
export const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      // pgvector returns e.g. "[0.1,0.2,...]"; tolerate already-parsed arrays.
      if (Array.isArray(value)) return value as unknown as number[];
      return value.slice(1, -1).split(',').map(Number);
    },
  })(name);

/**
 * Default embedding dimension (text-embedding-3-small). Override in a host
 * migration if you pick a different model — the column width is the source of
 * truth and must equal the embedder's `dimensions`.
 */
export const EMBED_DIM = 1536;

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    /** `<namespace>::<source>` — stable per (namespace, source). */
    id: text('id').primaryKey(),
    /** Isolation boundary (agent:… / tenant:… / user:…:…). */
    namespace: text('namespace').notNull(),
    /** Logical source: URL / file key / slug. */
    source: text('source').notNull(),
    /** Coarse type for the dashboard (url/sitemap/crawl/file/text). */
    type: text('type').notNull().default('text'),
    title: text('title').notNull().default(''),
    /** 'ready' | 'error' (extensible). */
    status: text('status').notNull().default('ready'),
    /** sha256 of the raw/cleaned source content → resync diff short-circuit. */
    contentHash: text('content_hash').notNull(),
    chunkCount: integer('chunk_count').notNull().default(0),
    error: text('error'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('knowledge_sources_ns_source_idx').on(t.namespace, t.source)],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    /** `<namespace>::<source>::<chunkIndex>`. */
    id: text('id').primaryKey(),
    namespace: text('namespace').notNull(),
    source: text('source').notNull(),
    title: text('title').notNull().default(''),
    chunkIndex: integer('chunk_index').notNull(),
    /** The chunk text (also the basis for the generated tsvector). */
    content: text('content').notNull(),
    embedding: vector('embedding', EMBED_DIM).notNull(),
    // `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`
    // is created in the SQL migration — not modelled here (Drizzle can't express
    // a generated tsvector column). Queries reference it via raw SQL.
    contentHash: text('content_hash').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('knowledge_chunks_unique_idx').on(t.namespace, t.source, t.chunkIndex),
    // The hot retrieval filter is WHERE namespace = ANY($1); keep it btree-indexed
    // so the ANN scan is over a small partition, not the whole table.
    index('knowledge_chunks_namespace_idx').on(t.namespace),
  ],
);

export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
export type NewKnowledgeSourceRow = typeof knowledgeSources.$inferInsert;
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunkRow = typeof knowledgeChunks.$inferInsert;
