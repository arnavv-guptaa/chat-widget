# @mordn/chat-widget

A customizable, **secure-by-default** AI chat widget for React/Next.js apps,
with conversation persistence and attachments handled for you.

The widget owns the hard, dangerous-to-get-wrong backend plumbing — conversation
ownership, idempotent persistence, history, private attachments, streaming —
behind one mounted handler. You supply the three things that are genuinely
yours: **who the user is** (auth), **which model**, and **which tools**.

> ## ⚠️ Security: you establish identity on the server
>
> The widget sends an `X-User-Id` header, but **it is not an authentication
> boundary** — the browser controls it. You must implement `getChatUserId(req)`
> to return the user id from your **verified server session** (Clerk, NextAuth,
> Supabase Auth, …). The scaffold's stub **throws until you do this**, so a
> fresh install is never silently insecure.
>
> Trusting a client-supplied id is the IDOR bug that lets one user read another
> user's chats. The package is designed so this is *unrepresentable* once you
> wire up `getChatUserId`. **Read [SECURITY.md](./SECURITY.md).**

## Quick Start

```bash
# 1. Install
npm install @mordn/chat-widget @ai-sdk/react drizzle-kit

# 2. Run the setup wizard
npx @mordn/chat-widget
```

The wizard creates exactly four files:

- `app/api/chat/[[...chat]]/route.ts` — one catch-all that mounts the whole backend
- `lib/chat-auth.ts` — the `getChatUserId` stub **you implement** (the security boundary)
- `drizzle.config.ts` — points at the package's chat schema
- `.env.example`

## Requirements

Peer dependencies (you provide these in your app):

- **Next.js** 14, 15, or 16 (App Router)
- **React** 18 or 19
- **`ai`** v5 or v6 (Vercel AI SDK)
- **`@ai-sdk/react`** v3 — the AI SDK's React bindings the widget renders with
  (install it alongside `ai`)
- **`drizzle-orm`** ^0.44 and **`postgres`** ^3.4 — only if you use the default
  Drizzle store (skip if you bring your own `ChatStore`)
- A **PostgreSQL** database (Supabase recommended) — for the default store
- An AI provider package for your model, e.g. **`@ai-sdk/anthropic`**

Styling ships pre-scoped in `@mordn/chat-widget/styles.css` — you do **not**
need Tailwind in your app to use the widget.

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env.local` and fill in your credentials (see the file
for the full list — `DATABASE_URL`, and the Supabase keys if you keep uploads).

### 2. Implement the auth boundary

Open `lib/chat-auth.ts` and replace the throwing stub with your real session
lookup:

```ts
// Clerk example
import { auth } from '@clerk/nextjs/server';

export async function getChatUserId() {
  const { userId } = await auth();   // from the verified session — never a header
  return userId;
}
```

### 3. Database Setup

```bash
npx drizzle-kit push   # creates chat_conversations + chat_messages
```

### 4. Configure your model and tools

Everything is configured in the single `route.ts` the wizard created — model,
system prompt, store, storage, and tools:

```ts
export const { GET, POST, DELETE } = createChatHandler({
  getUserId: getChatUserId,
  model: anthropic('claude-sonnet-4-5'),
  store: createDrizzleChatStore(),       // or bring your own ChatStore
  storage: createSupabaseStorage(),      // or bring your own StorageAdapter
  // buildTools: async (ctx) => ({ tools: { /* ... */ }, cleanup: async () => {} }),
});
```

**Bring your own database / storage:** pass a custom `store` / `storage` that
implement the `ChatStore` / `StorageAdapter` interfaces from
`@mordn/chat-widget/server`. The hosted defaults and your own implementations
are interchangeable — same handler, same security.

## Mount the widget (client)

```tsx
'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

