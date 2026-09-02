# Changelog

All notable changes to `@mordn/chat-widget` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver with pre-1.0 semantics (minor versions may contain breaking changes, always listed under **Breaking**).

## 0.22.0 — 2026-09-02

### Added
- **Hosted runtime mode (client).** Apps with no server route — Vite/Lovable/Bolt SPAs, Supabase-backed apps — can now mount the widget with a browser-safe publishable key instead of a route: `<ChatWidget publishableKey="pk_live_…" getUserToken={…} />`. The widget talks to `api.mordn.com/v1/hosted/<key>` directly; `getUserToken` returns the signed-in user's access token from the app's identity provider (Supabase Auth, Clerk, Auth0, …), which the hosted runtime verifies against the agent's configured JWKS — the browser still never asserts who it is. `anonymous` (default off, and only when the agent allows it) sends a persisted random visitor id instead of a token so unauthenticated visitors get isolated, clearly-labelled histories. `hostedBaseUrl` overrides the API origin for self-hosted chat-api. Tokens are re-resolved every few minutes so they stay fresh. The script-tag embed gains `data-publishable-key`, `data-anonymous` and `data-hosted-base-url`. Requires chat-api with hosted mode enabled for the agent; server mode (`apiBase` + your route) is unchanged.

## 0.21.0 — 2026-09-02

### Changed
- **Charts: a quality pass on every chart kind.** Charts now render at real pixels — the plot measures its column and lays out in CSS px, so type is always 11px and hairlines are always 1px whether the widget is a 360px popup or a fullscreen panel (previously the whole SVG scaled with the card, shrinking labels in narrow columns and ballooning them in wide ones). Category labels are thinned to fit instead of rotated. Gridlines only, one baseline hairline, and an emphasized zero line whenever an axis crosses zero. Hovering shows a proper tooltip (category header, one row per series, swatches) with a crosshair on line charts and dimming of the other bars; the per-shape native `<title>` tooltips are gone. Legends are HTML under the title, never drawn inside the plot. Pie and donut render beside a slice list (label · value · share) and the donut center shows the total, or the hovered slice's share. Bars are rounded on the outer end only; areas fade with a gradient; sparklines show their last value. Multi-series charts use a categorical palette derived from the brand primary via `color-mix()` (hue rotations at equal lightness), exposed as `--chat-chart-1` … `--chat-chart-8` and `--chat-chart-negative` on `.chat-chart` for white-label overrides. The card's footer actions are quiet text buttons; the data table right-aligns numbers. `valueLabels` is now honored (bar, line, stacked totals) and defaults **on** for horizontal bars.

### Fixed
- **Bar charts with negative values drew below the axis.** The value axis was clamped to start at 0, so losses rendered under the plot, over the tick labels. The axis now *includes* zero rather than starting at it: with mixed signs the baseline moves into the plot and negative bars take the negative color (`--chat-chart-negative`, defaults to `--chat-danger`).

## 0.20.1 — 2026-09-02

### Changed
- **Dictation button moved next to Send.** The microphone now sits in the right-hand action cluster immediately left of Send (where every mainstream chat composer puts it); Attach stays on the left. No behaviour change.

## 0.20.0 — 2026-09-02

### Added
- **Voice dictation in the composer.** A microphone button turns speech into text in the textbox using the browser's built-in speech recognition — the user edits and presses Send like any typed message; nothing is ever auto-sent and no audio passes through the host or mordn. Interim words appear inline while speaking; tap again, press Escape, send, or start typing to stop. The button renders only where the browser supports the API (Chrome, Edge, Safari — not Firefox by default), so unsupported browsers look exactly as before. Config: `features.voiceInput` (optional boolean, default **true**) and `features.voiceInputLanguage` (optional BCP-47 string; defaults to the page language, then the browser language). Both flow through explicit config and the published agent config; both are `since 0.20.0` in the schema descriptor.

## 0.19.0 — 2026-09-02

