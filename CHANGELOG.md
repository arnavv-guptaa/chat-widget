# Changelog

All notable changes to `@mordn/chat-widget` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/). While on
`0.x`, breaking changes ship in **minor** releases (`0.y.0`) and are always
called out in a **BREAKING CHANGES** section below.

## 0.11.0

Large, near-additive release consolidating the enterprise work: usage/cost
analytics, message feedback, knowledge (RAG) + multi-horizon memory, MCP tools,
human-in-the-loop tool approval, Headroom token compression, and a broad
UI/a11y/security hardening pass.

### ⚠️ BREAKING CHANGES

1. **`@ai-sdk/react` is now a required peer dependency (`^3.0.0`).**
   It was previously not declared as a peer. Consumers must install it
   explicitly alongside the widget:

   ```bash
   npm install @ai-sdk/react@^3
   ```

   If you were already on `@ai-sdk/react` v3 this is a no-op; if you were on an
   older major, upgrade to v3 before updating the widget.

2. **Legacy `/db` store functions now require a server-derived `userId`.**
   The standalone functions exported from `@mordn/chat-widget/db`
   (`createChat`, `loadChat`, `saveChat`, `updateConversationTitle`, …) closed a
   cross-user IDOR (issue #12): every function now **requires** a verified
   `userId` (derived server-side from the session, never from client input) and
   enforces ownership in its `WHERE` clause. Calls that omit `userId` now throw.

   ```diff
   - await loadChat(chatId)
   + await loadChat(userId, chatId)   // userId derived server-side from the session
   ```

   Prefer the user-bound `ChatStore` for new code; these standalone functions are
   retained for migration only and will be removed in a future release.

### Added

- **Knowledge (RAG) + memory engine** — retrieval over knowledge sources/chunks,
  default Google `gemini-embedding-2` embeddings (1536-dim, normalized), and
  multi-horizon memory tiers (session / user / org).
- **Message feedback** — opt-in thumbs up/down on assistant messages, a
  `submitFeedback` util, `feedback` / `onFeedback` config, and server-side
  persistence.
- **Usage/cost analytics** — the chat handler emits normalized per-turn usage
  records (tokens + gateway-computed cost).
- **MCP tools** — `connectMcpTools` wires agent tools from remote MCP servers.
- **Human-in-the-loop tool approval** — `needsApproval` gating with action
  result cards and a false-completion guard.
- **Headroom token compression** — toggleable context compression through
  `createChatHandler` / hosted config (dashboard-pushable).
- **First-class per-turn context injection API** (#162).
- **Conversation context compaction** via `summarizeHistory`.
- **UI capabilities** — dynamic starter prompts, follow-up question chips,
  hover-reveal message actions, per-language code-block icons, reverse
  lazy-loading history, and persisted panel open/closed state.

### Fixed / Hardened

- **Security** — attachment/link DOM-XSS + URL-safety (#7), SSRF hardening in
  knowledge loaders (pinned validated IP, redirect re-validation), and the
  legacy-store IDOR above (#12).
- **Accessibility** — streaming live region + reduced-motion (#18), accessible
  send/stop button naming (#20), focus rings, and keyboard-operable disclosures.
- **UI adaptivity** — bubble width, wide media/tables, overflow, and
  reduced-motion behavior.
- **Streaming reliability** — `onError`/`logErrors` handling and stream health
  checks.
- **Build** — externalize peer deps in tsup builds (#15); self-import marked
  external in the CLI build.
- **AppearanceSettings** theme API crash (#4).
