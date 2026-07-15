# @mordn/chat-widget

A secure-by-default AI chat widget for React/Next.js with one canonical,
JSON-serializable agent configuration and an authenticated bootstrap flow.

## Hosted quick start

Install the widget and its required AI SDK peers (no Tailwind setup is needed):

```bash
npm install @mordn/chat-widget ai @ai-sdk/react
```

Add server-only credentials to `.env.local`:

```env
MORDN_CHAT_KEY="..."       # published config + hosted persistence
AI_GATEWAY_API_KEY="..."  # executes runtime.model gateway strings locally
```

`createMordnHandler` resolves the published config and uses hosted
conversation/attachment storage, but **model execution remains in your route
process**. The route therefore needs its own model credential. If you do not use
the AI SDK gateway, install a provider package (for example
`@ai-sdk/anthropic`), set that provider's server-only key (for example
`ANTHROPIC_API_KEY`), and pass the provider model as the code-level `model`
option. Never expose any of these keys with `NEXT_PUBLIC_`.

Mount one authenticated catch-all route. Browser identity and agent identifiers
are not widget props:

```ts
// app/api/chat/[[...chat]]/route.ts
import { createMordnHandler } from '@mordn/chat-widget/server';
import { auth } from '@clerk/nextjs/server';

const handler = createMordnHandler({
  apiKey: process.env.MORDN_CHAT_KEY!,
  getUserId: async () => (await auth()).userId,
  // Advanced createChatHandler options stay flat:
  // buildTools, retrieval, memory, CORS, hooks, etc.
  // buildTools MERGES with the agent's hosted MCP tools (code wins on a name
  // clash); passing it does not disable dashboard-connected integrations.
});

export const { GET, POST, DELETE, OPTIONS } = handler;
```

The client requires no `userId`, `agentId`, `widgetId`, model, prompt, or
configuration headers:

```tsx
'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

export default function Assistant() {
  return <ChatWidget />; // apiBase defaults to /api/chat
}
```

The stylesheet is prebuilt and scoped to `.chat-widget-container`; consuming
apps do not need Tailwind. Keep the CSS import in a client entry/layout that is
included on every page where the widget can mount.

`getUserId` is the authorization boundary: derive it from a verified server
session (Clerk, Auth.js, Supabase Auth, etc.) and return `null` for an
unauthenticated request. Never read identity from a request header, query, or
body field.

On mount the widget calls `GET /api/chat/bootstrap`. The handler authenticates
with `getUserId`, loads the published canonical config, and returns only
`{ protocolVersion, agent, revision, client, storageScope }`. `protocolVersion`
tracks the bootstrap envelope itself and is independent of the config document's
`schemaVersion`. `storageScope` is an opaque server-derived value (a digest of
the server-resolved agent + verified user — never the API key, so key rotation
does not change it) used for browser chat and panel persistence.

## Canonical `AgentConfig`

The same versioned object is used by the control plane, handler, and preview
transport. It contains data only: no React nodes, functions, credentials, or
infrastructure endpoint URLs. Provider credentials and endpoints stay in
server-only handler options and environment variables.

```ts
import type { AgentConfig } from '@mordn/chat-widget';

const config: AgentConfig = {
  schemaVersion: 1,
  runtime: {
    model: 'anthropic/claude-sonnet-4-5',
    systemPrompt: 'Answer clearly and cite sources.',
    temperature: 0.3,
    maxOutputTokens: 8192,
    followUps: { enabled: true, max: 3 },
    memory: { enabled: true, inject: true, extract: true, limit: 6 },
  },
  client: {
    greeting: 'How can I help?',
    theme: {
      backgroundColor: '#ffffff',
      textColor: '#262626',
      primaryColor: '#171717',
    },
    features: { fileUpload: true },
    display: { layout: 'popup', size: 'default', resizable: true },
    starterPrompts: [{ title: 'What can you help me with?' }],
  },
};
```

A caller may pass `config` to override published **client** fields locally and
to send a complete draft with chat requests from an owner-authenticated preview:

```tsx
<ChatWidget apiBase="/api/owner/preview-chat" config={config} />
```

