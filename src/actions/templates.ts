import type { MordnTemplateManifest } from './types';

export const docsAssistantTemplate: MordnTemplateManifest = {
  id: 'docs-assistant',
  name: 'Docs Assistant',
  vertical: 'docs',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Answer documentation questions with citations, page-aware prompts, gap capture, and setup guidance.',
  starterPrompts: [
    { title: 'How do I get started?', subtitle: 'Show the setup path for this product' },
    { title: 'Ask about this page', subtitle: 'Use the current docs page as context' },
    { title: 'Show related guides', subtitle: 'Find the next docs pages I should read' },
  ],
  promptFragment:
    'You are a docs assistant. Prefer grounded answers with section citations, be honest when retrieval is weak, and offer setup-oriented next actions.',
  recommendedKnowledge: ['llms.txt', 'sitemap.xml', 'docs markdown', 'OpenAPI references'],
  cards: [
    { type: 'summary-card', label: 'Setup checklist', description: 'Show the user the ordered setup steps and progress.' },
    { type: 'handoff-card', label: 'Open docs page', description: 'Link the user to the exact cited documentation page.' },
  ],
  actions: [
    {
      type: 'docs.page.open',
      label: 'Open docs page',
      description: 'Open a cited documentation page or anchor.',
      handler: 'client',
      risk: 'ui',
      confirmation: 'none',
      schema: {
        type: 'object',
        required: ['href'],
        additionalProperties: false,
        properties: {
          href: { type: 'string', format: 'uri', title: 'URL' },
          title: { type: 'string', title: 'Title' },
        },
      },
    },
    {
      type: 'docs.question.report_gap',
      label: 'Report unanswered question',
      description: 'Capture a docs question that retrieval could not answer confidently.',
      handler: 'server',
      risk: 'capture',
      confirmation: 'none',
      schema: {
        type: 'object',
        required: ['question'],
        additionalProperties: false,
        properties: {
          question: { type: 'string', title: 'Question' },
          pageUrl: { type: 'string', format: 'uri', title: 'Page URL' },
        },
      },
    },
  ],
};

export const leadCaptureTemplate: MordnTemplateManifest = {
  id: 'lead-capture',
  name: 'Lead Capture Assistant',
  vertical: 'lead-capture',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Qualify visitors, collect contact details, summarize intent, and hand the lead to the developer’s CRM or webhook.',
  starterPrompts: [
    { title: 'Help me choose a plan', subtitle: 'Qualify needs and suggest next steps' },
    { title: 'Book a demo', subtitle: 'Collect the details sales needs' },
    { title: 'Talk to someone', subtitle: 'Capture a follow-up request' },
  ],
  promptFragment:
    'You are a concise lead qualification assistant. Ask only for what is needed, summarize before submitting, and never invent availability or pricing promises.',
  recommendedKnowledge: ['pricing page', 'product overview', 'case studies', 'FAQ', 'sales qualification criteria'],
  cards: [
    { type: 'selection-group', label: 'Qualification chips', description: 'Let visitors choose role, use case, timeline, and company size.' },
    { type: 'action-form', label: 'Lead form', description: 'Collect name, email, company, and message.' },
    { type: 'summary-card', label: 'Lead summary', description: 'Review the captured lead before submission.' },
    { type: 'handoff-card', label: 'Sales handoff', description: 'Show what happens next after submission.' },
  ],
  actions: [
    {
      type: 'lead.capture',
      label: 'Capture lead',
      description: 'Submit a qualified lead to the host application or hosted webhook.',
      handler: 'server',
      risk: 'capture',
      confirmation: 'required',
      schema: {
        type: 'object',
        required: ['email', 'message'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', title: 'Name' },
          email: { type: 'string', format: 'email', title: 'Email', redact: true },
          company: { type: 'string', title: 'Company' },
          timeline: { type: 'string', title: 'Timeline' },
          message: { type: 'string', title: 'Message' },
        },
      },
    },
  ],
};

export const servicesBookingTemplate: MordnTemplateManifest = {
  id: 'services-booking',
  name: 'Services Booking Assistant',
  vertical: 'services-booking',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Help visitors choose a service, provide intake details, and request an appointment without pretending to own live calendar inventory.',
  starterPrompts: [
    { title: 'Find the right service', subtitle: 'Compare services and what they include' },
    { title: 'Request an appointment', subtitle: 'Share preferred times and contact details' },
    { title: 'Get a rough estimate', subtitle: 'Answer a few questions first' },
  ],
  promptFragment:
    'You are a service booking assistant. Help the visitor choose a service, collect intake details, and submit a request-to-book unless a real availability action confirms a slot.',
  recommendedKnowledge: ['services page', 'availability policy', 'pricing guide', 'intake FAQ'],
  cards: [
    { type: 'entity-card', label: 'Service card', description: 'Describe a service, duration, price range, and fit.' },
    { type: 'action-form', label: 'Appointment request form', description: 'Collect preferred time, contact details, and intake notes.' },
    { type: 'summary-card', label: 'Booking request summary', description: 'Review the request before submission.' },
    { type: 'status-tracker', label: 'Request status', description: 'Show requested, received, confirmed, or needs follow-up.' },
  ],
  actions: [
    {
      type: 'services.booking.request',
      label: 'Request appointment',
      description: 'Send a request-to-book payload to the host application or hosted webhook.',
      handler: 'server',
      risk: 'capture',
      confirmation: 'required',
      schema: {
        type: 'object',
        required: ['service', 'contact'],
        additionalProperties: false,
        properties: {
          service: { type: 'string', title: 'Service' },
          preferredTime: { type: 'string', title: 'Preferred time' },
          contact: { type: 'string', title: 'Contact', redact: true },
          notes: { type: 'string', title: 'Notes' },
        },
      },
    },
  ],
  notes: ['Default template submits a request, not a confirmed booking. Only show confirmed language when the action result says confirmed.'],
};