### Fixed
- **A newer published config no longer breaks older installs.** Every runtime consumer of an agent configuration — the handler's published-config load, the hosted `GET /v1/config` fetcher, and the browser's `/bootstrap` read — now uses a *tolerant* reader: fields this installed version does not know are dropped (and logged once per revision) instead of failing the whole document. Previously the strict validator rejected any unknown key, so publishing a config that used a field from a newer `@mordn/chat-widget` took down chat for every customer still on the older version. The strict validator (`isAgentConfig`) is unchanged and remains the writer-side contract for publish and preview.

### Added
- **Config evolution contract.** One schema descriptor (`src/agent-config/descriptor.ts`) now derives every validator, default, and description. New exports from `@mordn/chat-widget/config`: `readAgentConfig` / `readAgentBootstrap` (tolerant readers returning `{ ok, value, dropped }`), `resolveFeatures` / `DEFAULT_FEATURES` (schema defaults applied in one place), `describeAgentConfigSchema()` (machine-readable contract), `formatConfigIssues`, `AGENT_CONFIG_SCHEMA_VERSION`. Two gates enforce the rules in CI: a type-level `satisfies Record<keyof …, Field>` check so a field cannot exist in the type without a descriptor entry (or vice versa), and a baseline-compatibility test that fails on any removal, type change, tightened range, dropped enum member, or new required field within schema v1. Rules and the add-a-field checklist live in `docs/config-evolution.md`.
- The hosted config fetcher sends `X-Mordn-Widget-Version` and `X-Mordn-Config-Schema` so the control plane can reason about what a deployment understands.

### Changed
- The composer reads feature flags through `resolveFeatures()` (defaults: `fileUpload: false`, `fileUploadAccept: 'image/*'`, `webSearch: false`) instead of ad-hoc `=== true` / `?? 'image/*'` fallbacks. Behaviour is identical.

## 0.18.0 — 2026-08-28

### Added
- **Actionable stream error taxonomy.** `classifyError()` maps SDK, raw-provider, and transport failures to `abort`, `rate_limit`, `auth`, `transient`, `content_policy`, `prompt`, `model`, `tool`, or `unknown`, with conservative `retryable`, `retryAfterMs`, status, code, and safe user-facing guidance. `onError(error, classified)` receives the result as an additive second argument; existing one-argument handlers remain valid. The classifier and its public types are exported from `@mordn/chat-widget/server`.
- **Structured turn observability.** Hosts can provide a `ChatLogger`; the default emits correlated JSON events for turn start/finish/abort/error, persistence, retrieval, memory, titles, follow-ups, cleanup, and request failures. Each request adopts a valid W3C, request/correlation, or AWS X-Ray trace when present—or mints one—and returns it as `X-Mordn-Trace-Id`. Allowed cross-origin callers can read the header.

### Fixed
- **Stop and disconnect now cancel upstream generation and billing by default.** The request abort signal always reaches `streamText`; timeout aborts remain separately classified. Cleanup is single-owner and idempotent, client-abort listeners are removed, partial replies still persist, and `buildTools` runs exactly once. Work that must outlive its requester belongs on a background job rather than this live SSE handler.
- **History pagination no longer stops at 100 messages or loses equal-timestamp rows.** Both built-in store paths allow the router's 101st probe row, and reverse paging uses a deterministic `(createdAt, messageId)` cursor. Malformed cursors return `400`; invalid hosted timestamps are dropped instead of stalling pagination; attachment purge traversal uses the same composite cursor.
- **Error handling avoids unsafe retry loops.** Hard quota exhaustion is non-retryable, multiple provider reset headers choose the latest safe window, raw Anthropic/Google/OpenAI shapes are recognized, upstream failures containing the word “aborted” are not hidden, and the client does not offer blind retries for auth, policy, prompt, or model failures.
- **Trace and logger failure paths are contained.** W3C and AWS trace headers are validated and parsed correctly, async logger rejections cannot become unhandled rejections, error fields never throw and redact common credential forms, streamed responses are re-wrapped with mutable trace headers, and persistence logs report actual success rather than intent.

