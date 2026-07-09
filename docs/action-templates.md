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

## Follow-up work

Future PRs should wire these contracts into:

1. `createChatHandler` server action dispatch.
2. chat-api hosted action definitions and execution.
3. chat-web template gallery and action editor.
4. action analytics and audit logs.