Production handlers ignore request config. A preview route must opt in with a
server-side resolver; the handler validates the full schema-v1 config before the
resolver runs, and an accepted config replaces the published config as one unit:

```ts
createChatHandler({
  getUserId,
  store,
  storage,
  getHostedConfig,
  resolvePreviewConfig: async (candidate, ctx) => {
    await requireAgentOwner(ctx.userId);
    return candidate;
  },
});
```

There are no per-field model/prompt/temperature headers. Use the optional
`headers` prop only for genuine generic transport metadata such as CSRF tokens.

## Bring your own infrastructure

Use `createChatHandler` directly with a `store`, optional `storage`, and either a
code model or canonical `getHostedConfig`. The same handler exposes chat,
bootstrap, upload, history, memory, and feedback subroutes.

## Suggested follow-ups

Turn on contextual next-step chips with one server-side option:

```ts
export const { GET, POST, DELETE } = createChatHandler({
  getUserId: getChatUserId,
  model: anthropic('claude-sonnet-4-5'),
  store: createDrizzleChatStore(),
  followUps: true,
});
```

After the main answer finishes streaming, the handler makes a small structured
second call with the same resolved model and appends up to three suggestions as
a `data-follow-ups` part on the assistant message. The widget renders them
automatically; clicking one sends it as the next user message. They are also
persisted with the message, so history reloads do not need to regenerate them.
The second call is included in the turn's usage/cost totals.

Tune the count and generation timeout:

```ts
followUps: { max: 4, timeoutMs: 5_000 }
```

For a fully custom server generator, pass `generate(messages, ctx)`. The
existing client-side `ChatWidget` `followUps.generate` remains available as a
BYO-transport fallback, but the server option is recommended because provider
credentials never reach the browser. Set `followUps: false` in the handler to
force-disable a hosted dashboard setting. (There is deliberately no static
suggestion list: the same chips after every reply are noise — fixed prompts
belong in `starterPrompts`.)

---

## Opening the widget from your site (Ask-AI buttons & shortcuts)

The widget can be opened from your OWN page chrome — a nav "Ask AI" button, a
search bar affordance, a keyboard shortcut — with no React ref and no JS at
all for the button case. All three routes are equivalent to calling the
`ChatWidgetHandle` ref's `open()` / `close()` / `toggle()`: same
`allowAutoReopen` gate, same controlled-mode `onOpenChange` behaviour, same
`persistState` persistence.

**1. Keyboard shortcut** — set `display.keyboardShortcut`. Off by default; the
widget never hijacks a host page's keybindings unless you opt in.

```tsx
<ChatWidget config={{ schemaVersion: 1, runtime: { model: 'preview/only' }, client: { display: { keyboardShortcut: 'mod+i' } } }} />
```

**2. Data-attribute buttons** — add `data-mordn-chat-open` (or `-toggle` /
`-close`) to any element, anywhere in your markup, including static or
markdown-generated docs pages. No shortcut config needed; this always works.

```html
<button data-mordn-chat-open>Ask AI</button>
```

**3. CustomEvent API** — the programmatic equivalent, for a search bar, a
command palette, or any other trigger you already have wired up.

```js
document.dispatchEvent(new CustomEvent('mordn-chat:open'));
```

`mordn-chat:close` and `mordn-chat:toggle` work the same way. See the
`keyboardShortcut` JSDoc in `DisplayConfig` for the full combo syntax
(`"mod+k"`, `"ctrl+shift+/"`, a bare `"/"`, …), the typing guard for bare
keys, and multi-instance behaviour.

---

## Script-tag embed (any site)

The standalone bundle uses the same bootstrap architecture. The only declarative
shortcuts are transport/mount settings; identity and agent selection remain
server-side.

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-api-base="https://your-app.com/api/chat"
></script>
```

Or initialise imperatively with the same public props:

```html
<script src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"></script>
<script>
  const chat = MordnChat.init({
    apiBase: 'https://your-app.com/api/chat',
  });