### Changed
- The history response now includes an opaque `nextCursor`, which the bundled client sends back as `cursor`. The legacy timestamp-only `before` query remains accepted for compatibility.
- `ListMessagesOptions.beforeId` is an optional deterministic tiebreaker. Custom stores that implement pagination should apply `(createdAt < before) OR (createdAt = before AND id < beforeId)` and order equal timestamps by message ID.
- With the built-in logger enabled, `logErrors` now controls structured lifecycle events as well as errors. Pass an explicit `logger` to route telemetry to an existing sink.

### Verification
- Final reviewed PRs passed the repository's Typecheck · Lint · Build job and the strict-ESM Next.js consumer smoke job.
- The npm release remains tag-driven through GitHub OIDC Trusted Publishing; no `NPM_TOKEN` or manual `npm publish` is required.

## 0.17.4 — 2026-08-09

### Fixed
- **Tables no longer shred into one character per line.** Cells inherited `overflow-wrap: anywhere` from `.chat-message-content` — correct for wrapping a long URL in prose, wrong here, because `anywhere` makes the browser count every *character* as a wrap opportunity when it computes a column's min-content width. Paired with `width: 100%` on the table, the auto layout was simultaneously required to fit the widget and free to crush any column to a single character, so a six-column table in a ~380px widget rendered `Homi Bhab / ha Canc / er`. `white-space: nowrap` on `th` made it worse: headers claimed their full width as a hard minimum while the body columns absorbed all of the compression. Tables now take their content width (`max-content`, floored at `min-width: 100%` so a two-column table still fills the card) and scroll sideways instead; cells opt out with `break-word`, which still rescues an unbreakable token but leaves min-content at the longest word — the width the column algorithm needs to see. A `max-width` on `td` (deliberately not `th`, which is nowrap and would spill) stops one prose column pushing the rest off-screen.

### Changed
- **A wide table now reads as scrollable.** Since the fix above relies on horizontal scrolling, that scrolling had to become discoverable: edge fades appear only on a side that actually has more content, tracked from the live scroll position and re-measured as rows stream in. When a table overflows, its scroll region is focusable and labelled, so the hidden columns are reachable by keyboard and not mouse-only.
- **The table copy button is revealed on hover** rather than parked permanently over a column label — a table has no chrome bar to park it in, unlike a code block, where `.chat-code-copy` stays visible. The hide is scoped to `@media (hover: hover)` so it stays visible on touch, `:focus-visible` reveals it for keyboard users, and it stays up through the copied ✓ so the confirmation isn't cut short when the pointer leaves.

## 0.17.3 — 2026-08-01

### Fixed
- **A turn could finish with no answer at all.** `DEFAULT_STEP_BUDGET` was 10, and steps are model turns, not tool calls. A knowledge-grounded agent that searched aggressively spent every step on retrieval, `stopWhen` halted the loop before the model wrote a word, and the client rendered a *completed* turn — tool activity, a Sources card, feedback buttons — with zero text. Indistinguishable from a broken product, and silent: HTTP 200, no error. The budget is now 100.
- **Empty turns now say something.** Whatever still exhausts the budget emits a plain-text fallback instead of nothing, so a turn always ends in words rather than an empty bubble.

## 0.17.2 — 2026-08-01

### Fixed
- **Mermaid no longer leaves a "Syntax error" graphic on the host page.** mermaid needs a live element to measure layout and, given none, creates one on `document.body` — outside `.chat-widget-container`. On a syntax error it painted its bomb graphic there, threw, and left the node attached: the widget degraded correctly to the code view while the embedding site was left with a full-width error graphic. Model output is untrusted parser input, so invalid diagrams are the expected case; the fix layers `suppressErrorRendering`, a `parse()` gate before any DOM work, and an owned offscreen container removed on every exit path.
- **An invalid pie/donut no longer blanks the message bubble.** `PieChart` threw from its component body when slices did not sum to the declared whole. `ChartBlock`'s try/catch wraps `renderChartSvg`, which only *creates* elements — React called the component afterwards, so the throw escaped and crashed the message. The check now runs before the element is created, so it degrades to the intended error card.

