# Releasing @mordn/chat-widget

The runbook for cutting a release. Written for 0.12.0 but reusable — it exists because 0.11.0 shipped with a consumer-crashing import that a release checklist would have caught.

## 1. Preflight (before touching the version)

- [ ] All PRs intended for the release are merged to `main`; anything else is retargeted to the next release. Prune `CHANGELOG.md` entries for PRs that didn't make it.
- [ ] CI is green on `main` (once #183 is merged: `verify` = typecheck + build + strict-ESM import check, and `consumer-smoke` = packed-tarball install into a real Next App-Router app). **Do not release on a red or skipped smoke job — this is the gate that catches the 0.11.0 class of bug.**
- [ ] `npm run typecheck && npm run build` locally from a clean tree (`git clean -xdf` first if in doubt).
- [ ] Build artifacts sanity:
  - [ ] `dist/embed.global.js` exists, contains **no** `__MORDN_WIDGET_CSS__` placeholder, and its gzip size is recorded in the PR/release notes (`gzip -c dist/embed.global.js | wc -c`).
  - [ ] `dist/styles.css` present and scoped (spot-check a rule is prefixed with `.chat-widget-container`).
  - [ ] `node scripts/assert-esm-importable.mjs` passes (after #183).
- [ ] Hosted backend (chat-api) prerequisites for the features in this release are live: migrations applied in order (`0006_retrieval_misses`, `0007_source_sync` if those PRs shipped), `GEMINI_API_KEY` set for embeddings.
- [ ] `CHANGELOG.md`: replace `UNRELEASED` with today's date.

## 2. Publish

```bash
npm run build        # prepublishOnly runs it again; belt and braces
npm publish          # publishes with files: ["dist", ...] — verify the pack list first with: npm pack --dry-run
git tag v0.12.0 && git push origin v0.12.0
```

Create the GitHub release from the tag, pasting this version's CHANGELOG section.

## 3. Post-publish verification

- [ ] `npm info @mordn/chat-widget version` shows the new version.
- [ ] `https://unpkg.com/@mordn/chat-widget@0.12.0/dist/embed.global.js` resolves (CDN path for the script-tag embed).
- [ ] Fresh-install smoke: `npm i @mordn/chat-widget@0.12.0` into a scratch Next App-Router app (no transpile config), `next build` passes, widget renders.
- [ ] Plain-HTML smoke: one `<script src="…embed.global.js" data-…>` page against a running handler — widget mounts, chats, no style bleed.

## 4. Consumer repoints (in order)

1. **chat-web** (`arnavv-guptaa/chat-web`)
   - Bump `@mordn/chat-widget` to `^0.12.0`; regenerate `package-lock.json` (`npm install`, commit the lockfile).
   - **Delete the react-syntax-highlighter webpack-alias shim** (added in chat-web PR #15: the `next.config` alias + the shim module) — 0.12.0 has no RSH anywhere, the shim is dead weight.
   - Verify the Vercel preview build is green and the dashboard's embedded widget renders with highlighted code.
2. **jarvis** (`arnavv-guptaa/jarvis`)
   - Bump the pinned `"0.11.0"` → `^0.12.0`; `npm i`; ensure `@ai-sdk/react` is installed (required peer) and `ai` is v6; build + chat smoke (it uses the hosted store — the new 30s client timeouts apply).

## 5. If something is wrong after publish

Never `npm unpublish` a used version. Fix forward:

```bash
npm deprecate @mordn/chat-widget@0.12.0 "broken: <reason> — use 0.12.1"
# fix, bump patch, publish 0.12.1
```

## Notes for future releases

- Breaking peer changes (like 0.12.0's `ai@^6` pin) belong in **Breaking** with the exact `npm i` command consumers must run.
- Anything that changes default runtime behavior (body-size caps, SSRF blocks, chunking defaults) gets a "Behavior changes" entry even when it isn't an API break.
- The consumer-smoke CI job is the minimum bar; a manual plain-HTML embed check stays on this list until it's automated.
