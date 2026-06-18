-- ============================================================================
-- chat-widget store migration: v0.7.1 → v2 (parts-first schema)
-- ============================================================================
--
-- WHAT THIS DOES
--   v0.7.1 stored messages with a flattened `content` text column and tucked
--   the real AI SDK `parts` into a `metadata` jsonb blob, in tables named
--   `conversations` / `messages`. v2 promotes `parts` to a first-class NOT
--   NULL column, adds an explicit `text` projection, and namespaces the tables
--   as `chat_conversations` / `chat_messages` to avoid colliding with a host
--   app's own tables.
--
--   This migration creates the v2 tables and backfills them from the v0.7.1
--   tables if those exist. It is IDEMPOTENT and NON-DESTRUCTIVE: it never drops
--   the old tables. After you've verified the v2 data, drop the old tables
--   manually (see the commented block at the end).
--
-- SAFETY
--   • Wrapped in a transaction — all-or-nothing.
--   • `CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING` make
--     re-running it a no-op.
--   • Reads the old tables only if they're present; on a fresh install the
--     backfill steps simply copy zero rows.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -f 0001_v2_parts_first.sql
--   (or pipe it through your migration runner)
-- ============================================================================

BEGIN;

-- ── v2 tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_conversations (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  title       text NOT NULL DEFAULT 'New Chat',
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_conversations_user_updated_idx
  ON chat_conversations (user_id, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id               text PRIMARY KEY,
  conversation_id  text NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  role             text NOT NULL,
  parts            jsonb NOT NULL,
  text             text NOT NULL DEFAULT '',
  model            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON chat_messages (conversation_id, created_at);

-- ── Backfill from v0.7.1 tables, if present ─────────────────────────────────
-- Guarded with to_regclass so this is a clean no-op on fresh installs.

DO $$
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL THEN
    -- Conversations carry over 1:1.
    INSERT INTO chat_conversations (id, user_id, title, metadata, created_at, updated_at)
    SELECT
      c.id,
      c.user_id,
      COALESCE(c.title, 'New Chat'),
      c.metadata,
      COALESCE(c.created_at, now()),
      COALESCE(c.updated_at, now())
    FROM conversations c
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF to_regclass('public.messages') IS NOT NULL THEN
    -- Messages: derive `parts` from the old metadata.parts when present,
    -- otherwise synthesise a single text part from `content`. Derive `text`
    -- from the old `content` (a fine projection for legacy rows).
    INSERT INTO chat_messages (id, conversation_id, role, parts, text, model, created_at)
    SELECT
      m.id,
      m.conversation_id,
      m.role,
      CASE
        WHEN m.metadata ? 'parts'
             AND jsonb_typeof(m.metadata -> 'parts') = 'array'
          THEN m.metadata -> 'parts'
        ELSE jsonb_build_array(
               jsonb_build_object('type', 'text', 'text', COALESCE(m.content, ''))
             )
      END AS parts,
      COALESCE(m.content, '') AS text,
      m.model,
      COALESCE(m.created_at, now())
    FROM messages m
    -- Only migrate messages whose conversation made it across (FK safety).
    WHERE EXISTS (
      SELECT 1 FROM chat_conversations cc WHERE cc.id = m.conversation_id
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- AFTER VERIFICATION — drop the old tables manually. Left commented so this
-- migration never destroys data automatically. Run these only once you've
-- confirmed chat_conversations / chat_messages look right:
--
--   DROP TABLE IF EXISTS messages;
--   DROP TABLE IF EXISTS conversations;
-- ============================================================================
