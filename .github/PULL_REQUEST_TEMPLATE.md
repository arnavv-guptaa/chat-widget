## What & why

<!-- One concern per PR. Link the issue: Closes #N -->

## Verification

- [ ] `npm ci && npm run typecheck && npm test && npm run build` pass locally (state plainly if this PR was authored without compiling — e.g. from a sandbox without registry access — so the reviewer runs these first)
- [ ] Manual check of the changed surface (which browsers / layouts / entry points)

## Configuration contract (delete if this PR does not touch `AgentConfig`)

Read `docs/config-evolution.md` first.

- [ ] New fields are **optional**, declared once in `src/agent-config/descriptor.ts` with `since` (next version), `description`, and `default` where one exists
- [ ] Consumers read the field through `resolveFeatures()` / the tolerant reader, never `config.x === true`
- [ ] `test/fixtures/agent-config.schema.snapshot.json` refreshed (`npx vitest -u`) and the diff is only additions
- [ ] `test/fixtures/agent-config.schema.baseline.json` **not** modified (it changes only at release)
- [ ] CHANGELOG **Added** entry names the field, its type, and its default
- [ ] Cross-repo follow-ups filed (chat-web toggle/docs, chat-api dependency bump) if the field is dashboard-editable

## Identity boundary

- [ ] No change to `getChatUserId` / identity resolution, and no widening of public routes
