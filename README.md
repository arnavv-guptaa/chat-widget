# @mordn/chat-widget

A secure-by-default AI chat widget for React / Next.js. One component, one
route, one agent config — identity and persistence stay server-side.

[![npm version](https://img.shields.io/npm/v/@mordn/chat-widget?label=@mordn/chat-widget)](https://www.npmjs.com/package/@mordn/chat-widget)
[![npm](https://img.shields.io/npm/dm/@mordn/chat-widget)](https://www.npmjs.com/package/@mordn/chat-widget)
[![license](https://img.shields.io/npm/l/@mordn/chat-widget)](./LICENSE)

**Docs** — [Quickstart](https://mordn.com/docs/quickstart) · [Security](https://mordn.com/docs/security) · [Backends](https://mordn.com/docs/backends/overview) · [API](https://mordn.com/docs/api/create-chat-handler) · [CLI](https://mordn.com/docs/api/cli)

## Quickstart (5 minutes)

The CLI scaffolds the whole backend: one catch-all route + an auth stub you
implement. The route owns identity, persistence, and model execution; the
component is only the surface.

```bash
# 1. Install
npm install @mordn/chat-widget ai @ai-sdk/react
npx @mordn/chat-widget            # scaffolds route + auth stub + drizzle config
npm install @ai-sdk/anthropic     # swap for your provider (@ai-sdk/openai, @ai-sdk/google, …)

# 2. Implement the ONE security boundary — lib/chat-auth.ts
#    (returns a verified server-session id, or null; see below)

# 3. Create the chat tables
npx drizzle-kit push

# 4. Mount the widget
```

```tsx
// app/components/assistant.tsx
'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

export default function Assistant() {
  return <ChatWidget apiBase="/api/chat" />; // must match the route, defaults to /api/chat
}
```

Done. Open the page, type a message. Styles are prebuilt and scoped to
`.chat-widget-container` — **no Tailwind required.**

> The scaffolded route uses the **Drizzle** store + **Supabase** storage by
> default. To use the hosted offering instead, swap `createChatHandler` for
> `createMordnHandler` (one line) — see [Backends](#backends).

## The one rule — `getChatUserId`

`getChatUserId` is the authorization boundary. Derive it from a verified
**server** session (Clerk `auth()`, NextAuth `getServerSession()`,
`supabase.auth.getUser()`). Return `null` when unauthenticated. **Never** read
identity from a header, query param, or request body — those are forgeable and
let any user read another user's conversations (IDOR).

The scaffold ships a stub that **throws until you implement it**, so the
default is never silently insecure.

```ts
// lib/chat-auth.ts — the file the CLI creates
export async function getChatUserId(request: Request): Promise<string | null> {
  // Clerk:    const { userId } = await auth();           return userId;
  // NextAuth: const s = await getServerSession(opts);    return s?.user?.id ?? null;
  // Supabase: const { data: { user } } = await sb.auth.getUser(); return user?.id ?? null;
  throw new Error('implement me — see examples above');
}
```

Store and storage factories are constructed **per request** with the
server-verified id, so cross-user access is *unrepresentable* rather than
merely checked. The client sends no `userId`, `agentId`, model, prompt, or
config headers: the widget calls `GET /api/chat/bootstrap` on mount and gets
back only what the browser may see. See [SECURITY.md](./SECURITY.md).

## Backends — hosted or bring-your-own

```ts
// ── Hosted (default for the dashboard / published-config model) ───────────
import { createMordnHandler } from '@mordn/chat-widget/server';

export const { GET, POST, DELETE, OPTIONS } = createMordnHandler({
  apiKey: process.env.MORDN_CHAT_KEY!,
  getUserId: getChatUserId, // same boundary
});

// ── Bring your own DB + storage (what the CLI scaffolds) ───────────────────
import { createChatHandler } from '@mordn/chat-widget/server';
import { createDrizzleChatStore } from '@mordn/chat-widget/server/drizzle';
import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';
import { anthropic } from '@ai-sdk/anthropic';

export const { GET, POST, DELETE } = createChatHandler({
  getUserId: getChatUserId,
  model: anthropic('claude-sonnet-4-5'),
  store: createDrizzleChatStore(),
  storage: createSupabaseStorage(),
  buildSystemPrompt: () => 'You are a helpful assistant.',
  // buildTools: async (ctx) => ({ tools: { /* … */ }, cleanup: async () => {} }),
});
```

| Store | Import path | When to use |
| --- | --- | --- |
| Hosted | `@mordn/chat-widget/server` → `createMordnHandler` | Published config + hosted persistence, zero infra |
| Drizzle (Postgres) | `@mordn/chat-widget/server/drizzle` → `createDrizzleChatStore` | Your own Postgres (Supabase, Neon, RDS) |
| Supabase storage | `@mordn/chat-widget/server/supabase` → `createSupabaseStorage` | Private-bucket attachments + signed URLs |
| Custom | implement `ChatStore` / `StorageAdapter` | Any DB / object store |

Full backend guide: [mordn.com/docs/backends/overview](https://mordn.com/docs/backends/overview).

## Script-tag embed (no build step)

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-api-base="https://your-app.com/api/chat"
></script>
```

Same bootstrap flow — identity and agent selection stay server-side.

## Config

`AgentConfig` is versioned, JSON-serializable, and shared by the control plane,
handler, and preview transport. **Data only**: no React nodes, functions,
credentials, or endpoint URLs. Production handlers ignore request config; owner
previews opt in via `resolvePreviewConfig`.

```ts
import type { AgentConfig } from '@mordn/chat-widget';

const config: AgentConfig = {
  schemaVersion: 1,
  runtime: { model: 'anthropic/claude-sonnet-4-5', temperature: 0.3 },
  client: { greeting: 'How can I help?', display: { layout: 'popup' } },
};
```

## What's exported

The main entry is the browser surface. Server-only code lives behind the
`/server` subpaths (guarded by `server-only` — importing it into a client
bundle is a build error).

| Surface | Import | What you get |
| --- | --- | --- |
| Widget | `@mordn/chat-widget` | `ChatWidget`, `AgentConfig` types, hooks, UI primitives |
| Styles | `@mordn/chat-widget/styles.css` | Prebuilt, scoped to `.chat-widget-container` |
| Server core | `@mordn/chat-widget/server` | `createChatHandler`, `createMordnHandler`, `ChatStore` / `StorageAdapter` contracts |
| Drizzle store | `@mordn/chat-widget/server/drizzle` | `createDrizzleChatStore` |
| Supabase storage | `@mordn/chat-widget/server/supabase` | `createSupabaseStorage` |
| Hosted store | `@mordn/chat-widget/server/hosted` | hosted persistence adapters |
| Knowledge (RAG) | `@mordn/chat-widget/server/knowledge` | `KnowledgeStore`, `Retriever`, embedder, ingestion |
| Memory | `@mordn/chat-widget/server/memory` | `MemoryAdapter` (+ `/drizzle`, `/hosted`, `/mem0`) |
| MCP | `@mordn/chat-widget/server/mcp` | Model Context Protocol tool wiring |
| Actions | `@mordn/chat-widget/actions` | `MordnActionConfig`, vertical templates (docs, ecommerce, lead capture, …) |
| Charts | `@mordn/chat-widget` | `ChartBlock`, `chartToolRenderer`, `ChartSpec` (trusted in-transcript charts) |
| Config types | `@mordn/chat-widget/config` | `AgentConfig`, `isAgentConfig`, bootstrap types |
| DB schema | `@mordn/chat-widget/db` · `/schema` | drizzle schema, table defs |
| CLI | `npx @mordn/chat-widget` | `init` (scaffold), `ingest`, `sync`, `status`, `list`, `eval` |

## CLI

```bash
npx @mordn/chat-widget            # scaffold the backend (default)
npx @mordn/chat-widget ingest     # ingest docs / URLs / llms.txt into a namespace
npx @mordn/chat-widget sync       # re-ingest a config's sources (idempotent)
npx @mordn/chat-widget status     # per-source chunk counts
npx @mordn/chat-widget list       # list sources in a namespace
npx @mordn/chat-widget eval       # run a retrieval eval suite (CI gate)
```

Full CLI reference: [mordn.com/docs/api/cli](https://mordn.com/docs/api/cli).

## Docs

| | |
| --- | --- |
| [Quickstart](https://mordn.com/docs/quickstart) | Scaffold the backend, mount the widget |
| [Security](https://mordn.com/docs/security) | The identity boundary and its guarantees |
| [Backends](https://mordn.com/docs/backends/overview) | Hosted, Drizzle, Supabase, custom |
| [Theming](https://mordn.com/docs/guides/theming) · [Context](https://mordn.com/docs/guides/context) | Appearance, page awareness |
| [Models & tools](https://mordn.com/docs/guides/models-and-tools) · [MCP](https://mordn.com/docs/guides/mcp) | Model selection, tool wiring |
| [Actions](https://mordn.com/docs/guides/build-actions) · [Templates](https://mordn.com/docs/guides/action-templates) | Doing things, not just answering |
| [Knowledge](https://mordn.com/docs/guides/knowledge) | RAG ingestion, retrieval, CI evals |
| [Attachments](https://mordn.com/docs/guides/attachments) · [Persistence](https://mordn.com/docs/guides/persistence) · [Memory](https://mordn.com/docs/guides/memory) | State |
| [Production](https://mordn.com/docs/guides/production-readiness) | Ship checklist |
| [ChatWidget](https://mordn.com/docs/api/chat-widget) · [Handler](https://mordn.com/docs/api/create-chat-handler) · [Exports](https://mordn.com/docs/api/exports) | Every option |

In-repo: [index freshness](./docs/keep-your-index-fresh.md), [action templates](./docs/action-templates.md), [SECURITY.md](./SECURITY.md), [CHANGELOG.md](./CHANGELOG.md), [RELEASING.md](./RELEASING.md).

## Built with

| | |
| --- | --- |
| Language | TypeScript |
| Build | tsup |
| Styles | Tailwind v4 (prebuilt + scoped, no consumer Tailwind needed) |
| Server | Next.js App Router (catch-all route), Node runtime |
| AI SDK | Vercel AI SDK (`ai`, `@ai-sdk/*`) |
| UI | React 18 / 19, Radix UI, lucide-react |
| Markdown | streamdown, shiki, mermaid |
| DB / ORM | Drizzle ORM (Postgres), Supabase |
| Auth | Your session (Clerk / NextAuth / Supabase Auth) — see `getChatUserId` |

## License

MIT
