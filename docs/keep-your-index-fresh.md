# Keep your index fresh

Your docs assistant is only as good as the index behind it. When you ship a docs
change, the answer should follow **shortly after the new page is actually live** —
without waiting for a crawler to come back around. In practice the index is
typically fresh within about a minute of the trigger for changed-page workloads,
but measure your own pipeline before quoting an SLO — end-to-end latency depends
on your deploy time, page count, and how much content changed.

> **Trigger on the deploy, not on the push.** A `git push` (or a merged PR) only
> means the *source* changed — the public site your assistant crawls may still be
> serving the OLD page for seconds to minutes while your host builds and rolls out
> the deploy. If you re-sync on push, the crawler can fetch the stale page and
> report success against last week's content. **Every pattern below fires only
> after the new content is live at its public URL** (a deploy hook, a
> `deployment_status == success` event, a completed deploy `workflow_run`, or a
> `push` job that first *waits for its own deploy step*). Pick the one that matches
> where your deploy happens.

Mordn gives you a **freshness ladder**: pick the rung that matches how often your
docs move.

1. **Scheduled re-sync** (`daily` / `weekly`) — set a per-source cadence and
   forget it. Good baseline for docs that drift slowly.
2. **Deploy-triggered re-sync** — re-index the moment a docs deploy **goes live**,
   so the index tracks what's actually served. This is the freshest rung, and the
   one this page is about.

