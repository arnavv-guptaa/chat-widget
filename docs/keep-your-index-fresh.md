# Keep your index fresh

Your docs assistant is only as good as the index behind it. When you ship a docs
change, the answer should follow within a minute — **deploy at 2:00, correct
answers by 2:01** — without waiting for a crawler to come back around.

Mordn gives you a **freshness ladder**: pick the rung that matches how often your
docs move.

1. **Scheduled re-sync** (`daily` / `weekly`) — set a per-source cadence and
   forget it. Good baseline for docs that drift slowly.
2. **Deploy-triggered re-sync** — re-index the moment a docs deploy succeeds, so
   the index tracks `main` exactly. This is the freshest rung, and the one this
   page is about.

Both rungs hit the same endpoint the platform uses internally
(`POST /v1/knowledge/sync`): re-ingest every re-fetchable web source for your
agent (or a subset), skipping anything already in flight. Unchanged content is
cheap — the ingestion pipeline skips re-embedding pages whose content hasn't
changed — so re-syncing on every deploy is safe to do often.

> **The tenant key is a write credential.** Every recipe below authenticates with
> your tenant API key (`mck_live_…`). It must have **write** scope (`POST
> /v1/knowledge/sync` rejects read-only keys with `403`). Until a least-privilege
> `sync`-scoped key ships (**[#242](https://github.com/arnavv-guptaa/chat-widget/issues/242)**),
> treat this key as a **full-write credential** in CI: store it as an encrypted
> secret, never in the repo; scope it to the one agent whose docs you're
> re-indexing; and rotate it if a build log is ever exposed. The recipes are
> written so the key is only ever sent as an `Authorization` header — never
> printed, never on a command line.

---

## Rung 1 — Scheduled re-sync (set a cadence)

Put a source on an automatic `daily` or `weekly` cadence with a `PATCH` to its
sync policy. This is a one-time setup call (run it from your machine, or your
dashboard once that lands):

```bash
curl -fsS -X PATCH "https://api.mordn.com/v1/knowledge/sources/src_your_source_id" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"syncInterval":"daily"}'      # "daily" | "weekly" | null (to clear)
```

The scheduler re-ingests due sources on its own after that. `daily`/`weekly`
covers most docs sites. When you want the index to track deploys exactly,
add rung 2.

---

## Rung 2 — Deploy-triggered re-sync

### GitHub Actions (the official action)

This repo ships a composite action — `arnavv-guptaa/chat-widget/actions/sync` —
that wraps the webhook (POST, optional job polling, secret-safe). A docs repo
needs **≤10 lines** of workflow to re-index on every merge that touches docs:

```yaml
# .github/workflows/resync-docs.yml
name: Re-sync docs
on:
  push:
    branches: [main]
    paths: ['docs/**']          # only when docs actually change
jobs:
  resync:
    runs-on: ubuntu-latest
    steps:
      - uses: arnavv-guptaa/chat-widget/actions/sync@main
        with:
          api-key: ${{ secrets.MORDN_CHAT_KEY }}
```

That's the whole thing. On a push to `main` that changes anything under `docs/`,
the action re-syncs every web source for your agent.

**Gate the deploy on freshness.** Add `wait: true` and the step polls each
ingestion job to completion, **failing the workflow if any job errors** (or the
timeout is hit). A broken re-index goes red in CI instead of silently serving a
stale index:

```yaml
      - uses: arnavv-guptaa/chat-widget/actions/sync@main
        with:
          api-key: ${{ secrets.MORDN_CHAT_KEY }}
          wait: 'true'
          timeout-seconds: '600'
          # source-ids: 'src_abc,src_def'   # optional: re-sync just these
```

When `wait: true`, the action writes a job summary table (job id, status,
progress, stage) to the run's **Summary** tab. It also exposes the kicked job
ids as a `job-ids` output for later steps.

**Inputs**

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | — | Write-scoped tenant key. Pass via `secrets`. Sent only as a Bearer header; never printed. |
| `api-base` | no | `https://api.mordn.com` | API base URL. Override for self-hosted / local. |
| `source-ids` | no | _(all)_ | Comma-separated source ids to re-sync. Omit to re-sync every web source. |
| `wait` | no | `false` | Poll jobs to completion and fail on any errored job. |
| `timeout-seconds` | no | `300` | Max seconds to wait when `wait: true`. |

**Output**

| Output | Description |
| --- | --- |
| `job-ids` | Space-separated ingestion job ids that were kicked. |

Pin to a release tag once one is published (e.g. `@v1`) rather than `@main` for
reproducible CI.

---

### Vercel deploy hook

Vercel doesn't run the docs repo's workflow on its own deploys, so trigger the
re-sync from a **[Deploy Hook](https://vercel.com/docs/deployments/deploy-hooks)**
consumer — a tiny scheduled or post-deploy job that calls the same webhook. The
simplest form is a GitHub Actions job keyed off Vercel's deployment success, or
a one-line curl from any post-deploy runner:

```bash
# Run after a successful production deploy (post-deploy script / CI step).
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

If you build docs on Vercel from the same repo, prefer the GitHub Action above
(it runs in the repo's CI and can gate on `wait: true`). Use the curl form when
the deploy is driven outside GitHub Actions.

---

### Netlify build hook / post-processing

Netlify exposes deploy state via **build plugins** and the deploy-succeeded
event. Call the webhook from an `onSuccess` step so a successful publish
re-indexes the docs:

```toml
# netlify.toml
[[plugins]]
  package = "/plugins/mordn-resync"
```

```js
// plugins/mordn-resync/index.js
export const onSuccess = async ({ utils }) => {
  const res = await fetch('https://api.mordn.com/v1/knowledge/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MORDN_CHAT_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    utils.build.failBuild(`Mordn re-sync failed: HTTP ${res.status} ${await res.text()}`);
  }
};
```

Set `MORDN_CHAT_KEY` in **Site settings → Environment variables** (mark it
secret). `failBuild` turns a failed re-sync into a red deploy, mirroring the
action's `wait: true` behavior.

---

### Cloudflare Pages deploy hook

Cloudflare Pages doesn't run arbitrary post-deploy code, so drive the re-sync
from a **[Deploy Hooks](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)**
consumer or a small **[Worker](https://developers.cloudflare.com/workers/)** you
invoke after publish. From any runner:

```bash
# In the CI job that triggers the Pages deploy, after it reports success:
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Or as a Worker bound to a deploy notification (store the key as a **secret**
binding, `wrangler secret put MORDN_CHAT_KEY`):

```js
export default {
  async fetch(request, env) {
    const res = await fetch('https://api.mordn.com/v1/knowledge/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MORDN_CHAT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    return new Response(await res.text(), { status: res.status });
  },
};
```

---

### Plain curl (any stack)

No CI, or a platform not listed above? The webhook is one request. This is the
exact call every recipe above makes:

```bash
# Re-sync ALL re-fetchable web sources for the key's agent:
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 202 {"jobIds":["job_…","job_…"]}

# …or just specific sources:
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sourceIds":["src_abc","src_def"]}'
```

A `202` with `{ jobIds }` means the re-ingests were kicked (sources already
syncing are skipped, so firing twice is harmless). To gate on completion, poll
each job until its `status` is `done` or `error`:

```bash
curl -fsS "https://api.mordn.com/v1/knowledge/jobs/$JOB_ID" \
  -H "Authorization: Bearer $MORDN_CHAT_KEY"
# → {"status":"queued|running|done|error","progress":{"done":N,"total":M,"stage":"…"},"error":null}
```

Override the host with your own base URL for self-hosted / local deployments
(the action's `api-base` input does the same).

---

## Secret setup checklist

- **Store the key as an encrypted secret**, never in the repo or a plaintext env
  file. GitHub: repo/org **Actions secrets**. Vercel/Netlify/Cloudflare: the
  provider's environment-variable UI, marked secret.
- **Reference it, don't inline it.** In workflows use `${{ secrets.MORDN_CHAT_KEY }}`;
  in shells read it from the environment (`$MORDN_CHAT_KEY`). The action only
  ever sends it as an `Authorization` header and never echoes it.
- **Scope it to one agent.** The key resolves to a single agent server-side, so a
  leaked key can only touch that agent's knowledge — keep it that way.
- **Rotate on exposure.** If a key lands in a build log or screenshot, revoke and
  re-issue it.
- **Least-privilege is coming.** A `sync`-scoped key that can *only* trigger
  re-indexing is tracked in
  **[#242](https://github.com/arnavv-guptaa/chat-widget/issues/242)**. Until it
  ships, the tenant key here is a full-write credential — apply the hygiene above
  accordingly.

---

## Verified API contract

The action and every recipe above use two endpoints, authenticated with
`Authorization: Bearer <tenant key>` (write scope):

- **`POST /v1/knowledge/sync`** — body is optional: `{}` (or none) re-syncs all
  re-fetchable web sources; `{ "sourceIds": ["src_…"] }` targets a subset.
  Responds `202 { "jobIds": [ ... ] }`. Sources already in flight are skipped, so
  the webhook is idempotent under rapid re-fires.
- **`GET /v1/knowledge/jobs/:jobId`** — responds
  `{ "status", "progress": { "done", "total", "stage" }, "error" }` where
  `status` is one of `queued | running | done | error`. `done` = success,
  `error` carries a human-readable failure message.