### Internal
- Component tests had never run: `vitest.config.ts` matched only `*.test.ts`, so `chart-render.test.tsx` was collected zero times since it was written, and neither jsdom nor `@testing-library/react` was installed. Fixed the include pattern and added the DOM toolchain — which is what surfaced the pie bug. 142 tests across 18 files, up from 125 across 16.

## 0.17.1 — 2026-08-01

### Fixed
- **Switching tabs mid-answer no longer throws the response away.** Each tab now owns its own `Chat` instance, so a background tab keeps streaming into its own message list; switch back and it is still going. Previously one `useChat` was re-keyed per tab, which forced an abort on every activation to stop the old tab's stream appending into the newly-active conversation. That abort was pure loss: the handler passes no `abortSignal` to `streamText` unless the host sets `streamTimeoutMs`, so the server kept generating and persisted the turn regardless — the tokens were paid for, the UI just discarded them until a refresh.
- **Re-entering a tab no longer refetches its history.** A tab's messages live in its own instance, so `loadConversation` skips a tab that is already loaded or streaming. Removes a network round-trip (and its loading state) from every tab switch.

### Notes
- Closing a tab still stops its stream and releases the instance — that is the one place abandoning a stream is right, and the server still finishes and persists, so reopening from history shows the completed answer.
- Refreshing mid-stream still loses the live view (the answer is persisted and appears once complete). Reattaching to an in-flight stream needs `resume: true` plus a server-side resumable-stream endpoint.

## 0.17.0 — 2026-07-31

### Breaking
- **`client.followUps` is removed from `AgentConfig`.** Follow-ups are generated and capped server-side only, via `runtime.followUps`. A stored config still carrying the client key now fails validation — move the setting to `runtime.followUps` (`{ enabled, max }`). The key existed in both planes, so one number was written in two places and the smaller one won invisibly.
- **`ChatWidget`'s `followUps` prop and the `FollowUpConfig` type are removed**, along with the client-side `generate` fallback. It predated the server generator and only ever ran when the response carried no `data-follow-ups` part. Use `createChatHandler({ followUps: true })` or hosted `runtime.followUps`.

### Changed
- The client is a pure renderer of server-sent chips: it reads the `data-follow-ups` part and renders it, bounded by `MAX_FOLLOW_UP_COUNT` as untrusted-input hygiene rather than as a policy knob. How many chips to show is settled once, on the server.
- README rewritten as an entry point (585 → ~110 lines): install, the smallest working setup, the one security invariant, and a linked map into the docs site. Everything it duplicated already had a dedicated docs page.

### Notes
- The rule this establishes: `runtime` holds anything that costs money, touches a credential, or shapes model behaviour; `client` holds pure presentation. **A key name may not appear in both planes.** Follow-ups trigger a paid second model call, so they are runtime.
- 0.16.0–0.16.3 shipped without CHANGELOG entries (smart thread titles, reasoning-model output headroom, history-panel and citation fixes, generator perf). See `git log v0.15.1..v0.16.3`.

## 0.15.1 — 2026-07-26

