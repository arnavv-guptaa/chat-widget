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

/**
 * A single choice in a {@link SelectionGroup}.
 */
export interface MordnSelectionOption {
  value: string;
  label: string;
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generative GUI part model
//
// The pieces above are the *contracts* and the *presentational primitives*. What
// turns them into "GUI ability in the chat interface" is a SERIALISABLE spec an
// assistant can stream (as a tool output or a `data-mordn-ui` data part) that the
// widget maps to exactly one of those primitives — no arbitrary HTML/JSX, ever.
//
// `MordnGuiSpec` is a small, closed, discriminated union: `kind` selects the
// component, `props` are its data. It is intentionally JSON-only (no functions,
// no ReactNode) so it can cross the network from the model/server to the browser.
// A renderer maps each `kind` to a #217 primitive; an unknown `kind` renders
// nothing (safe fall-through), a malformed spec renders nothing (never throws).
// ─────────────────────────────────────────────────────────────────────────────

/** The primitive a {@link MordnGuiSpec} renders to. Closed set — no open string. */
export type MordnGuiKind =
  | 'action-button'
  | 'action-chips'
  | 'entity-card'
  | 'entity-carousel'
  | 'action-form'
  | 'selection-group'
  | 'summary-card'
  | 'confirmation-card'
  | 'status-tracker';

/** Serialisable form field (mirrors ActionFormField without React types). */
export interface MordnGuiFormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'time' | 'number' | 'textarea';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

/** Serialisable key/value row (SummaryCard). `value` is text, not ReactNode. */
export interface MordnGuiRow {
  label: string;
  value: string;
}

/**
 * Serialisable entity item. Same shape as {@link MordnEntityItem} but with
 * string-only `description` (no ReactNode) so it is JSON-safe over the wire.
 */
export interface MordnGuiEntityItem {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  badge?: string;
  attributes?: Array<{ label: string; value: string }>;
  actions?: MordnEntityAction[];
}

export type MordnGuiSpec =
  | { kind: 'action-button'; action: MordnActionConfig; label?: string; variant?: 'primary' | 'secondary' | 'ghost' }
  | { kind: 'action-chips'; actions: Array<MordnActionConfig & { label: string }> }
  | { kind: 'entity-card'; item: MordnGuiEntityItem }
  | { kind: 'entity-carousel'; label?: string; items: MordnGuiEntityItem[] }
  | { kind: 'action-form'; title?: string; description?: string; fields: MordnGuiFormField[]; submitLabel?: string; action: MordnActionConfig }
  | { kind: 'selection-group'; label?: string; options: MordnSelectionOption[]; multiple?: boolean; action: MordnActionConfig; submitLabel?: string }
  | { kind: 'summary-card'; title: string; description?: string; rows?: MordnGuiRow[]; action?: MordnActionConfig; actionLabel?: string }
  | { kind: 'confirmation-card'; title: string; description?: string; action: MordnActionConfig; confirmLabel?: string; cancelLabel?: string }
  | { kind: 'status-tracker'; steps: MordnStatusStep[] };
