# Config evolution — how agent configuration changes without breaking anyone

The agent configuration (`AgentConfig`, exported from `@mordn/chat-widget/config`) is read by **many deployed versions of this package at once**: the customer's server (`createChatHandler` / `createMordnHandler`), the customer's browser bundle, chat-api (publish + read), and chat-web (authoring). A revision the dashboard publishes today is loaded tomorrow by a server that was `npm install`ed weeks ago. This document is the contract that makes that safe. The rules below are enforced by code and CI, not by convention.

## The one-sentence rule

**Writers are strict; readers are tolerant; both come from one descriptor.**

| Role | Where | Function | Unknown key | Optional field with a value this build can't read | Required field missing/invalid |
| --- | --- | --- | --- | --- | --- |
| **Writer** — authoring or accepting a document for storage | chat-api `createVersion`, handler preview trust boundary (`resolvePreviewConfig`), dashboard save | `isAgentConfig` / `isAgentBootstrap` | **reject** | **reject** | reject |
| **Reader** — any runtime consumer | handler `loadPublishedConfig`, hosted `createHostedConfig`, browser `/bootstrap` read, chat-api read path | `readAgentConfig` / `readAgentBootstrap` | **drop + report** | **drop + report** (schema default applies) | reject |

Strictness at the writer keeps typos and junk out of the store. Tolerance at the reader means an older install always loads a newer document. A reader never fails because the world moved on; it only fails when the envelope itself is unreadable (wrong `schemaVersion`, no `runtime.model`).

Readers return `{ ok, value, dropped }`. `value` contains **only** known, valid fields — consumers can never accidentally depend on something the contract doesn't define. `dropped` is logged once per revision (`config.unknown_fields` on the server, one `console.info` in the browser) with an upgrade hint, and never more than that.

## Where the truth lives

`src/agent-config/descriptor.ts`. Every field of the config is declared there **once** with its kind, constraints, `since`, description and `default`. From that descriptor the package derives:

- `isAgentConfig` / `isAgentBootstrap` — strict validators
- `readAgentConfig` / `readAgentBootstrap` — tolerant readers
- `resolveFeatures` / `DEFAULT_FEATURES` — defaults, applied in one place (UI code reads flags from `resolveFeatures(config.features)`, never `config.features.x === true`)
- `describeAgentConfigSchema()` — the machine-readable contract (paths, kinds, `since`, defaults) that the compatibility gate snapshots and that chat-web/docs can render

There is no second list of keys anywhere. If you find yourself writing `['fileUpload', 'webSearch', …]` in a validator, stop — you are creating drift.

## Versioning semantics

- **`schemaVersion`** is the schema *major*. It changes **only** for breaking changes. Additive changes never bump it.
- **`protocolVersion`** (bootstrap envelope) is independent: transport shape and config schema evolve on separate tracks.
- Every field carries **`since`** — the first package version whose canonical schema had it. It is informational (docs, "requires widget ≥ x" hints in the dashboard) and immutable.
- The **package version** (semver) is what customers install. A new optional config field is a `minor` bump; a schema-major bump is, pre-1.0, also a `minor` but listed under **Breaking** in the CHANGELOG.

## What is additive (allowed within a schema major)

- Adding an **optional** field anywhere (top level, nested object, array item).
- Adding a **new optional object** whose own fields may be required *within it* (an old reader never sees the object, so it never sees the requirement).
- Adding **enum members**. An old reader drops the unknown member and applies the default; document the fallback in the field description.
- Relaxing a constraint: widening `min`/`max`, `integer` → `number`, adding a union option.
- Adding a default to a field that had none (must match the behaviour readers already had).

## What is breaking (needs a new `schemaVersion`)

- Removing or renaming a field.
- Changing a field's kind or its *meaning* (same name, different semantics — this is the sneaky one; the gate cannot see it, reviewers must).
- Making an optional field required on an existing object.
- Removing an enum member, tightening `min`/`max`, `number` → `integer`, removing a union option.
- Changing a `literal` (`schemaVersion` itself is one).

