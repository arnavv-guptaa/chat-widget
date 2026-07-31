# @mordn/chat-widget

A secure-by-default AI chat widget for React/Next.js: one component, one route, one agent config.

**[Docs](https://mordn.com/docs)** · [Quickstart](https://mordn.com/docs/quickstart) · [Security](https://mordn.com/docs/security) · [API](https://mordn.com/docs/api/create-chat-handler)

## Install

```bash
npm install @mordn/chat-widget ai @ai-sdk/react
```

Styles are prebuilt and scoped to `.chat-widget-container`. No Tailwind needed.

## Setup

The route owns identity, persistence, and model execution. The component is only the surface.

```ts
// app/api/chat/[[...chat]]/route.ts
import { createMordnHandler } from '@mordn/chat-widget/server';
import { auth } from '@clerk/nextjs/server';

export const { GET, POST, DELETE, OPTIONS } = createMordnHandler({
  apiKey: process.env.MORDN_CHAT_KEY!,
  getUserId: async () => (await auth()).userId,
});
```

```tsx
// components/assistant.tsx
'use client';

import { ChatWidget } from '@mordn/chat-widget';
import '@mordn/chat-widget/styles.css';

export default function Assistant() {
  return <ChatWidget apiBase="/api/chat" />; // must match the route path, defaults to /api/chat
}
```

```env
AI_GATEWAY_API_KEY="..."  # runs runtime.model gateway strings
MORDN_CHAT_KEY="..."      # published config + hosted persistence
```

Models execute in your route, so the route needs its own credential. Without the AI SDK gateway, install a provider package, set its key, and pass `model` in code.

For your own database and storage, swap `createMordnHandler` for `createChatHandler` with a `store`, optional `storage`, and a code `model`. See [backends](https://mordn.com/docs/backends/overview).

## The one rule

`getUserId` is the authorization boundary. Derive it from a verified server session; return `null` when unauthenticated. Never read identity from a header, query param, or body.

Store and storage factories are constructed per request with the server-verified id, so cross-user access is unrepresentable rather than merely checked. The client sends no `userId`, `agentId`, model, prompt, or config headers: the widget calls `GET /api/chat/bootstrap` on mount and gets back only what the browser may see. See [SECURITY.md](./SECURITY.md).

## Config

`AgentConfig` is versioned, JSON-serializable, and shared by control plane, handler, and preview transport. Data only: no React nodes, functions, credentials, or endpoint URLs.

```ts
import type { AgentConfig } from '@mordn/chat-widget';

const config: AgentConfig = {
  schemaVersion: 1,
  runtime: { model: 'anthropic/claude-sonnet-4-5', temperature: 0.3 },
  client: { greeting: 'How can I help?', display: { layout: 'popup' } },
};
```

Production handlers ignore request config. Owner previews opt in via `resolvePreviewConfig`.

## Script-tag embed

```html
<script
  src="https://unpkg.com/@mordn/chat-widget/dist/embed.global.js"
  data-api-base="https://your-app.com/api/chat"
></script>
```

Same bootstrap flow: identity and agent selection stay server-side.

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
| [CLI](https://mordn.com/docs/api/cli) | `npx @mordn/chat-widget`: scaffold, ingest, eval |

In-repo: [index freshness](./docs/keep-your-index-fresh.md), [action templates](./docs/action-templates.md), [SECURITY.md](./SECURITY.md), [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