### Added
- Trusted in-transcript chart rendering: `mordn-chart`/`chart` fences render a validated ChartSpec as zero-dep SVG (#230/#248).

### Fixed
- Last-message copy/retry actions are hover-revealed (the always-visible row under the sources list read as stray icons).
- History search icon centers without transform custom properties (was visibly misplaced on hosts that strip `@property` rules).
- The handler never persists a contentless assistant turn (blank-bubble guard; pairs with chat-api#22).

## 0.15.0 — 2026-07-25

### Breaking
- `<ChatWidget />` now bootstraps published client configuration and an opaque browser-storage scope from `/api/chat/bootstrap`; browser `userId`, `agentId`, `widgetId`, model, prompt, temperature, and flattened appearance props are removed.
- Hosted configuration is one strict, versioned `AgentConfig` document with separate `runtime` and `client` projections. Legacy flat hosted responses are rejected. The canonical schema ships **without** compression (removed in 0.14.0).
- Owner previews pass one complete validated `config` object; per-field draft headers are removed.
- The bootstrap HTTP envelope carries its own `protocolVersion`, independent of the config document's `schemaVersion`.

### Added
- `createMordnHandler({ apiKey, getUserId })` wires hosted configuration, persistence, attachments, feedback, knowledge, memory, and agent MCP tools while model execution remains on the developer's server. Developer `buildTools(ctx)` and hosted MCP tools are merged, not mutually exclusive.
- Added the server-safe `@mordn/chat-widget/config` entry for the canonical schema, validators, and shared control-plane types.
- Generic chat transport `headers` remain available for non-configuration metadata such as CSRF tokens.
- The canonical `client` config carries the 0.14.3 greeting block (`greeting` / `subGreeting`) plus `assistantName`, and `ChatWidgetProps.context` keeps the 0.14.5 `'auto'` / function forms.

### Fixed
- Browser storage scopes are derived from stable agent + user identity, not the rotatable API key, so rotating `MORDN_CHAT_KEY` no longer orphans end-user local state.

## 0.14.5 — 2026-07-24

### Added
- **`context: 'auto'` — built-in page-context capture (#239).** The `context` prop now also accepts `'auto'` and a `() => ChatContext | Promise<ChatContext>` function in addition to a plain object. `'auto'` snapshots a **safe** page shape on **every send** (so SPA navigation between messages is reflected): `url` = `origin + pathname` (**no query string, no fragment**), `path` = pathname, `title` = `document.title`, and `hash` **only when it is a plain docs anchor** (token- and router-state fragments are dropped). The query string and non-anchor fragments are excluded by design because they routinely carry reset tokens, OAuth `state`/`code`, signed-URL signatures, tenant ids, and PII in search params. It is SSR-safe, works in the script-tag embed, and captures no identity data (no cookies, referrer, or user agent). The function form lets hosts compose the auto fields with their own via the new exported `buildAutoPageContext()` helper, and explicitly opt into more of the URL with `buildAutoPageContext({ includeQuery, includeHash })`. The server trust boundary is unchanged: client context stays untrusted and is only injected when the handler opts in via `getContext` / `trustClientContext`. Part of #188.
- **Official sync GitHub Action + deploy-hook recipes** (#237): a composite action at `actions/sync` (pin `uses:` to a full 40-char commit SHA — never `@main` — since a key is passed) wraps the docs-CI webhook (`POST /v1/knowledge/sync`) so a docs repo re-indexes **after a deploy goes live**. Inputs `api-key` (prefer a least-privilege `sync`-scoped key once chat-api PR #17 is deployed; else a write-scoped tenant key, secret), `api-base` (default `https://api.mordn.com`), `source-ids`, `wait`, `timeout-seconds` (default `600`, spans queue + run); outputs `job-ids`. With `wait: 'true'` it polls each returned ingestion job (`GET /v1/knowledge/jobs/:jobId`) — including any coalesced rerun from an overlapping deploy — and fails the workflow on any errored job, emitting a `$GITHUB_STEP_SUMMARY` table that reports a still-unfinished job at timeout distinctly (⏱️ pending vs ❌ error). The key is only ever sent as a Bearer header, never printed. New docs page **`docs/keep-your-index-fresh.md`** covers the freshness ladder (scheduled `PATCH` cadence → deployment-gated re-sync), deployment-gated GitHub Actions triggers (`workflow_run` / `deployment_status` / deploy-gated `push`), Vercel / Netlify / Cloudflare Pages deploy-hook recipes, a plain-curl fallback, overlap/coalesce semantics (safe to fire from every deploy; overlapping deploys are coalesced, never lost — with a compatibility note for chat-api without the claim/coalesce fix), and secret hygiene.


### Fixed
- CI now runs the vitest suite as a hard gate (it previously only covered typecheck/build/esm-check), and the `page-context` node harness registers as a real vitest suite when collected.

## 0.14.4 — 2026-07-24

### Fixed
- **Wire tool `cleanup()` before setup-time throws (#231).** Tools that allocate resources in setup no longer leak them when a later tool's setup throws.

## 0.14.3 — 2026-07-24

### Changed
- **Renderer design-system refresh (#233)** with open-by-default code previews, semantic renderer ramp, linked citation chips, and greeting-led empty state (`greeting` / `subGreeting`).

### Fixed
- Repaired a malformed `peerDependenciesMeta` brace in `package.json` introduced by the release stamp.

## 0.14.2 — 2026-07-16

### Fixed
- **Removed `agentId` from `createHostedKnowledgeRetriever`** — the hosted knowledge API scopes by key, not agent.

## 0.14.1 — 2026-07-15

### Fixed
- **Corrected the hosted API default base URL from `https://api.mordn.dev` to `https://api.mordn.com`.** `api.mordn.dev` is not a Mordn domain and does not serve the hosted API; every hosted client (`createHostedChatStore`, `createHostedStorage`, `createHostedConfig`, `createHostedFeedback`, knowledge, memory) that relied on the default was pointed at a dead host. Consumers passing an explicit `baseUrl` were unaffected.

## 0.14.0 — 2026-07-15

### Breaking
- **Removed Headroom token compression completely.** `createChatHandler({ compression })`, `HostedAgentConfig.compression`, the `Compression*` types/helpers, the Headroom HTTP client, server exports, CLI scaffold, environment placeholders, and documentation are gone. Existing JavaScript configs carrying an extra `compression` key are harmlessly ignored, but TypeScript consumers must remove that option before upgrading.

### Changed
- Model-bound messages now flow directly from the existing bounded history, retrieval, memory, and `transformMessages` pipeline into `streamText`; there is no external compression call or message-content rewrite on the hot path.

## 0.13.2 — 2026-07-15

### Fixed
- Restore the planning loader's animated text shimmer inside the layout-stable assistant slot. The 0.13.1 wrapper moved the shimmer under assistant markdown styling, whose higher-specificity solid `color` declaration defeated the transparent `background-clip: text` effect; the shimmer rule now explicitly wins in that context.

### Internal
- Add a CSS contract test that guards the nested assistant-message shimmer selector.

## 0.13.1 — 2026-07-14

### Fixed
- The pre-response planning shimmer no longer shifts when the AI SDK inserts its empty assistant message before the first streamed part. The empty row is withheld until it has renderable content, and the planning state now occupies the same assistant-message geometry as the response that replaces it. Whitespace-only text also no longer dismisses the indicator early.

## 0.13.0 — 2026-07-12

### Added
- **Server-generated follow-up suggestions** (#220): `createChatHandler({ followUps: true })` makes a bounded structured second call after the main answer, emits a persistent `data-follow-ups` part in the same UI stream, and includes the secondary call in usage/cost totals. Configure `{ max, timeoutMs }` or a custom server `generate(messages, ctx)`; hosted config via `appearance.followUps`. The existing client generator remains a BYO-transport fallback. There is deliberately no static suggestion list — the same chips after every reply are noise; fixed prompts belong in `starterPrompts`.
- Follow-ups render as a **"Related" block** — a quiet label plus up to three stacked full-width rows attached under the completed reply, inside the transcript (replaces the horizontally scrolling pill row, which truncated suggestions and hid all but the first at widget widths).
- **First-class GFM table rendering**: assistant tables render as a rounded card — header on the surface tone, horizontal hairlines only, row hover, `tabular-nums`, and a hover-reveal copy button that serializes the table to TSV (pastes as real cells into Excel/Sheets). Wide tables scroll horizontally inside the card instead of clipping. The widget-owned `table` override replaces Streamdown's wrapper, whose Tailwind classes the widget build never generated. Every system prompt also carries a rendering-surface note steering models to emit GFM pipe tables rather than box-drawing ASCII art inside code fences.
- **Brand file-type icons** (ported from jarvis/Crunch): code-block pills, composer chips, and message attachments show real Python/TypeScript/React/Go/PDF/Excel/… glyphs with embedded brand colors, replacing lucide nearest-glyph stand-ins (a feather for Python). Three duplicate icon systems consolidated into `src/components/file-icons/`.

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
