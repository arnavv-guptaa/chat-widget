# Action templates and generative GUI primitives

This package now exposes the first foundation for vertical assistants: typed action configs, template manifests, and reusable action-backed UI primitives.

This is intentionally a foundation slice, not a hosted execution plane. It lets host apps and future dashboard work agree on names, schemas, cards, forms, and risk levels before chat-api executes arbitrary customer webhooks.

## Design rules

- Treat all action payloads as untrusted until a server handler validates them.
- Keep browser identity out of the trust boundary; server actions must use `getUserId` / `getChatUserId` verified identity.
- Use confirmation for consequential actions such as lead submission, booking requests, cart mutation, or CRM writes.
- Do not collect payment card data in chat. Hand off to a secure provider or host-owned checkout.
- Build verticals from generic primitives. Do not create one-off restaurant, ecommerce, or travel UI that cannot be reused.

## Public concepts

- `MordnActionConfig` describes an action attached to a button, chip, form, card, or template.
- `MordnActionDispatcher` is the host callback that receives action events.
- `MordnTemplateManifest` describes a vertical template such as docs, lead capture, services booking, restaurant, ecommerce, or travel.
- `defaultMordnTemplates` contains starter manifests for the first template gallery and docs examples.

## First UI primitives

- `ActionButton`
- `ActionChips`
- `ActionForm`
- `EntityCard`
- `EntityCarousel`
- `SummaryCard`
- `ConfirmationCard`
- `StatusTracker`

These are token-driven and scoped to the widget surface. They are useful immediately for custom renderers, demos, and future template previews.

## Example

```tsx
import {
  ActionForm,
  EntityCarousel,
  leadCaptureTemplate,
  type MordnActionDispatcher,
} from '@mordn/chat-widget';

const onAction: MordnActionDispatcher = async ({ action, values }) => {
  if (action.type === 'lead.capture') {
    // Validate again on the server before mutating anything.
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
  }
};

<ActionForm
  title="Book a demo"
  description="Tell us where to follow up."
  action={leadCaptureTemplate.actions[0]}
  onAction={onAction}
  fields={[
    { name: 'email', label: 'Work email', type: 'email', required: true },
    { name: 'company', label: 'Company' },
    { name: 'message', label: 'What are you trying to do?', type: 'textarea', required: true },
  ]}
/>
```

## Template posture

The included templates are safe starter manifests:

- `docs-assistant`
- `lead-capture`
- `services-booking`
- `restaurant-assistant`
- `ecommerce-concierge`
- `travel-planner`

Restaurant, ecommerce, and travel actions are deliberately phrased as request or handoff flows unless the host wires real inventory, booking, cart, or payment systems. The widget should never imply a confirmed reservation, purchase, or payment unless the action result proves it.

## Generative GUI runtime

The primitives above are exported building blocks. To render them *inside the
conversation* from an assistant response — the "GUI ability" of the chat — the
widget ships a small runtime.

### 1. Emit a GUI spec from the assistant

An assistant can produce a serialisable `MordnGuiSpec` two ways:

- a `data-mordn-ui` **data part** streamed on the message, or
- a tool named **`mordn_ui`** whose output is the spec.

A spec is a small, closed, JSON-only union — `kind` selects the primitive,
the rest is its data:

```ts
// A menu carousel with an action on each card.
{
  kind: 'entity-carousel',
  label: 'Popular dishes',
  items: [
    {
      id: 'margherita',
      title: 'Margherita',
      price: '$14',
      subtitle: 'San Marzano, fior di latte, basil',
      actions: [{ label: 'Add to order', action: { type: 'restaurant.order.add', handler: 'server', payload: { id: 'margherita' } } }],
    },
  ],
}

// A booking confirmation (consequential → confirmation gate).
{
  kind: 'confirmation-card',
  title: 'Request this reservation?',
  description: 'Fri 8:00 PM · party of 4',
  action: { type: 'restaurant.reservation.request', handler: 'server', confirmation: 'required', payload: { time: '20:00', size: 4 } },
}
```

The widget maps the spec to the matching primitive via `MordnGuiPart`. It is
**safe by construction**: `kind` is a fixed allowlist, there is no path to
arbitrary HTML/JSX, every URL flows through `safeUrl`, and an unknown or
malformed spec renders nothing (it never throws, and a `mordn_ui` tool falls
through to the default tool row).

### 2. Handle the actions those primitives emit

Pass `onAction` to `<ChatWidget>`. The widget resolves each action in order:

1. **Your `onAction`** runs first. Return a `MordnActionResult` to fully own it;
   return nothing to observe and let the built-ins run.
2. **Built-in client actions** (no wiring): `mordn.ui.open_url` opens a safe URL;
   `mordn.ui.send_message` sends `payload.text` as a normal user turn.
3. **`handler: 'server' | 'hosted'`** actions POST to `${apiBase}/v1/action`.

```tsx
<ChatWidget
  userId={userId}
  onAction={async ({ action, values }) => {
    if (action.type === 'lead.capture') {
      await myApi.saveLead(values);
      return { status: 'success', message: 'Thanks — we\'ll be in touch.' };
    }
    // return nothing → widget applies built-in client behavior / server POST
  }}
/>
```

Consequential actions (`server`/`hosted`, or `risk: 'mutation' | 'regulated'`)
are gated while a turn is streaming so nothing mutates behind a rendering answer.

### 3. Execute server actions behind the verified identity

Wire `onAction` on `createChatHandler`. The route resolves the **verified** user
(the browser-sent `X-User-Id` is never trusted), and hands you the invocation:

```ts
export const { GET, POST, DELETE } = createChatHandler({
  getUserId,
  model,
  store,
  onAction: async (invocation, ctx) => {
    // invocation.payload is UNTRUSTED — validate before acting.
    if (invocation.type === 'lead.capture') {
      const lead = parseLead(invocation.payload); // your validation
      await db.leads.insert({ ...lead, userId: ctx.userId });
      return { status: 'success', message: 'Saved' };
    }
    return { status: 'error', errorCode: 'unknown_action' };
  },
});
```

With no `onAction` seam the `/v1/action` route cleanly no-ops (`{status:'success'}`),
so a GUI-enabled widget never errors against a backend that hasn't wired actions
yet. An action failure is swallowed and returned as `{status:'error'}` — it never
500s the chat.

## Custom GUI renderers

To render a bespoke card for one `kind` while keeping the built-ins for the rest,
pass `uiRenderers` keyed by kind; return `null` to defer to the built-in:

```tsx
<ChatWidget
  uiRenderers={{ 'entity-card': (spec, onAction) => <MyProductCard spec={spec} onAction={onAction} /> }}
/>
```

## Follow-up work

Future PRs should wire these contracts into:

1. ~~`createChatHandler` server action dispatch.~~ ✅ Shipped: `onAction` seam +
   `/v1/action` route + client dispatch + `MordnGuiPart` render bridge.
2. chat-api hosted action definitions and execution.
3. chat-web template gallery and action editor.
4. action analytics and audit logs.
