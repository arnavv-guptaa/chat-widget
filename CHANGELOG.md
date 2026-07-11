# Changelog

All notable changes to `@mordn/chat-widget` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver with pre-1.0 semantics (minor versions may contain breaking changes, always listed under **Breaking**).

## 0.13.0 — UNRELEASED

### Added
- **Server-generated follow-up suggestions** (#220): `createChatHandler({ followUps: true })` makes a bounded structured second call after the main answer, emits a persistent `data-follow-ups` part in the same UI stream, and includes the secondary call in usage/cost totals. Configure `{ max, timeoutMs }` or a custom server `generate(messages, ctx)`; hosted config via `appearance.followUps`. The existing client generator remains a BYO-transport fallback. There is deliberately no static suggestion list — the same chips after every reply are noise; fixed prompts belong in `starterPrompts`.
- Follow-ups render as a **"Related" block** — a quiet label plus up to three stacked full-width rows attached under the completed reply, inside the transcript (replaces the horizontally scrolling pill row, which truncated suggestions and hid all but the first at widget widths).

### Fixed
- Chat transport headers are resolved **per request**: hosts that change `extraHeaders` between renders (e.g. the dashboard playground's unsaved draft toggles) no longer send stale mount-time values.

## 0.12.0 — 2026-07-10

### Breaking
- **Theming API is now exactly three required colors — `theme.mode` is removed.** `ThemeConfig` is `{ backgroundColor, textColor, primaryColor }`, all required hex; omit `theme` for the stock palette. Invalid or partial themes are ignored whole (never half-applied). The luminance auto-contrast flip is gone: the widget renders declared colors faithfully and derives every neutral (surfaces, borders, muted/subtle text, placeholder) from one background→text ramp. Internally, background lightness only selects the syntax-highlight palette and shadow strength (`.chat-dark`, not part of the public API). Assistant links now use `--chat-primary` instead of a hardcoded blue.
- **Removed the legacy `useChatTheme` hook and its exports** (plus the unused `AppearanceSettings`/`WidgetSettings` components). It duplicated the theming system and wrote CSS variables onto the host page's `documentElement`, leaking outside the widget scope.
- **`ai` peer dependency is now explicitly pinned to `^6`** (#181). The widget externalizes the AI SDK so your app's single instance is used; a v5 `ai` install must be upgraded.
- Reminder from 0.11.0 (already live, listed for upgraders skipping versions): `@ai-sdk/react` is a **required** peer — `npm i @ai-sdk/react` — and the legacy `/db` + `/api` store functions require a server-verified `userId` (the IDOR fix).

### Fixed
- **Strict-ESM consumer crash (`ERR_UNSUPPORTED_DIR_IMPORT`) is gone**: `react-syntax-highlighter` and its directory-path Prism theme imports were removed entirely (#177). Next.js RSC / Vite / Turbopack consumers no longer need workarounds — if you added a webpack alias shim for `react-syntax-highlighter/dist/esm/styles/prism`, delete it after upgrading.
- `undici` moved to runtime `dependencies` — the SSRF-safe ingestion loader no longer depends on a hoisting accident (#178).
- `ActionResultCard` link `href`s are sanitized through the `safeUrl` allowlist (#179).
- Radix portals and the floating launcher render inside the widget's CSS scope, fixing style bleed/mis-theming when embedded in host apps with aggressive global styles (#180).
- Internal: `@supabase/supabase-js` restored as a devDependency so the d.ts build compiles standalone (#182).

### Added
- **`THEME_PRESETS` export** — canonical named three-color presets (Light, Dark, Midnight, Cream, Forest, Ocean) for the playground preset picker; the widget package is the single source of truth.
- **Syntax highlighting in chat** (#197): fenced code in assistant messages and tool-call code render through a lazy, ESM-clean Shiki pipeline — highlighted on expand, streaming-safe, theme-token-driven (`--shiki-light/-dark` mapped to the widget's light/dark scope), always degrading to plain text on any failure. Tool output is language-detected (JSON vs text) instead of force-labeled JSON.
- **Open triggers** (#198): `display.keyboardShortcut` (e.g. `"mod+i"` — recommended docs convention next to Cmd+K search), `data-mordn-chat-open|toggle|close` attributes on any element, and a `document` CustomEvent API (`mordn-chat:open|close|toggle`). All routes honor the existing `allowAutoReopen` gate and controlled-mode semantics.
- **Docs-aware ingestion** (#207): markdown-first HTML extraction, heading-aware chunking that never splits code fences (breadcrumb context, GitHub-style anchors), **deep-link citations** (`url#anchor`), `llms.txt` sources + auto-discovery on `sitemap`/`crawl` (`preferLlmsTxt`), CLI `ingest --llms`, and public `chunkMarkdown` / `htmlToMarkdown` exports. New ingest options: `docsMode` (default `true`), `preferLlmsTxt` (default `true`).
- **Script-tag embed** (#212): self-contained `dist/embed.global.js` (React bundled, scoped CSS inlined at build) with `window.MordnChat.init/open/close/toggle/destroy`, declarative `data-*` auto-init, and anonymous persistent user IDs — the widget now works on MkDocs/Sphinx/Hugo/plain-HTML sites.
- Server hardening (#184–#186): real request body-size cap via `maxRequestBytes` (default **1 MB** — oversized bodies now get `413`), opt-in `streamTimeoutMs`, memory consent checks fail closed, attachment blobs purged on conversation delete, SSRF guard on MCP server URLs (private/metadata hosts blocked by default; `allowPrivateHosts` to opt out), and 30s default timeouts on all hosted HTTP clients (`timeoutMs` per client, `0` disables).

### Behavior changes to be aware of
- New ingests chunk docs-aware by default (`docsMode: true`) — existing stored chunks are untouched until a re-ingest; `contentHash` will see changed chunk text and re-embed on the next sync.
- `sitemap`/`crawl` ingestion prefers a site's `llms.txt` when one exists (`preferLlmsTxt: false` restores old behavior).
- Requests larger than 1 MB are rejected with `413` unless you raise `maxRequestBytes` (#184).
- MCP servers on private/internal hosts are blocked unless `allowPrivateHosts: true` (#185).

### Internal
- CI PR gates: typecheck, build, strict-ESM import check, and a real Next App-Router consumer smoke build (#183). First behavior tests: vitest harness with handler IDOR/identity-boundary, SSRF net-guard, and URL-safety suites (#187).
- Neutral color tokens consolidated 14 → 10: `--chat-surface-deep`/`--chat-muted` fold into `--chat-surface`, `--chat-surface-hover` into `--chat-hover-bg` (now the 0.10 ramp stop, so hover feedback is visible), `--chat-divider` into `--chat-border`; `--chat-text-muted` moves 0.64 → 0.75 (icons/secondary text sit closer to the text color). All tokens are uniform HSL triplets now. These are internal names (the public theming API is unchanged), but anyone overriding `--chat-*` vars directly should re-check their overrides. The composer pill is a single fill (transparent textarea/form) — the old two-zone tint split is gone.
- Ad-hoc `hsl(var(--chat-text) / α)` blends replaced with their ramp-token equivalents, so emphasis/hover colors can't drift between code paths.

## 0.11.0 — 2026-07-05
The enterprise consolidation release (#176): six audit-critical fixes (XSS in attachments/links, legacy-store IDOR, AppearanceSettings crash, streaming live region, send-button a11y, tsup externalization), interactive a11y + UI-resilience hardening, prompt-input hardening, action result cards, follow-up chips, streaming reliability, Headroom token compression, message feedback end-to-end, and the knowledge/RAG + memory + MCP engine. Known issue (fixed in 0.12.0): a leftover `react-syntax-highlighter` directory import crashed strict-ESM consumers.
