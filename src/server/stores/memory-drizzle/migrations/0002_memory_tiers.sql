-- ============================================================================
-- chat-widget MEMORY store migration 0002 — multi-horizon tiers (#167/#172)
-- ============================================================================
--
-- WHAT THIS DOES
--   Adds semantic tiering to `chat_memories`: a `scope` column
--   ('session' | 'user' | 'org') and an `org_id` column for shared org-tier
--   memories. Phase-1 rows are all the 'user' tier (the column default), so
--   the column adds are backward-compatible.
--
-- DEDUPE KEYS (the important part)
--   The single all-tier unique index is replaced by TWO PARTIAL unique indexes
--   so each tier dedupes by its real owner:
--     • non-org tiers (session/user) → (user_id, agent_id, scope, content_hash)
--       WHERE scope <> 'org'   — one fact per WRITER.
--     • org tier                     → (org_id, agent_id, content_hash)
--       WHERE scope = 'org'    — one fact per TENANT. Keying org rows by
--       user_id (the writer) would let the same shared fact accumulate one row
--       per user and never converge across the org.
--
-- LOCK IMPACT  (!)
--   A non-concurrent CREATE/DROP UNIQUE INDEX takes an ACCESS EXCLUSIVE lock and
--   BLOCKS WRITES for the duration — unacceptable on a large `chat_memories`.
--   The index DDL below therefore uses CONCURRENTLY, which does NOT block writes.
--   CONCURRENTLY cannot run inside a transaction block, so the index statements
--   run STANDALONE (no BEGIN/COMMIT around them). Only the fast ADD COLUMNs are
--   wrapped in a transaction. Run this file with a client that does NOT force a
--   surrounding transaction (e.g. `psql -f`, not a single-txn migration runner).
--
--   NOTE: the org partial unique index assumes no pre-existing duplicate org
--   rows (true for a new tier). If a CONCURRENTLY build fails it leaves an
--   INVALID index — drop it and retry.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0002_memory_tiers.sql
-- ============================================================================

-- 1) Additive columns — fast, safe, transactional.
BEGIN;
ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user';
ALTER TABLE chat_memories ADD COLUMN IF NOT EXISTS org_id text;
COMMIT;

-- 2) Index changes — CONCURRENTLY, OUTSIDE any transaction (see LOCK IMPACT).

-- Replace the old all-tier dedupe key.
DROP INDEX CONCURRENTLY IF EXISTS chat_memories_dedupe_idx;

-- Non-org tiers (session/user): dedupe per writer.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS chat_memories_dedupe_idx
  ON chat_memories (user_id, agent_id, scope, content_hash)
  WHERE scope <> 'org';

-- Org tier: dedupe per tenant, so shared facts converge across all users.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS chat_memories_org_dedupe_idx
  ON chat_memories (org_id, agent_id, content_hash)
  WHERE scope = 'org';

-- Supporting (non-unique) indexes for tier-aware reads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_memories_user_agent_scope_idx
  ON chat_memories (user_id, agent_id, scope);
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_memories_org_idx
  ON chat_memories (org_id, agent_id, scope);