Both rungs hit the same endpoint the platform uses internally
(`POST /v1/knowledge/sync`): re-ingest every re-fetchable web source for your
agent (or a subset). Unchanged content is cheap — the ingestion pipeline skips
re-embedding pages whose content hasn't changed — so re-syncing on every deploy is
safe to do often. Overlapping deploys are **coalesced onto a durable queued
rerun**, never dropped (see [Idempotency & overlapping deploys](#idempotency--overlapping-deploys)).

> **Authenticate with the least-privilege key.** Every recipe below sends an
> `Authorization: Bearer` header. Prefer a **`sync`-scoped key** that can *only*
> trigger re-indexing (see [Secret setup](#secret-setup-checklist)) once your
> chat-api deployment supports it; fall back to a write-scoped tenant key
> (`mck_live_…`) on older / self-hosted deployments, treating it as a full-write
> credential. Either way: store it as an encrypted secret, never in the repo. The
> recipes never print it.

---

## Rung 1 — Scheduled re-sync (set a cadence)

Put a source on an automatic `daily` or `weekly` cadence with a `PATCH` to its
sync policy. This is a one-time setup call (run it from your machine, or your
dashboard once that lands):

```bash
curl -fsS -X PATCH "https://api.mordn.com/v1/knowledge/sources/src_your_source_id" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"syncInterval":"daily"}'      # "daily" | "weekly" | null (to clear)
```

The scheduler re-ingests due sources on its own after that. `daily`/`weekly`
covers most docs sites. When you want the index to track deploys exactly,
add rung 2.

---

## Rung 2 — Deploy-triggered re-sync

The whole point of this rung is to fire **after the deploy is live**. The recipes
are ordered from most-recommended (genuinely post-deploy) downward. A plain
`push:` trigger is only safe when the deploy happens *inside the same job* before
the sync step — that variant is documented last, with the guardrail spelled out.

### Pin the action to an immutable commit SHA

The action is consumed as `arnavv-guptaa/chat-widget/actions/sync`. Because you
pass a **credential** to it, never reference a moving ref like `@main`: a force-push
or a compromised branch would run arbitrary code with your key. **Pin every
`uses:` to a full 40-character commit SHA.**

```yaml
# Resolve the SHA once, e.g.:
#   git ls-remote https://github.com/arnavv-guptaa/chat-widget refs/heads/feat/sync-github-action
# or open the commit on GitHub and copy the full 40-char hash. Then pin it:
- uses: arnavv-guptaa/chat-widget/actions/sync@REPLACE_WITH_40_CHAR_COMMIT_SHA
```

> A tagged release (e.g. `v1`) will be published for this action. Even then, pin
> the tag **by its commit SHA** rather than the moving tag — this is
> [GitHub's own hardening guidance](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
> for third-party actions. The `REPLACE_WITH_40_CHAR_COMMIT_SHA` placeholder below
> is the SHA you resolved above.

### GitHub Actions — after the deploy workflow completes (`workflow_run`)

If your docs deploy runs in its **own** GitHub workflow (say `deploy-docs.yml`),
trigger the re-sync when that workflow *completes successfully*. This is the
cleanest post-deploy signal when the deploy lives in GitHub Actions:

```yaml
# .github/workflows/resync-docs.yml
name: Re-sync docs
on:
  workflow_run:
    workflows: ["Deploy docs"]     # the name: of your deploy workflow
    types: [completed]
jobs:
  resync:
    runs-on: ubuntu-latest
    # Only when the deploy actually succeeded — not on a failed/cancelled deploy.
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    steps:
      - uses: arnavv-guptaa/chat-widget/actions/sync@REPLACE_WITH_40_CHAR_COMMIT_SHA
        with:
          api-key: ${{ secrets.MORDN_SYNC_KEY }}
          wait: 'true'
          # source-ids: 'src_abc,src_def'   # optional: re-sync just these
```

### GitHub Actions — on a deployment success event (`deployment_status`)

If your host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, …) reports
deployments back to GitHub, key off the **`deployment_status`** event and require
`state == 'success'`. This fires only once the environment is live:

```yaml
# .github/workflows/resync-on-deployment.yml
name: Re-sync on deployment success
on:
  deployment_status: {}
jobs:
  resync:
    runs-on: ubuntu-latest
    if: ${{ github.event.deployment_status.state == 'success' }}
    steps:
      - uses: arnavv-guptaa/chat-widget/actions/sync@REPLACE_WITH_40_CHAR_COMMIT_SHA
        with:
          api-key: ${{ secrets.MORDN_SYNC_KEY }}
          wait: 'true'
```

### GitHub Actions — deploy and sync in one workflow (`push` **gated on the deploy job**)

Only if the docs deploy happens **inside this same workflow** may you start from
`push`. The sync job must `needs:` the deploy job so it runs **after** the deploy
step has published — never in parallel with it. This is the *only* push-triggered
pattern that is safe, because the deploy completing is the gate:

```yaml
# .github/workflows/deploy-and-resync.yml
name: Deploy and re-sync docs
on:
  push:
    branches: [main]
    paths: ['docs/**']          # only when docs actually change
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # … your build + publish steps; this job MUST finish only once the new
      #   content is actually live at the public URL the assistant crawls …

  resync:
    needs: deploy               # ← gate: runs only after deploy succeeds
    runs-on: ubuntu-latest
    steps:
      - uses: arnavv-guptaa/chat-widget/actions/sync@REPLACE_WITH_40_CHAR_COMMIT_SHA
        with:
          api-key: ${{ secrets.MORDN_SYNC_KEY }}
          wait: 'true'
          timeout-seconds: '900'
```

> ⚠️ **Do not** re-sync from a bare `push:` job that has no dependency on the
> deploy. Pushing to `main` does not mean the site is live — the crawler would
> race your host's build and can index the *old* page. If your deploy runs
> somewhere other than this workflow, use one of the two event-driven patterns
> above instead.

**Gate CI on freshness.** `wait: 'true'` (used above) polls each ingestion job to
completion and **fails the workflow if any job errors** — a broken re-index goes
red in CI instead of silently serving a stale index. It also polls the
**coalesced rerun** for an overlapping deploy, so a successful run means the
content as-of-trigger-time is indexed. The action writes a job-summary table (job
id, status, progress, stage) to the run's **Summary** tab and exposes the kicked
job ids as a `job-ids` output. See
[Timeouts under coalescing](#timeouts-under-coalescing) for how `timeout-seconds`
is budgeted.

**Inputs**

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | — | `sync`-scoped key (preferred) or write-scoped tenant key. Pass via `secrets`. Sent only as a Bearer header; never printed. |
| `api-base` | no | `https://api.mordn.com` | API base URL. Override for self-hosted / local. |
| `source-ids` | no | _(all)_ | Comma-separated source ids to re-sync. Omit to re-sync every web source. |
| `wait` | no | `false` | Poll jobs to completion (incl. any coalesced rerun) and fail on any errored job. |
| `timeout-seconds` | no | `600` | Max seconds to wait when `wait: true`. Spans **queue + run** (see below). |

**Output**

| Output | Description |
| --- | --- |
| `job-ids` | Space-separated ingestion job ids that were kicked. |

---

### Vercel deploy hook

Vercel doesn't run the docs repo's workflow on its own deploys, so trigger the
re-sync from a **[Deploy Hook](https://vercel.com/docs/deployments/deploy-hooks)**
— which fires **after** a deployment completes, i.e. once the new build is live.
Point the hook at a tiny consumer that calls the webhook, or run the curl from a
Vercel-driven post-deploy step:

```bash
# Run only after a successful PRODUCTION deploy is live (deploy-hook consumer or
# a post-deploy script). Vercel's deploy hook fires post-deploy, so the public
# URL is already serving the new content when this runs.
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

If your docs build on Vercel from a GitHub repo, you can instead use the
`deployment_status` GitHub Action above (Vercel posts deployment statuses to
GitHub) and gate CI with `wait: 'true'`. Use the curl form when the deploy is
driven outside GitHub Actions.

---

### Netlify build hook / post-processing

Netlify's **`onSuccess`** build step runs only after a successful publish, so the
deploy is live when it fires. Call the webhook from there so a successful publish
re-indexes the docs:

```toml
# netlify.toml
[[plugins]]
  package = "/plugins/mordn-resync"
```

```js
// plugins/mordn-resync/index.js
// onSuccess runs only after a successful publish — the new content is live.
export const onSuccess = async ({ utils }) => {
  const res = await fetch('https://api.mordn.com/v1/knowledge/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MORDN_SYNC_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    utils.build.failBuild(`Mordn re-sync failed: HTTP ${res.status} ${await res.text()}`);
  }
};
```

Set `MORDN_SYNC_KEY` in **Site settings → Environment variables** (mark it
secret). `failBuild` turns a failed re-sync into a red deploy, mirroring the
action's `wait: true` behavior.

---

### Cloudflare Pages deploy hook

Cloudflare Pages doesn't run arbitrary post-deploy code, so drive the re-sync
from something that fires **after** the deployment succeeds: a
[deployment webhook / notification](https://developers.cloudflare.com/pages/configuration/git-integration/#deployment-notifications)
bound to the *success* event, or a CI job that triggers the Pages deploy and
**waits for it to report success** before syncing. Do not fire on the push that
starts the build.

```bash
# In the CI job that triggers the Pages deploy: run this only AFTER the deploy
# reports success (poll the deployment status / await the deploy step), so the
# public site is already serving the new content.
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Or as a Worker bound to a **deploy-success** notification (store the key as a
**secret** binding, `wrangler secret put MORDN_SYNC_KEY`):

```js
export default {
  // Bind this to a deploy-SUCCESS notification, not a build-started one.
  async fetch(request, env) {
    const res = await fetch('https://api.mordn.com/v1/knowledge/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MORDN_SYNC_KEY}`,
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

No CI, or a platform not listed above? The webhook is one request. **Run it from
your post-deploy step** — the point in your pipeline that executes only after the
new content is live — not from the commit/push step. This is the exact call every
recipe above makes:

```bash
# Re-sync ALL re-fetchable web sources for the key's agent (run post-deploy):
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
# → 202 {"jobIds":["job_…","job_…"]}

# …or just specific sources:
curl -fsS -X POST "https://api.mordn.com/v1/knowledge/sync" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sourceIds":["src_abc","src_def"]}'
```

A `202` with `{ jobIds }` means the re-ingests were kicked. To gate on completion,
poll each returned job until its `status` is `done` or `error`:

```bash
curl -fsS "https://api.mordn.com/v1/knowledge/jobs/$JOB_ID" \
  -H "Authorization: Bearer $MORDN_SYNC_KEY"
# → {"status":"queued|running|done|error","progress":{"done":N,"total":M,"stage":"…"},"error":null}
```

Override the host with your own base URL for self-hosted / local deployments
(the action's `api-base` input does the same).

---

## Idempotency & overlapping deploys

**It is safe to fire the webhook from every deploy — overlapping deploys are
coalesced, never lost.** `POST /v1/knowledge/sync` responds `202 { jobIds }` where
**every requested syncable source contributes a job id**, and that job's terminal
success guarantees the content **as of the trigger time** is indexed. If a new
deploy triggers while a source is still syncing, the request does not fail and is
not dropped: it **coalesces onto a durable queued rerun** for that source, so the
newer revision is picked up after the in-flight run finishes.

Because each trigger returns its own job ids, `wait: true` (or polling the
returned ids yourself) **also covers the coalesced rerun** — a green run means the
latest triggered content is in the index, even if your deploys overlap. You do not
need to debounce or serialize your deploys.

> **Compatibility note.** This coalesce/claim behavior ships in the chat-api
> companion fix (`fix/atomic-sync-claim-coalesce`). Against **older chat-api
> versions without that fix**, overlapping triggers for a source that is already
> in flight may be **skipped** (the rerun isn't queued), so a rapid second deploy
> could be missed until the next trigger. If you run self-hosted, **upgrade
> chat-api to a version that includes the claim/coalesce fix** to get
> never-dropped overlap semantics. On the hosted service this is handled for you.

Note the distinction from **sync-now** (`POST /v1/knowledge/sources/:id/sync`),
the single-source manual trigger, which intentionally returns **`409 Conflict`**
if that source is already syncing. The deploy webhook (`/v1/knowledge/sync`) is
the one to wire into CI precisely because it coalesces instead of conflicting.

### Timeouts under coalescing

When you use `wait: true`, `timeout-seconds` (default **600**) is budgeted across
**both the queue wait and the run** for each job. A coalesced rerun can sit
`queued` behind the in-flight sync before it even starts, so polling it may take
longer than a single cold sync — size the timeout for *queue + run*, not run
alone. If a job is still unfinished when the budget is hit, the action reports it
**distinctly by its last-seen state**: a job still waiting shows **⏱️ pending
(queued)** (typically the coalesced rerun) and a job mid-work shows **⏱️ pending
(running)** — both are clearly separated from a genuine **❌ error**. A timeout
still fails the step (freshness wasn't confirmed within the budget); raise
`timeout-seconds` if your pipeline legitimately needs longer.

---

## Secret setup checklist

- **Prefer a `sync`-scoped key.** A least-privilege key that can *only* trigger
  re-indexing is the right credential for CI. Use it as soon as your chat-api
  deployment supports scoped keys (chat-api **PR #17**). It limits blast radius: a
  leaked sync key can't read or write your knowledge base, only kick a re-sync.
  - ⚠️ **Do not mint a `sync`-scoped key before chat-api PR #17 is deployed.**
    Older chat-api treats an **unknown scope as read/write**, so a key you
    *intended* to be sync-only would actually be a full-access credential on that
    server. Confirm the scoped-key support is live first.
- **Fallback: a write-scoped tenant key** (`mck_live_…`) for older or self-hosted
  deployments that predate scoped keys. `POST /v1/knowledge/sync` rejects
  read-only keys with `403`, so it must have **write** scope. ⚠️ **Blast-radius
  warning:** a tenant write key is a **full-write credential** — a leak lets an
  attacker modify that agent's knowledge base, not just re-sync it. Scope it to the
  one agent and rotate on any exposure.
- **Store the key as an encrypted secret**, never in the repo or a plaintext env
  file. GitHub: repo/org **Actions secrets**. Vercel/Netlify/Cloudflare: the
  provider's environment-variable UI, marked secret.
- **Reference it, don't inline it.** In workflows use `${{ secrets.MORDN_SYNC_KEY }}`;
  in shells read it from the environment (`$MORDN_SYNC_KEY`). The action only ever
  sends it as an `Authorization` header and never echoes it.
- **Scope it to one agent.** The key resolves to a single agent server-side, so a
  leaked key can only touch that agent — keep it that way.
- **Rotate on exposure.** If a key lands in a build log or screenshot, revoke and
  re-issue it.

---

## Verified API contract

The action and every recipe above use two endpoints, authenticated with
`Authorization: Bearer <key>` (a `sync`-scoped key, or a write-scoped tenant key):

- **`POST /v1/knowledge/sync`** — body is optional: `{}` (or none) re-syncs all
  re-fetchable web sources; `{ "sourceIds": ["src_…"] }` targets a subset.
  Responds `202 { "jobIds": [ ... ] }` — one job id per requested syncable source,
  whose terminal success guarantees content as-of-trigger-time is indexed.
  Overlapping deploys **coalesce onto a durable queued rerun** (never dropped) with
  the claim/coalesce companion fix; without it, an in-flight source may be skipped.
- **`GET /v1/knowledge/jobs/:jobId`** — responds
  `{ "status", "progress": { "done", "total", "stage" }, "error" }` where
  `status` is one of `queued | running | done | error`. `done` = success,
  `error` carries a human-readable failure message.
- **`POST /v1/knowledge/sources/:id/sync`** (sync-now, single source) — returns
  **`409 Conflict`** if that source is already syncing. Distinct from the deploy
  webhook above, which coalesces instead of conflicting. Not used by the recipes
  here; noted so you don't confuse the two.