export const restaurantAssistantTemplate: MordnTemplateManifest = {
  id: 'restaurant-assistant',
  name: 'Restaurant Assistant',
  vertical: 'restaurant',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Answer menu questions, recommend dishes, capture dietary needs, and start reservation or catering requests.',
  starterPrompts: [
    { title: 'Recommend something', subtitle: 'Ask for preferences and dietary needs' },
    { title: 'Can I reserve a table?', subtitle: 'Start a request-to-book flow' },
    { title: 'Do you have vegan options?', subtitle: 'Search menu and allergen info' },
  ],
  promptFragment:
    'You are a restaurant concierge. Be specific about menu facts, ask about dietary restrictions, and use request-to-book language unless a configured action returns a confirmed reservation.',
  recommendedKnowledge: ['menu', 'hours', 'allergen guide', 'reservation policy', 'private dining page'],
  cards: [
    { type: 'entity-card', label: 'Menu item card', description: 'Show dish, price, dietary badges, and action buttons.' },
    { type: 'entity-carousel', label: 'Recommendations', description: 'Compare recommended dishes.' },
    { type: 'action-form', label: 'Reservation request', description: 'Collect party size, date, time, and contact.' },
  ],
  actions: [
    {
      type: 'restaurant.reservation.request',
      label: 'Request reservation',
      description: 'Submit a reservation request or hand off to the restaurant booking system.',
      handler: 'server',
      risk: 'capture',
      confirmation: 'required',
    },
    {
      type: 'restaurant.external.open_ordering',
      label: 'Open ordering',
      description: 'Open the restaurant’s existing ordering link.',
      handler: 'client',
      risk: 'ui',
      confirmation: 'none',
    },
  ],
};

export const ecommerceConciergeTemplate: MordnTemplateManifest = {
  id: 'ecommerce-concierge',
  name: 'Ecommerce Concierge',
  vertical: 'ecommerce',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Help shoppers find, compare, and choose products with client-owned cart and checkout handoff.',
  starterPrompts: [
    { title: 'Help me choose', subtitle: 'Compare products for my needs' },
    { title: 'Find gifts under a budget', subtitle: 'Search by intent and price' },
    { title: 'Where is my order?', subtitle: 'Start an order lookup flow' },
  ],
  promptFragment:
    'You are a shopping concierge. Recommend from real catalog data, show tradeoffs, and hand cart or checkout mutations to the host storefront unless a server action is configured.',
  recommendedKnowledge: ['catalog feed', 'shipping policy', 'returns policy', 'warranty information'],
  cards: [
    { type: 'entity-card', label: 'Product card', description: 'Show product image, price, badges, attributes, and action buttons.' },
    { type: 'selection-group', label: 'Variant selector', description: 'Choose size, color, plan, or bundle.' },
    { type: 'summary-card', label: 'Cart summary', description: 'Review selected items before checkout handoff.' },
  ],
  actions: [
    { type: 'ecommerce.cart.add', label: 'Add to cart', description: 'Ask the host storefront to add a product variant to cart.', handler: 'client', risk: 'mutation', confirmation: 'recommended' },
    { type: 'ecommerce.checkout.open', label: 'Open checkout', description: 'Open the host storefront checkout.', handler: 'client', risk: 'ui', confirmation: 'none' },
    { type: 'ecommerce.order.lookup', label: 'Look up order', description: 'Fetch order status from a server-side handler.', handler: 'server', risk: 'read', confirmation: 'none' },
  ],
};

export const travelPlannerTemplate: MordnTemplateManifest = {
  id: 'travel-planner',
  name: 'Travel Planner',
  vertical: 'travel',
  version: '0.1.0',
  minWidgetVersion: '0.12.0',
  description: 'Plan trips, compare destinations or stays, build itineraries, and request quotes without owning live inventory by default.',
  starterPrompts: [
    { title: 'Plan a weekend trip', subtitle: 'Build an itinerary from preferences' },
    { title: 'Compare hotels', subtitle: 'Show options with tradeoffs' },
    { title: 'Request a quote', subtitle: 'Capture dates, guests, and preferences' },
  ],
  promptFragment:
    'You are a travel planning assistant. Treat live prices and inventory as unavailable unless a configured action returns them, and prefer quote or handoff flows by default.',
  recommendedKnowledge: ['destination guides', 'packages', 'hotel inventory export', 'travel policy', 'FAQ'],
  cards: [
    { type: 'entity-card', label: 'Destination or hotel card', description: 'Show image, price range, location, amenities, and actions.' },
    { type: 'status-tracker', label: 'Itinerary timeline', description: 'Show trip stages and selected activities.' },
    { type: 'summary-card', label: 'Trip summary', description: 'Review trip preferences before quote request.' },
  ],
  actions: [
    { type: 'travel.quote.request', label: 'Request quote', description: 'Send the trip request to the host application or agency webhook.', handler: 'server', risk: 'capture', confirmation: 'required' },
    { type: 'travel.booking.open', label: 'Open booking', description: 'Hand off to the configured booking page.', handler: 'client', risk: 'ui', confirmation: 'none' },
  ],
};

export const defaultMordnTemplates: MordnTemplateManifest[] = [
  docsAssistantTemplate,
  leadCaptureTemplate,
  servicesBookingTemplate,
  restaurantAssistantTemplate,
  ecommerceConciergeTemplate,
  travelPlannerTemplate,
];

export function getMordnTemplate(id: string): MordnTemplateManifest | undefined {
  return defaultMordnTemplates.find((template) => template.id === id);
}
