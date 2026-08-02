-- ============================================================================
-- chat-widget store migration: add strict per-conversation message ordering
-- ============================================================================
--
-- WHAT THIS DOES
--   `chat_messages` was ordered by `created_at` alone. That column comes from
--   the database clock, so there is no skew between writers — but there IS
--   finite resolution, and two browser tabs answering the same conversation can
--   land inside the same tick. Order was then whatever the planner happened to
--   return: a transcript could render the reply above the question, and nothing
--   in the schema said which was right.
--
--   This migration adds:
--     • chat_conversations.seq_counter  — a monotonic per-conversation
--                                         allocator, incremented atomically by
--                                         saveTurn to reserve ordinals
--     • chat_messages.sequence          — the ordinal itself, the tiebreak that
--                                         makes ordering a fact
--     • an index on (conversation_id, created_at, sequence) so the ordered page
--       is an index scan rather than a scan + sort
--
--   Existing rows are backfilled in their current `created_at` order, so the
--   composite sort `(created_at, sequence)` is stable across the upgrade
--   boundary and no cutover window exists where old and new rows interleave
--   wrongly.
--
-- SAFETY
--   • Wrapped in a transaction — all-or-nothing.
--   • `ADD COLUMN IF NOT EXISTS` with a NOT NULL DEFAULT 0, so re-running is a
--     no-op and no row is ever left null. On PG 11+ a NOT NULL DEFAULT is a
--     metadata-only rewrite, so this does not rewrite the table.
--   • Purely additive: no column is dropped, renamed, or retyped. A previous
--     version of the widget keeps working against this schema, so the
--     migration can be applied BEFORE the deploy (the recommended order).
--   • The backfill is deterministic and idempotent — re-running recomputes the
--     same ordinals, because it derives them from `created_at, id` rather than
--     from the current counter.
--
-- ORDER OF OPERATIONS
--   Apply this migration FIRST, then deploy the new widget. The old code
--   ignores the new columns; the new code requires them.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0002_message_sequencing.sql
--   (or pipe it through your migration runner)
-- ============================================================================

BEGIN;

-- ── Columns ─────────────────────────────────────────────────────────────────

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS seq_counter integer NOT NULL DEFAULT 0;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;

-- ── Backfill existing rows ──────────────────────────────────────────────────
-- Number each conversation's messages 1..n in their current visible order.
-- `id` is the tiebreak so the result is deterministic even where `created_at`
-- already collides — which is precisely the bug being fixed, and those rows do
-- exist in production data. Deterministic means re-running this migration
-- produces identical ordinals rather than reshuffling history.

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id
      ORDER BY created_at, id
    ) AS ordinal
  FROM chat_messages
)
UPDATE chat_messages m
SET sequence = ordered.ordinal
FROM ordered
WHERE m.id = ordered.id
  -- Only touch rows still at the default. Re-running after real traffic has
  -- landed must not renumber messages that saveTurn already sequenced.
  AND m.sequence = 0;

-- ── Advance each conversation's allocator past the backfilled rows ──────────
-- Without this the counter sits at 0 and the next real turn would mint
-- ordinal 1, colliding with the oldest backfilled message and sorting a brand
-- new reply to the top of the thread.

UPDATE chat_conversations c
SET seq_counter = GREATEST(c.seq_counter, sub.max_sequence)
FROM (
  SELECT conversation_id, MAX(sequence) AS max_sequence
  FROM chat_messages
  GROUP BY conversation_id
) sub
WHERE c.id = sub.conversation_id;

-- ── Index ───────────────────────────────────────────────────────────────────
-- Replaces the two-column index: both sort keys must be in the index for the
-- ordered page to be served as an index scan. The old index is a strict prefix
-- of the new one, so dropping it loses nothing.
--
-- Note: CREATE INDEX (not CONCURRENTLY) because this migration runs in a
-- transaction. On a very large chat_messages table, run the CONCURRENTLY
-- variant outside a transaction instead — see the commented block at the end.

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_seq_idx
  ON chat_messages (conversation_id, created_at, sequence);

DROP INDEX IF EXISTS chat_messages_conversation_created_idx;

ALTER INDEX chat_messages_conversation_created_seq_idx
  RENAME TO chat_messages_conversation_created_idx;

COMMIT;

-- ============================================================================
-- LARGE-TABLE VARIANT
--
-- CREATE INDEX takes an ACCESS EXCLUSIVE lock for its duration, which on a
-- multi-million-row chat_messages table means a visible write stall. To avoid
-- it, run the index step separately and concurrently (outside any transaction),
-- and remove the index block from the transaction above:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_conversation_created_seq_idx
--     ON chat_messages (conversation_id, created_at, sequence);
--
--   DROP INDEX CONCURRENTLY IF EXISTS chat_messages_conversation_created_idx;
--
--   ALTER INDEX chat_messages_conversation_created_seq_idx
--     RENAME TO chat_messages_conversation_created_idx;
--
-- The backfill UPDATE is also worth batching on a very large table (e.g. by
-- conversation_id ranges) so it does not hold a long transaction.
-- ============================================================================
