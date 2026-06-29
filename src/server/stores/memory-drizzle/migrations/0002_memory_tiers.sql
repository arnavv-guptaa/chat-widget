-- ============================================================================
-- chat-widget MEMORY store migration 0002 — multi-horizon tiers (#167)
-- ============================================================================
--
-- WHAT THIS DOES
--   Adds semantic tiering to `chat_memories`: a `scope` column
--   ('session' | 'user' | 'org') and an `org_id` column for shared org-tier
--   memories. Phase-1 rows are all treated as the 'user' tier (the column
--   default), so this is a backward-compatible, additive migration.
--
-- WHAT CHANGES
--   • `scope`  text NOT NULL DEFAULT 'user'  — the memory horizon.
--   • `org_id` text                          — tenant id for 'org'-tier rows.
--   • The dedupe unique index now includes `scope` so the same fact can exist
--     independently in different tiers (e.g. a session note vs a durable
--     preference) without colliding.
--   • New indexes for tier-aware reads (bound user) and shared org reads.
--
-- SAFETY
--   • Wrapped in a transaction; IF NOT EXISTS everywhere → re-running is a no-op.
--   • Additive only — no data is dropped; existing rows become 'user' tier.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0002_memory_tiers.sql
-- ============================================================================

BEGIN;

ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user';
ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS org_id text;

-- Replace the dedupe key so tiers don't collide: one fact per
-- (user, agent, scope, hash) instead of (user, agent, hash).
DROP INDEX IF EXISTS chat_memories_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS chat_memories_dedupe_idx
  ON chat_memories (user_id, agent_id, scope, content_hash);

-- Tier-aware retrieval/list for the bound user.
CREATE INDEX IF NOT EXISTS chat_memories_user_agent_scope_idx
  ON chat_memories (user_id, agent_id, scope);

-- Shared 'org'-tier reads (WHERE org_id = ? AND agent_id = ? AND scope = 'org').
CREATE INDEX IF NOT EXISTS chat_memories_org_idx
  ON chat_memories (org_id, agent_id, scope);

COMMIT;