When you must break: bump `AGENT_CONFIG_SCHEMA_VERSION`, write a `migrateAgentConfig(vN → vN+1)` in the writer path (chat-api migrates stored revisions forward on read; readers of the old major keep working on old documents), reset the baseline in the same PR, and list it under **Breaking**.

## The gates (what fails if you get it wrong)

1. **Type ↔ descriptor lock.** Each field map is declared `satisfies Record<keyof <Interface>, Field>`. Adding `voiceInput?: boolean` to `FeatureConfig` without a descriptor entry fails `npm run typecheck`. So does the reverse.
2. **Compatibility baseline.** `test/config-evolution.test.ts` diffs `describeAgentConfigSchema()` against `test/fixtures/agent-config.schema.baseline.json` — the contract **as of the last release**. Any removal, retype, tightening, dropped enum member, rewritten `since`, or new required field on an existing object fails the suite with a message naming the path.
3. **Snapshot.** The same description is snapshotted to `agent-config.schema.snapshot.json`. Changing the schema means refreshing it (`npx vitest -u`) and the reviewer sees exactly what changed in the PR diff.
4. **Forward-compat fixture.** `test/fixtures/agent-config.future.json` is a document from an imaginary newer dashboard. Readers must load it; writers must reject it. If you ever add a real field with one of its names, rename the fixture key.

Baseline lifecycle: it is refreshed **only at release time** (`npm run config:baseline`, see RELEASING.md) so that within a release cycle every PR is checked against what customers actually have. Never regenerate it mid-cycle to make a failing gate pass — that is the gate working.

## Adding a field — the checklist

Say you are adding `features.voiceInput`.

1. `src/types.ts` — add `voiceInput?: boolean` to `FeatureConfig` with a JSDoc that states the default and, if relevant, the privacy/behaviour note.
2. `src/agent-config/descriptor.ts` — add the entry to `FEATURE_FIELDS`: `{ spec: { kind: 'boolean' }, since: '<next version>', default: true, description: '…' }`. Optional, always.
3. Consume it through `resolveFeatures(...)`, not `config.features.voiceInput`.
4. `npx vitest -u` to refresh the snapshot; read the diff — it should be exactly one added line.
5. `CHANGELOG.md` under **Added**: `Config: features.voiceInput (optional boolean, default true) — …`.
6. Cross-repo (see below): chat-web toggle + docs; chat-api needs only a dependency bump.
7. Do **not** touch the baseline.

## Cross-repo consequences

- **chat-api** has no schema of its own: `createVersion` (publish) and `getAgentConfig` (read) both import `isAgentConfig` from this package. Publish should stay **strict** (writer). The read path should move to **`readAgentConfig`** (tolerant) so a stored revision written by a newer dashboard never 500s an older API deployment. Either way chat-api must bump `@mordn/chat-widget` before the dashboard can publish a new field.
- **chat-web** imports the same types; the dashboard toggle for a new field should show "requires @mordn/chat-widget ≥ `since`" using `describeAgentConfigSchema()` rather than a hand-typed note.
- **Version advertising.** The hosted config fetcher sends `X-Mordn-Widget-Version` and `X-Mordn-Config-Schema` on `GET /v1/config`. chat-api can log these, surface "N customers are on a version that ignores field X" in the dashboard, or — for installs older than the tolerant reader (≤ 0.18.0) — project the revision down to the key set that version knows. Tolerant reading is the durable mechanism; projection is the bridge for the pre-0.19 install base.

## Why not zod

The package already peer-depends on zod, but the contract is deliberately a tiny hand-rolled engine (`src/agent-config/field.ts`, ~250 lines): one descriptor drives two read modes, produces a stable machine-readable description, and has no dependency on zod's v3/v4 API differences for something three repos import. If the descriptor ever needs richer types, generate a zod schema *from* it — never alongside it.