export default function Assistant({ userId }: { userId: string }) {
  return (
    <ChatWidget
      userId={userId}                 // your app's user id (for the client)
      theme={{ mode: 'light' }}       // 'light' | 'dark'
      features={{ fileUpload: true }} // needs `storage` configured on the handler
      display={{ layout: 'popup', size: 'default', resizable: true }}
      starterPrompts={[
        { title: 'What can you help me with?' },
        { title: 'How do I get started?' },
      ]}
    />
  );
}
```

> The widget sends `userId` as an `X-User-Id` header for convenience, but the
> **server ignores it for authorization** — your `getChatUserId` is the only
> source of identity. See the security note above.

---

## Script-tag embed (any site)

No React and no bundler? Docs sites built with MkDocs, Sphinx, Hugo, Jekyll,
VitePress, Docusaurus, or plain HTML can embed the widget with a single script
tag. The `dist/embed.global.js` bundle is self-contained — **React and the whole
widget are compiled in**, so the host page needs nothing installed.

You still run your own chat handler (see [Setup](#setup)); the embed is just a
framework-free way to mount the client against it.

### Declarative (one tag, no JavaScript)

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-api-base="https://your-app.com/api/chat"
  data-agent-id="docs-bot"
></script>
```

The widget mounts itself once the page is ready. Available shortcut attributes,
each mapping to the same config key you'd pass in React: `data-user-id`,
`data-agent-id`, `data-api-base`, `data-model`, `data-target` (a CSS selector to
mount into), and `data-css-url`. For any field not covered by a shortcut, pass a
full JSON config in `data-config`:

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-config='{"apiBase":"https://your-app.com/api/chat","theme":{"mode":"dark"},"display":{"layout":"popup"},"starterPrompts":[{"title":"How do I get started?"}]}'
></script>
```

Precedence: `data-config` is the base and individual `data-*` shortcuts overlay
it, so you can share one JSON blob and override a single field per page.

### Imperative (`window.MordnChat`)

Omit the data attributes and drive it yourself. `init` accepts the same config
object as the React `<ChatWidget>` props and returns a handle:

```html
<script src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"></script>
<script>
  const chat = MordnChat.init({
    apiBase: 'https://your-app.com/api/chat',
    agentId: 'docs-bot',
    theme: { mode: 'light' },
    display: { layout: 'popup', size: 'default' },
  });

  // Drive it programmatically:
  chat.open();
  chat.close();
  chat.toggle();
  chat.destroy(); // unmount and remove the container

  // The same methods are also available on the global directly:
  MordnChat.open();
</script>
```

`init` is idempotent — calling it again tears down the previous mount first, so
it's safe to re-init after a client-side route change on a docs SPA.

### Anonymous visitors

Docs readers usually aren't logged in, so `userId` is optional here. When you
omit it, the embed generates a persistent `anon-…` id and stores it in
`localStorage` so a visitor's conversation history survives reloads. As with the
React path, this id is a client-side scoping key only — **your `getChatUserId`
on the server remains the identity boundary** (see the security note above).

### Bundle size and CSP

- The bundle includes React, ReactDOM, and the widget (estimated ~250–400 KB
  gzipped). You do **not** need React on the host page. Code highlighting
  (shiki) is not bundled — it lazy-loads from a CDN only if a response contains
  a code block, and falls back to plain text if that load is blocked.
- The widget's CSS is injected once into a `<style data-mordn-chat>` tag, so a
  strict Content-Security-Policy needs `style-src 'unsafe-inline'` (or serve the
  stylesheet yourself and set `data-css-url` / `cssUrl` to link it, which uses
  the CDN/self-hosted fallback path instead). The styles are pre-scoped to
  `.chat-widget-container`, so they never leak into the host page.

---

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
| `model` | yes | A `LanguageModel`, or `(ctx) => LanguageModel` for per-user selection. |
| `store` | no* | A `ChatStoreFactory`. Use `createDrizzleChatStore()` or your own. *Required until a hosted default ships.* |
| `storage` | no | A `StorageAdapterFactory` (e.g. `createSupabaseStorage()`). Omit to disable uploads. |
| `buildTools(ctx)` | no | `async (ctx) => ({ tools, cleanup? })`. `cleanup` is called exactly once per turn (finish/error/abort) — use it to close per-request resources like an MCP client. |
| `buildSystemPrompt(ctx)` | no | Returns the system prompt; receives the request context to personalise. |
| `transformMessages(msgs, ctx)` | no | Last-chance rewrite of model messages (e.g. image part handling). |
| `compression` | no | Toggle Headroom token compression — `true` or a `CompressionConfig`. Shrinks large tool outputs / context before the model call; **off by default**. Needs a running [Headroom](https://github.com/headroomlabs-ai/headroom) endpoint (`HEADROOM_BASE_URL`). Falls through to uncompressed on any error. See [Token compression](#token-compression-headroom). |
| `onChatFinish(info)` | no | Post-persist hook for telemetry/usage. |
| `onError(err)` | no | Map a stream error to the user-facing string. |
| `stopWhen` | no | AI SDK stop condition for tool-call loops (default: bounded step count). |
| `upload` | no | `{ allowedMediaTypes?, maxBytes? }` — server-side upload policy. |
| `maxHistoryMessages` | no | Sliding-window size sent to the model (default 30). |

The widget exposes only these seams. Ownership checks, idempotent persistence,
history pagination, attachment re-signing, and socket teardown are owned by the
handler and are not configurable — getting them wrong is a bug, not a setting.

---

## Token compression (Headroom)

Long sessions, big tool outputs, and RAG context burn tokens fast. The widget
can compress the model-bound payload with
[Headroom](https://github.com/headroomlabs-ai/headroom) — a local-first
compression layer (60–95% fewer tokens on tool-heavy workloads) — without
changing how you write tools or prompts.

It is **off by default** and **safe by design**: compression runs as the very
last step before the model call, and if the Headroom endpoint is unset,
unreachable, slow, or returns anything unexpected, the turn proceeds
**uncompressed**. It can never break a chat.

### Turn it on

1. Run a Headroom service and note its URL (local dev default is
   `http://localhost:8787`):

   ```bash
   pip install "headroom-ai[all]"
   headroom proxy --port 8787
   ```

