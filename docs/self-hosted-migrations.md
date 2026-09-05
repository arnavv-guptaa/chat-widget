# Self-hosted database setup and migrations

This page covers the default Postgres adapters in `@mordn/chat-widget`. Hosted consumers do not apply these SQL files; custom stores own their own schemas and migrations.

## Repository development is not a consumer upgrade

The repository-root `drizzle.config.ts` selects `src/server/stores/drizzle/schema.ts`, the same schema used by `createDrizzleChatStore` and its database client:

- `chat_conversations` stores conversation metadata.
- `chat_messages` stores canonical `parts` JSON plus a `text` projection.

`src/db/schema.ts` instead defines the legacy `conversations` / `messages` tables, with `content`, `files`, and `metadata` message columns. The `/db` and `/schema` package exports still refer to that legacy data layer. They are **not** the schema for `createDrizzleChatStore`.

The root config is for maintainers inspecting or generating SQL for the current chat schema in a source checkout. Its `out: './drizzle'` is a local generation directory, not the hand-written SQL directory and not a checked-in migration history. Knowledge and memory schemas are intentionally excluded. Supply environment variables explicitly; the root config does not load `.env` files.

Changing this config does not move any data or upgrade an existing database. `drizzle-kit generate` compares schema snapshots; without a checked-in baseline it does not prove that a live database has no drift. `drizzle-kit push` changes a live database and can propose destructive changes, especially when pointed at only a subset of a host application's tables. Do not use either the root config or a fresh generated snapshot as an automatic production-upgrade plan.

The CLI's scaffold is separate: it writes a consumer config targeting `./node_modules/@mordn/chat-widget/dist/server/drizzle/index.js`. That is a runtime adapter bundle, with a `server-only` guard and a nested `schema` export, not a dedicated schema-only tooling entry. Its loading and table discovery need validation with the installed Drizzle Kit version; this root-config repair does not certify or repair that consumer path. Do not substitute the legacy `/schema` export as a workaround. The CLI's printed `push` step is not a legacy-data backfill or a production migration procedure.

## Consumer-owned SQL procedure

There is currently **no package-managed versioned migration runner**, migration journal, or automatic upgrade/rollback command. The hand-written SQL under `src/server/stores/*/migrations/` is not copied into `dist` and is not included by the npm package's `files` list. Installing or updating the package does not apply it.

Obtain a source checkout from the [repository](https://github.com/arnavv-guptaa/chat-widget) at the release tag or commit matching your installed package, rather than taking SQL blindly from `main`. Inspect the files in that checkout and bring reviewed copies into your application's migration process. Record the package/source revision, file checksums, and successful applications in your own deployment records or migration runner.

Available hand-written SQL in this revision:

| Adapter | Source-relative SQL path | Apply order / prerequisites |
| --- | --- | --- |
| Chat | `src/server/stores/drizzle/migrations/0001_v2_parts_first.sql` | Creates current chat tables and attempts a legacy backfill when old tables exist. |
| Knowledge (optional) | `src/server/stores/knowledge-drizzle/migrations/0001_knowledge.sql` | Separate setup; requires pgvector and extension privileges. Adds generated lexical-search and vector indexes. |
| Memory (optional) | `src/server/stores/memory-drizzle/migrations/0001_memory.sql` | Base memory table; vector column/index creation is conditional on pgvector availability. |
| Memory tiers | `src/server/stores/memory-drizzle/migrations/0002_memory_tiers.sql` | After memory `0001`; uses concurrent index DDL and must not be wrapped in a single outer transaction. |

There is no chat `0002` migration in this revision. These are adapter-specific sequences, not one global migration numbering scheme. The root chat config does not provision knowledge or memory, and generated SQL alone does not replace their hand-written extension/index setup. Check the resulting database against the adapter you actually enable, including optional vector support.

### Before applying chat SQL

1. Back up the database and prove restore works. Rehearse the exact SQL against a staging copy, with your application's migration runner and intended database role.
2. Inventory schemas and table ownership. The backfill checks `public.conversations` / `public.messages` but queries unqualified table names. Verify the `search_path` and confirm those names really belong to the old chat widget, not another application. Do not run it unchanged against unrelated tables or a custom schema.
3. Compare existing destination tables with the selected schema. `CREATE TABLE IF NOT EXISTS` does not reconcile an existing incompatible table definition. Establish a write-free cutover window or an explicit synchronization plan before copying legacy data.
4. Review runner transaction behavior. The chat SQL has its own `BEGIN` / `COMMIT`; optional memory tier SQL has different transaction requirements. Ensure errors stop execution and are reported.

For a **reviewed staging chat setup**, from the matching source checkout, the manual invocation is:

```sh
psql -X --set=ON_ERROR_STOP=1 "$DATABASE_URL" \
  -f src/server/stores/drizzle/migrations/0001_v2_parts_first.sql
```

Use your own reviewed deployment procedure for production. There is no automatic execution on startup.

### Verify the backfill before cutover

The chat SQL retains old tables, but that alone is not a lossless-upgrade guarantee:

- Existing destination IDs are skipped with `ON CONFLICT DO NOTHING`; reruns do not refresh rows changed in the old tables. Check ID collisions and any writes during the cutover.
- Messages without a matching destination conversation are skipped. Compare counts **and IDs**, and investigate missing/orphaned rows.
- `metadata.parts` is copied when it is an array; otherwise a text part is synthesized from `content`. The separate legacy `files` column and other message metadata are not copied into the current message schema. Audit attachments, tool calls, reasoning, and representative conversation replay before declaring success.
- Legacy timestamps lack timezone information; verify the intended timezone interpretation when copying into `timestamptz` columns.

Test create/list/load/delete behavior with the current store and verify ownership boundaries. Keep legacy tables and backups until the cutover and rollback plan are validated. Switching back to the old store does not copy new-store writes back. Do not enable the SQL file's commented cleanup statements as part of an unattended upgrade.

## Static regression check

From a source checkout, run:

```sh
node scripts/assert-drizzle-schema.mjs
```

This dependency-free check verifies the repository config selects the parts-first schema used by the runtime store. It does not connect to Postgres, execute SQL, validate the consumer bundle, or prove migration drift/round-trip correctness. Consumer tooling, packaging of SQL, a versioned migration history, and database-backed upgrade tests remain separate work.