</script>
```

For owner previews, `data-config` may contain the full `MordnChatConfig`, whose
`config` field is a canonical schema-v1 `AgentConfig`. Production handlers ignore
that request config unless `resolvePreviewConfig` is installed.

For cross-origin embeds, explicitly allow the embedding origin and export the
`OPTIONS` handler:

```ts
const handler = createMordnHandler({
  apiKey: process.env.MORDN_CHAT_KEY!,
  getUserId,
  cors: {
    allowOrigins: ['https://docs.example.com'],
    allowCredentials: true, // only when getUserId authenticates with cookies
  },
});
export const { GET, POST, DELETE, OPTIONS } = handler;
```

Set `requestCredentials: 'include'` on `ChatWidget` only for cross-origin cookie
authentication. Same-origin mounts need no CORS option. Generic `headers` remain
available for real transport metadata and may trigger a preflight; they are not
a config or identity transport.

## Bring your own database / storage

The default `createDrizzleChatStore()` and `createSupabaseStorage()` are just
implementations of two interfaces. To use your own database, ORM, or object
store, implement the interface and pass it instead — same handler, same
security guarantees:

```ts
import type { ChatStore, StorageAdapter } from '@mordn/chat-widget/server';

const myStore = (userId: string): ChatStore => ({ /* ... */ });
const myStorage = (userId: string): StorageAdapter => ({ /* ... */ });

createChatHandler({ getUserId, model, store: myStore, storage: myStorage });
```

Both factories are constructed per request with the **server-verified** user id,
so a store/adapter instance can only ever touch that user's data — cross-user
access (IDOR) is unrepresentable. See `SECURITY.md` for the full model.

### File uploads & the storage bucket

`createSupabaseStorage()` expects a **private** `chat-attachments` bucket and
the service-role key:

```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"   # server-only, never NEXT_PUBLIC
```

Create the bucket as **Private** — the adapter never relies on public read; it
mints short-lived signed URLs and re-signs them on history load. A public
bucket would defeat the security model. Omit the `storage` option entirely to
disable uploads.

---

## Handler options (`createChatHandler`)

| Option | Required | Description |
|--------|----------|-------------|
| `getUserId(req)` | **yes** | Return the user id from your verified server session, or `null` (→ 401). The security boundary. |
| `model` | no* | A `LanguageModel`, or `(ctx) => LanguageModel`. *Required only when canonical hosted config does not supply `runtime.model`.* |
| `store` | yes* | A `ChatStoreFactory` for direct `createChatHandler` use. *`createMordnHandler` supplies the hosted store.* |
| `storage` | no | A `StorageAdapterFactory` (e.g. `createSupabaseStorage()`). Omit to disable uploads. |
| `buildTools(ctx)` | no | `async (ctx) => ({ tools, cleanup? })`. `cleanup` is called exactly once per turn (finish/error/abort) — use it to close per-request resources like an MCP client. |
| `buildSystemPrompt(ctx)` | no | Returns the system prompt; receives the request context to personalise. |
| `transformMessages(msgs, ctx)` | no | Last-chance rewrite of model messages (e.g. image part handling). |
| `onChatFinish(info)` | no | Post-persist hook for telemetry/usage. |
| `onError(err)` | no | Map a stream error to the user-facing string. |
| `stopWhen` | no | AI SDK stop condition for tool-call loops (default: bounded step count). |
| `upload` | no | `{ allowedMediaTypes?, maxBytes? }` — server-side upload policy. |
| `maxHistoryMessages` | no | Sliding-window size sent to the model (default 30). |

The widget exposes only these seams. Ownership checks, idempotent persistence,
history pagination, attachment re-signing, and socket teardown are owned by the
handler and are not configurable — getting them wrong is a bug, not a setting.

---

## Knowledge base (RAG) & ingestion

The optional knowledge module (`@mordn/chat-widget/server/knowledge`) ingests
docs into a vector store and retrieves them at chat time. Ingestion is
**docs-aware** by default:

- **Markdown-first extraction.** HTML pages are converted to structure-preserving
  markdown (headings, code fences with language, lists) instead of flat prose;
  `.md`/`.mdx` pages and `text/markdown` responses pass through as-is.
- **Heading-aware chunking.** Chunks are packed within a section, a fenced code
  block is never split, and each chunk is prefixed with its breadcrumb
  (`Guide › Persistence › Sliding window`) and stamped with `anchor` +
  `headingPath` metadata.
- **Deep-link citations.** Web citations get a `#anchor` fragment so a source
  links to the exact section that answered, not the top of the page.
