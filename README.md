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
npm install @mordn/chat-widget drizzle-kit

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
| `onChatFinish(info)` | no | Post-persist hook for telemetry/usage. |
| `onError(err)` | no | Map a stream error to the user-facing string. |
| `stopWhen` | no | AI SDK stop condition for tool-call loops (default: bounded step count). |
| `upload` | no | `{ allowedMediaTypes?, maxBytes? }` — server-side upload policy. |
| `maxHistoryMessages` | no | Sliding-window size sent to the model (default 30). |

The widget exposes only these seams. Ownership checks, idempotent persistence,
history pagination, attachment re-signing, and socket teardown are owned by the
handler and are not configurable — getting them wrong is a bug, not a setting.

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

