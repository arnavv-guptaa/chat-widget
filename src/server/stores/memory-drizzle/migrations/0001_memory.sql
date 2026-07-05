-- ============================================================================
-- chat-widget MEMORY store migration — per-user long-term memory
-- ============================================================================
--
-- WHAT THIS DOES
--   Creates the `chat_memories` table the default MemoryAdapter uses. pgvector
--   is OPTIONAL: the `embedding` column is nullable, and if the `vector`
--   extension is present we also build an ANN index for semantic recall. Without
--   pgvector / without an embedding model, the adapter degrades to Postgres
--   full-text search over `text` — still useful, zero extra infra.
--
-- DIMENSION
--   embedding is vector(1536) (text-embedding-3-small). Change the column + the
--   adapter's embedding model together if you swap models, then re-embed.
--
-- SAFETY
--   • Wrapped in a transaction; IF NOT EXISTS everywhere → re-running is a no-op.
--   • The pgvector column + ANN index are added only if the extension exists.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0001_memory.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS chat_memories (
  id                      text PRIMARY KEY,
  user_id                 text NOT NULL,
  agent_id                text NOT NULL DEFAULT 'default',
  text                    text NOT NULL,
  kind                    text NOT NULL DEFAULT 'fact',
  content_hash            text NOT NULL,
  source_conversation_id  text,
  metadata                jsonb,
  expires_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Drives retrieval + list (WHERE user_id = ? AND agent_id = ?).
CREATE INDEX IF NOT EXISTS chat_memories_user_agent_idx
  ON chat_memories (user_id, agent_id);

-- Idempotent upsert / dedupe key — one fact per (user, agent, hash).
CREATE UNIQUE INDEX IF NOT EXISTS chat_memories_dedupe_idx
  ON chat_memories (user_id, agent_id, content_hash);

-- Full-text fallback index (used when no embedding model is configured).
CREATE INDEX IF NOT EXISTS chat_memories_fts_idx
  ON chat_memories USING gin (to_tsvector('english', text));

-- ── Optional pgvector column + ANN index (added only if the extension exists) ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    -- Add the embedding column if pgvector is installed.
    BEGIN
      ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
    EXCEPTION WHEN others THEN
      -- column add may fail if the type isn't visible; ignore — keyword mode still works.
      NULL;
    END;

    -- HNSW ANN index for semantic recall (cosine).
    BEGIN
      CREATE INDEX IF NOT EXISTS chat_memories_embedding_hnsw
        ON chat_memories USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- If you enable pgvector AFTER running this migration:
--   CREATE EXTENSION IF NOT EXISTS vector;
--   ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
--   CREATE INDEX IF NOT EXISTS chat_memories_embedding_hnsw
--     ON chat_memories USING hnsw (embedding vector_cosine_ops);
-- then backfill embeddings by re-recording or a one-off embed sweep.
-- ============================================================================