2. Point the widget at it and flip the toggle:

   ```env
   # .env.local
   HEADROOM_BASE_URL="http://localhost:8787"
   # HEADROOM_API_KEY="..."   # only if your Headroom deployment requires auth
   ```

   ```ts
   createChatHandler({
     getUserId: getChatUserId,
     model: anthropic('claude-sonnet-4-5'),
     store: createDrizzleChatStore(),
     compression: true, // ← that's it
   });
   ```

Tool outputs (JSON), code, and prose are each routed to the right Headroom
compressor. Only opaque text payloads are rewritten — tool calls, tool-call
ids, tool names, image/file parts, and message ordering are preserved exactly.

### Configure it

Pass a `CompressionConfig` instead of `true` for full control:

```ts
compression: {
  enabled: true,
  baseUrl: process.env.HEADROOM_BASE_URL, // default: env, then http://localhost:8787
  apiKey: process.env.HEADROOM_API_KEY,   // default: env HEADROOM_API_KEY
  timeoutMs: 5000,    // hot-path budget; on timeout we pass through (default 5000)
  minChars: 2000,     // skip the round-trip below this combined size (default 2000)
  tokenBudget: 60000, // optional: compact to fit a hard token budget
  onResult: (r) => {  // optional: observe savings per turn
    if (r.compressed) {
      console.log(`[headroom] saved ${r.tokensSaved} tokens (${Math.round((1 - r.compressionRatio) * 100)}%)`);
    }
  },
},
```

**Toggle from the dashboard.** `compression` follows the same
**code > hosted > off** precedence as `model` and the system prompt, so when you
use `getHostedConfig`, returning `{ compression: true }` from your control plane
turns it on for an agent with no redeploy. A value set in code always wins.

**Bring your own compressor.** Pass `compression.compress` — any
`(messages, ctx) => ModelMessage[]` — to use the
[`headroom-ai`](https://www.npmjs.com/package/headroom-ai) SDK directly, or a
different engine entirely:

```ts
import { compress } from 'headroom-ai';

compression: {
  enabled: true,
  compress: async (messages) => (await compress(messages)).messages,
},
```

---

## Exports

```ts
// Client component + styles
import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

// Server handler + the pluggable contracts (server-only)
import {
  createChatHandler,
  type ChatStore, type ChatStoreFactory,
  type StorageAdapter, type StorageAdapterFactory,
  ConversationOwnershipError,
} from '@mordn/chat-widget/server';

// Default Postgres/Drizzle store (server-only)
import { createDrizzleChatStore, schema } from '@mordn/chat-widget/server/drizzle';

// Default Supabase storage adapter (server-only)
import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';
```

---

## License

MIT

