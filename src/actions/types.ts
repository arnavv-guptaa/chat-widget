import type { ReactNode } from 'react';

/**
 * Where a Mordn action is handled. Keep this small and explicit: browser-local
 * UI work, the host's createChatHandler server, or a hosted/server-side action
 * plane. Payloads are always untrusted until the chosen handler validates them.
 */
export type MordnActionHandler = 'client' | 'server' | 'hosted';

/** How an action should mark the UI while it is in flight. */
export type MordnActionLoadingBehavior = 'auto' | 'none' | 'self' | 'container';

/** How much confirmation a consequential action requires before execution. */
export type MordnActionConfirmationPolicy = 'none' | 'recommended' | 'required';

/** Optional risk hint for dashboards, docs, and confirmation cards. */
export type MordnActionRiskLevel = 'ui' | 'read' | 'capture' | 'mutation' | 'regulated';

/** JSON-schema-lite shape used by manifests and hosted config without pulling a validator into the client bundle. */
export interface MordnActionSchema {
  type?: 'object';
  required?: string[];
  properties?: Record<string, MordnActionSchemaProperty>;
  additionalProperties?: boolean;
}

export interface MordnActionSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  format?: 'email' | 'uri' | 'date' | 'date-time' | 'time' | 'tel';
  items?: MordnActionSchemaProperty;
  properties?: Record<string, MordnActionSchemaProperty>;
  /** Mark fields that should be redacted from audit/event display. */
  redact?: boolean;
}

/**
 * Declarative action config that can be attached to cards, chips, forms, or
 * host-rendered widgets. It intentionally mirrors ChatKit-style action ideas
 * while staying framework-neutral for Mordn's hosted/self-hosted modes.
 */
export interface MordnActionConfig<TPayload = unknown> {
  /** Namespaced action type, e.g. ecommerce.cart.add or restaurant.reservation.request. */
  type: string;
  /** Data supplied by the rendered UI. Treat as untrusted on the server. */
  payload?: TPayload;
  /** Defaults to server for mutations, client for purely local UI when explicitly set. */
  handler?: MordnActionHandler;
  /** Defaults to auto. */
  loadingBehavior?: MordnActionLoadingBehavior;
  /** Defaults to none for read/UI actions; required for consequential mutations. */
  confirmation?: MordnActionConfirmationPolicy;
  /** Stable client-generated key for duplicate-click / retry safety. */
  idempotencyKey?: string;
  /** Optional display label used by dashboards and generic confirmation UI. */
  label?: string;
  /** Risk hint used by templates and hosted policy. */
  risk?: MordnActionRiskLevel;
  /** Optional analytics name; defaults to type. */
  analyticsName?: string;
  /** Optional schema for form/dashboard generation. Server must still validate authoritatively. */
  schema?: MordnActionSchema;
}

export type MordnActionStatus = 'idle' | 'pending' | 'requires_confirmation' | 'requires_input' | 'success' | 'error';

export interface MordnActionEvent<TPayload = unknown> {
  action: MordnActionConfig<TPayload>;
  /** Component or message item that emitted the action, when known. */
  source?: string;
  /** Current form values merged by ActionForm/ActionCard. */
  values?: Record<string, unknown>;
}

export interface MordnActionResult<TData = unknown> {
  status: MordnActionStatus;
  title?: string;
  message?: string;
  data?: TData;
  /** Optional next UI part/template state for a later renderer. */
  ui?: unknown;
  errorCode?: string;
}

export type MordnActionDispatcher = (event: MordnActionEvent) => void | Promise<MordnActionResult | void>;

export type MordnTemplateVertical =
  | 'docs'
  | 'lead-capture'
  | 'services-booking'
  | 'restaurant'
  | 'ecommerce'
  | 'travel'
  | 'support'
  | 'internal-ops'
  | (string & {});

export interface MordnTemplateActionDefinition {
  type: string;
  label: string;
  description: string;
  handler?: MordnActionHandler;
  risk?: MordnActionRiskLevel;
  confirmation?: MordnActionConfirmationPolicy;
  schema?: MordnActionSchema;
}

export interface MordnTemplateCardDefinition {
  type: 'entity-card' | 'entity-carousel' | 'action-form' | 'selection-group' | 'summary-card' | 'status-tracker' | 'handoff-card' | (string & {});
  label: string;
  description: string;
}

export interface MordnTemplateStarterPrompt {
  title: string;
  subtitle?: string;
  message?: string;
}

export interface MordnTemplateManifest {
  id: string;
  name: string;
  description: string;
  vertical: MordnTemplateVertical;
  version: string;
  minWidgetVersion?: string;
  starterPrompts: MordnTemplateStarterPrompt[];
  promptFragment?: string;
  cards: MordnTemplateCardDefinition[];
  actions: MordnTemplateActionDefinition[];
  recommendedKnowledge?: string[];
  demoData?: Record<string, unknown>;
  notes?: string[];
}

export interface MordnActionPrimitiveProps {
  action?: MordnActionConfig;
  onAction?: MordnActionDispatcher;
  disabled?: boolean;
  loading?: boolean;
}

export interface MordnEntityAttribute {
  label: string;
  value: ReactNode;
}

export interface MordnEntityAction {
  label: string;
  action?: MordnActionConfig;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface MordnEntityItem {
  id: string;
  title: string;
  subtitle?: string;
  description?: ReactNode;
  imageUrl?: string;
  price?: string;
  badge?: string;
  attributes?: MordnEntityAttribute[];
  actions?: MordnEntityAction[];
}

export interface MordnStatusStep {
  id: string;
  label: string;
  description?: string;
  status?: 'complete' | 'current' | 'pending' | 'error';
}
