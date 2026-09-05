# Package reference

This page keeps the detailed package inventory out of the project README. For guided integration instructions, use the [hosted quickstart](https://mordn.com/docs/quickstart), [self-managed quickstart](https://mordn.com/docs/quickstart/self-host), or [full documentation](https://mordn.com/docs).

## Backends

```ts
// Hosted: published config and hosted production infrastructure
import { createMordnHandler } from '@mordn/chat-widget/server';

export const { GET, POST, DELETE, OPTIONS } = createMordnHandler({
  apiKey: process.env.MORDN_CHAT_KEY!,
  getUserId,
});

// Self-managed: your model, database, and object storage
import { createChatHandler } from '@mordn/chat-widget/server';
import { createDrizzleChatStore } from '@mordn/chat-widget/server/drizzle';
import { createSupabaseStorage } from '@mordn/chat-widget/server/supabase';
import { anthropic } from '@ai-sdk/anthropic';

export const { GET, POST, DELETE } = createChatHandler({
  getUserId,
  model: anthropic('claude-sonnet-4-5'),
  store: createDrizzleChatStore(),
  storage: createSupabaseStorage(),
  buildSystemPrompt: () => 'You are a helpful assistant.',
});
```

| Store or service | Import path | When to use |
| --- | --- | --- |
| Hosted | `@mordn/chat-widget/server` → `createMordnHandler` | Published config and hosted production infrastructure |
| Drizzle | `@mordn/chat-widget/server/drizzle` → `createDrizzleChatStore` | Your own Postgres, including Supabase, Neon, or RDS |
| Supabase storage | `@mordn/chat-widget/server/supabase` → `createSupabaseStorage` | Private-bucket attachments and signed URLs |
| Custom | Implement `ChatStore` or `StorageAdapter` | Any database or object store |

See the [backend guide](https://mordn.com/docs/backends/overview) for the complete contracts. Self-managed Postgres users should also read the [schema and migration notes](./self-hosted-migrations.md): the repository development config is not a consumer upgrade runner, and the hand-written SQL must be obtained and applied separately.

## Script-tag embed

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-api-base="https://your-app.com/api/chat"
></script>
```

The embed uses the same bootstrap flow. Identity and agent selection remain server-side.

## Configuration

`AgentConfig` is versioned, JSON-serializable data shared by the control plane, handler, and preview transport. It cannot contain React nodes, functions, credentials, or endpoint URLs. Production handlers ignore request config; owner previews opt in through `resolvePreviewConfig`.

```ts
import type { AgentConfig } from '@mordn/chat-widget';

const config: AgentConfig = {
  schemaVersion: 1,
  runtime: { model: 'anthropic/claude-sonnet-4-5', temperature: 0.3 },
  client: { greeting: 'How can I help?', display: { layout: 'popup' } },
};
```

## Exports

The main entry is the browser surface. Server-only code is guarded by `server-only`; importing it into a client bundle is a build error.

| Surface | Import | What it provides |
| --- | --- | --- |
| Widget | `@mordn/chat-widget` | `ChatWidget`, config types, hooks, UI primitives, charts |
| Styles | `@mordn/chat-widget/styles.css` | Prebuilt styles scoped to `.chat-widget-container` |
| Config | `@mordn/chat-widget/config` | `AgentConfig`, validation, bootstrap types |
| Actions | `@mordn/chat-widget/actions` | Action contracts and vertical templates |
| Models | `@mordn/chat-widget/models` | Model-related public types |
| Legacy database | `@mordn/chat-widget/db` and `/schema` | Legacy `conversations` / `messages` schema; not the current default ChatStore schema |
| Server core | `@mordn/chat-widget/server` | Hosted and self-managed handlers plus store contracts |
| Drizzle | `@mordn/chat-widget/server/drizzle` | Postgres chat store |
| Supabase | `@mordn/chat-widget/server/supabase` | Attachment storage adapter |
| Hosted adapters | `@mordn/chat-widget/server/hosted` | Hosted persistence adapters |
| Knowledge | `@mordn/chat-widget/server/knowledge` | Retrieval and ingestion contracts |
| Knowledge adapters | `@mordn/chat-widget/server/knowledge/drizzle` and `/hosted` | Drizzle and hosted knowledge stores |
| Memory | `@mordn/chat-widget/server/memory` | Memory contracts |
| Memory adapters | `@mordn/chat-widget/server/memory/drizzle`, `/hosted`, and `/mem0` | Drizzle, hosted, and mem0 adapters |
| MCP | `@mordn/chat-widget/server/mcp` | Model Context Protocol tool wiring |

The canonical export list is also available in the [API documentation](https://mordn.com/docs/api/exports).

## CLI

```bash
npx @mordn/chat-widget            # scaffold a self-managed backend
npx @mordn/chat-widget ingest     # ingest docs, URLs, or llms.txt
npx @mordn/chat-widget sync       # re-ingest configured sources idempotently
npx @mordn/chat-widget status     # inspect per-source chunk counts
npx @mordn/chat-widget list       # list sources in a namespace
npx @mordn/chat-widget eval       # run a retrieval evaluation suite
```

See the [CLI reference](https://mordn.com/docs/api/cli) for options and examples.

## Implementation stack

| Layer | Technology |
| --- | --- |
| Language and build | TypeScript, tsup |
| Styling | Tailwind v4, prebuilt and scoped for consumers |
| Server | Next.js App Router on the Node runtime |
| AI | Vercel AI SDK |
| UI | React 18/19, Radix UI, lucide-react |
| Rich responses | streamdown, shiki, mermaid, trusted SVG charts |
| Data | Drizzle ORM, Postgres, Supabase |
| Authentication | Your verified server session |