- **`llms.txt` support.** Point ingestion at a site's `llms.txt` index and it
  fetches every linked doc; `sitemap`/`crawl` sources auto-discover and prefer a
  site's `llms.txt` when one exists.

```ts
import { ingest } from '@mordn/chat-widget/server/knowledge';
import { createKnowledgeDrizzleStore } from '@mordn/chat-widget/server/knowledge/drizzle';

const store = createKnowledgeDrizzleStore({ embedder });

await ingest({
  store: store('agent:my-agent'),
  namespace: 'agent:my-agent',
  sources: [
    { type: 'llms', url: 'https://docs.example.com/llms.txt' },
    { type: 'url', url: 'https://docs.example.com/guide.md' },
  ],
  // docsMode: true,       // default — set false for the legacy plain path
  // preferLlmsTxt: true,  // default — sitemap/crawl auto-discover llms.txt
});
```

From the CLI (see the command list in `chat-widget --help`):

```bash
npx @mordn/chat-widget ingest --llms https://docs.example.com/llms.txt
```

`chunkMarkdown` and `htmlToMarkdown` are exported too, for bring-your-own
ingestion pipelines that want the same structure-aware chunking and anchors.

---

## Test your docs bot in CI

If you use the knowledge base to answer questions from your docs, retrieval can
silently regress when you re-crawl or restructure them. Write down the questions
your bot must answer and check them on every push — no LLM calls, so it is free
to run in CI.

Create an `evals.json` (versioned; each case asserts what retrieval should
surface):

```json
{
  "version": 1,
  "defaults": { "topK": 5, "minScore": 0.2 },
  "cases": [
    {
      "id": "install-pnpm",
      "question": "How do I install with pnpm?",
      "expect": {
        "sourceIncludes": "docs.example.com/install",
        "anchor": "pnpm",
        "minScore": 0.4,
        "notSourceIncludes": "legacy"
      }
    }
  ]
}
```

Each case runs the question through your retriever (built from the same
`chat-widget.config` as `ingest`) and passes when every check passes:

- `sourceIncludes` — a retrieved chunk's citation URL or source contains this string (string or array; any match).
- `notSourceIncludes` — no retrieved chunk matches (guards against a wrong/legacy page returning).
- `minScore` — the top retrieved score is at least this.
- `anchor` — a retrieved chunk's heading anchor contains this (populated by docs-aware ingestion).

Run it. The command exits `0` when all cases pass and `1` on any failure:

```bash
npx @mordn/chat-widget eval --file evals.json
```

Add `--json` for the full result object (per-case checks + retrieved chunks),
handy for custom reporting. Drop it into GitHub Actions:

```yaml
- run: npm ci
- run: npx @mordn/chat-widget eval --file evals.json
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

You can also run the suite programmatically with `runEvals` from
`@mordn/chat-widget/server/knowledge`.

---

## Exports

```ts
// Client component + styles
import { ChatWidget, type AgentConfig } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

// Server handler + the pluggable contracts (server-only)
import {
  createChatHandler, createMordnHandler,
  type ChatStore, type ChatStoreFactory,
  type StorageAdapter, type StorageAdapterFactory,
  ConversationOwnershipError,
} from '@mordn/chat-widget/server';

// Default Postgres/Drizzle store (server-only)
import { createDrizzleChatStore, schema } from '@mordn/chat-widget/server/drizzle';

// Default Supabase storage adapter (server-only)
import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';

// Knowledge base / RAG: ingestion, retrieval, docs-aware helpers, and the CI eval suite (server-only)
import {
  ingest,
  chunkMarkdown, htmlToMarkdown,
  createSearchKnowledgeTool, citationUrl,
  runEvals, type EvalFile,
  type IngestSource, type IngestOptions,
} from '@mordn/chat-widget/server/knowledge';
```

---

## License

MIT

