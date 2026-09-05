# Custom message-part renderers

`ChatWidget.messagePartRenderers` is an optional **host React-code-only** map of exact custom AI SDK `data-*` part types to render callbacks. It adds inline cards without replacing the stock message renderer or importing another rendering bundle.

```tsx
'use client';
import { ChatWidget, type MessagePartRenderers } from '@mordn/chat-widget';
import { accountLookupRenderers } from './account-lookup';
import '@mordn/chat-widget/styles.css';

export function SupportChat() {
  return <ChatWidget messagePartRenderers={accountLookupRenderers} />;
}
```

See [the complete account lookup card](./examples/account-lookup.tsx). Copy it into your host app and change its type import to `@mordn/chat-widget`. It validates unknown input, renders strings as escaped React text, and inherits the widget's color tokens without requiring the host to compile Tailwind. The example is not imported by the widget's default bundle.

## Contract

```ts
(part: MessageDataPart, context: MessagePartRendererContext) => ReactNode | null
```

- `part` carries `{ type: 'data-…', id?: string, data: unknown }`. Validate the payload in host code before reading it. No schema or server adapter changes are implied.
- `context` carries `messageId`, `role`, and `isStreaming`. Streaming is true only for the last assistant message while status is `streaming`; false for user/system messages, submitted/error states, completed messages, and history/replay.
- Exact own-property registrations only; no wildcard/default renderer. Empty `data-` types, missing-data envelopes and non-function map entries are ignored.
- Text/markdown, citations/sources, reasoning, attachments, static/dynamic tools, tool approvals and action renderers retain their existing paths. `data-follow-ups`, `data-thread-title`, and `data-chat-error` are reserved metadata, never dispatched to this seam, even if accidentally supplied through initial messages or history.
- Missing registration or a `null`/`undefined` result silently omits the custom part. There is no raw JSON fallback that might leak private payload fields. Supply adjacent ordinary text if older clients need a readable fallback.
- Registered custom parts participate in transcript ordering and take ownership from the pre-content planning indicator, even if the callback elects to render nothing. Unregistered metadata does not dismiss planning or change the last built-in streaming part.
- All roles use the same dispatch contract. Assistant cards appear in part order alongside text/reasoning/tools; attachments and sources keep their existing placement. Live messages, initial messages, loaded history pages and replayed message objects all use this same rendering path.

## Producing and persisting a part

An authorized host stream producer can emit a persistent AI SDK UI data part such as:

```ts
writer.write({
  type: 'data-account-lookup',
  id: 'account-42',
  data: { accountId: 'acct_42', name: 'Acme', plan: 'Business' },
});
```

This is an AI SDK writer example, not a new widget handler API. Use a producer that supports custom UI data parts. Persist the SDK-reconciled message `parts` array if the card should survive history/replay, not the raw stream event log. `transient: true` stream events do not become SDK message parts and must never be persisted; the renderer also ignores any such event accidentally passed as a part. Internal `data-chat-error` guidance is transient metadata, not transcript content. The renderer does not write to storage or sanitize a host's persistence layer. Repeated updates to a part with a stable id should be reconciled by the producer/SDK; the widget does not append a duplicate history-only representation.

The handler now treats eligible, non-transient custom data parts as assistant content, so a reconciled data-only reply is eligible for persistence and history replay. Control-only or transient-only replies are not eligible through this rule. This does not add a custom-part writer option to the stock handler: use an authorized producer that supports the SDK writer seam. Rendering supplied client data alone does not persist it or establish its authority, and custom stores still own their persistence implementation.

## Boundaries and lifecycle

The map is not part of `AgentConfig`, `PublishedAgentConfig`, bootstrap JSON, dashboard settings, or declarative script-tag JSON. Do not serialize React functions or accept renderer source code from a model/server. Pass the map directly from a client component; functions cannot cross a React Server Component serialization boundary.

This is presentation only, **not server authority**. The context is not authentication, an account card is not proof of entitlement, and a data part cannot approve a tool, authorize an account lookup, or change runtime policy. Server-side access control must decide what data may be returned. Any separate card action must use an authenticated, authorized host endpoint.

Keep render callbacks synchronous, pure, and SSR-safe. They may run repeatedly during streaming or replay; never perform fetches, approvals, or side effects while rendering. Return a component to use hooks (do not call hooks directly inside the callback). Exceptions follow the host's React error boundary, as with `toolRenderers`; validate malformed payloads and return null deliberately. For SSR, avoid browser globals during render and produce deterministic initial markup.

Use a module-level map or `useMemo`. Replace the map when changing renderers; in-place mutation is intentionally not detected by the widget's shallow memo boundaries. New message/parts references from streaming cause updates as before. Host theme tokens and existing SSR behavior are unchanged.
