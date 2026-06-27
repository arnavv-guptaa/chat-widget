-- ============================================================================
-- chat-widget KNOWLEDGE (RAG) store migration — pgvector + hybrid lexical
-- ============================================================================
--
-- WHAT THIS DOES
--   Creates the two tables the default KnowledgeStore uses
--   (`knowledge_sources`, `knowledge_chunks`), enables the `vector` extension,
--   adds the GENERATED tsvector column for hybrid lexical search, and builds the
--   ANN (HNSW) + GIN + btree indexes. drizzle-kit can model the base columns but
--   NOT the `vector(1536)` column, the GENERATED tsvector column, or the pgvector
--   index — so those live here in raw SQL.
--
-- DIMENSION
--   The embedding column is vector(1536) (text-embedding-3-small). If you swap to
--   a model with a different dimension, change BOTH this column and the schema's
--   EMBED_DIM, then re-embed (a model swap is an operational event, not a toggle).
--
-- SAFETY
--   • Wrapped in a transaction.
--   • IF NOT EXISTS everywhere → re-running is a no-op.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0001_knowledge.sql
--   (or pipe it through your migration runner; run AFTER drizzle-kit push, or
--    standalone — it creates the tables itself.)
-- ============================================================================

BEGIN;

-- pgvector. On Supabase, enable "vector" in the dashboard or via this statement
-- (the service role can create extensions).
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Sources: one row per logical source (URL / file key / slug) ──────────────
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id            text PRIMARY KEY,                 -- <namespace>::<source>
  namespace     text NOT NULL,
  source        text NOT NULL,
  type          text NOT NULL DEFAULT 'text',
  title         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'ready',
  content_hash  text NOT NULL,                    -- sha256 of raw content → resync diff
  chunk_count   integer NOT NULL DEFAULT 0,
  error         text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_ns_source_idx
  ON knowledge_sources (namespace, source);

-- ── Chunks: the vectors + generated tsvector ─────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            text PRIMARY KEY,                 -- <namespace>::<source>::<chunkIndex>
  namespace     text NOT NULL,
  source        text NOT NULL,
  title         text NOT NULL DEFAULT '',
  chunk_index   integer NOT NULL,
  content       text NOT NULL,
  embedding     vector(1536) NOT NULL,
  content_hash  text NOT NULL,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Hybrid lexical column + GIN index. Generated from `content` so it stays in sync.
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx
  ON knowledge_chunks USING gin (tsv);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_unique_idx
  ON knowledge_chunks (namespace, source, chunk_index);

-- The hot retrieval filter is WHERE namespace IN (...); keep it btree-indexed so
-- the ANN scan is over a small partition, not the whole table.
CREATE INDEX IF NOT EXISTS knowledge_chunks_namespace_idx
  ON knowledge_chunks (namespace);

-- ANN index. HNSW: best recall/latency, no training step. cosine ops to match
-- normalised embeddings.
--   Alternative for huge low-write corpora:
--     CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);
--     ANALYZE knowledge_chunks;   -- then tune `lists` to row count
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;
