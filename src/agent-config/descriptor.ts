/**
 * THE schema descriptor for the canonical AgentConfig contract (schema v1).
 *
 * Everything that validates, describes, or defaults an agent configuration in
 * this package is derived from the field maps below — `isAgentConfig` (strict
 * writer), `readAgentConfig` / `readAgentBootstrap` (tolerant readers),
 * `resolveFeatures` (defaults), `describeAgentConfigSchema()` (the
 * machine-readable contract the compatibility gate snapshots). There is no
 * second list of keys anywhere. Adding a field is ONE entry here plus the
 * matching optional property on the TypeScript interface.
 *
 * GATES (they fail the build / the test suite, on purpose):
 *
 *   1. Every field map is declared `satisfies Record<keyof <Interface>, Field>`.
 *      Add a property to `FeatureConfig` without a descriptor entry → type
 *      error. Add a descriptor entry without the property → type error. The
 *      type and the contract cannot drift.
 *   2. `test/config-evolution.test.ts` snapshots `describeAgentConfigSchema()`
 *      and diffs it against the baseline of the LAST RELEASE. Removing a field,
 *      changing its kind, tightening a range, dropping an enum member, or
 *      making an optional field required fails the suite — those are
 *      schema-major changes and need a new `schemaVersion`, not a PR.
 *
 * RULES OF THE ROAD (full text in docs/config-evolution.md):
 *
 *   • New fields are OPTIONAL and carry `since` + a `default` where one exists.
 *   • A field's meaning never changes. Need different semantics? New field.
 *   • Enum members may be ADDED (old readers drop the unknown value and apply
 *     the default) but never removed or renamed.
 *   • `required: true` is reserved for the envelope — fields no reader can
 *     default. New required fields cannot be added to an existing object.
 */

import type { DisplayConfig, FeatureConfig, ThemeConfig } from '../types';
import type {
  AgentBootstrap,
  AgentClientConfig,
  AgentConfig,
  AgentRuntimeConfig,
  SerializableFollowUpConfig,
  SerializableMemoryConfig,
  SerializableStarterPrompt,
  SerializableTitleConfig,
} from '../config';
import type { Field, FieldMap } from './field';

/** Schema major. Bumps only for breaking changes (see module doc). */
export const AGENT_CONFIG_SCHEMA_VERSION = 1 as const;

/** The release that introduced the canonical schema — `since` for every v1 field. */
const V1 = '0.15.0';
/** 0.20.0 — composer voice dictation. */
const V0_20 = '0.20.0';

// ── runtime ──────────────────────────────────────────────────────────────────

const FOLLOW_UP_FIELDS = {
  enabled: { spec: { kind: 'boolean' }, since: V1, description: 'Generate follow-up suggestions after each reply.' },
  max: { spec: { kind: 'number', integer: true, min: 1, max: 5 }, since: V1, description: 'Maximum follow-up suggestions per reply.' },
  timeoutMs: { spec: { kind: 'number', integer: true, min: 1 }, since: V1, description: 'Time budget for follow-up generation.' },
} satisfies Record<keyof SerializableFollowUpConfig, Field>;

const TITLE_FIELDS = {
  enabled: { spec: { kind: 'boolean' }, since: V1, description: 'Name conversations with a lightweight model call after the first exchange.' },
  timeoutMs: { spec: { kind: 'number', integer: true, min: 1 }, since: V1, description: 'Time budget for title generation.' },
} satisfies Record<keyof SerializableTitleConfig, Field>;

const MEMORY_FIELDS = {
  enabled: { spec: { kind: 'boolean' }, required: true, since: V1, description: 'Long-term memory on/off.' },
  inject: { spec: { kind: 'boolean' }, required: true, since: V1, description: 'Inject recalled memories before generation.' },
  extract: { spec: { kind: 'boolean' }, required: true, since: V1, description: 'Extract and store memories after a completed turn.' },
  limit: { spec: { kind: 'number', integer: true, min: 1, max: 20 }, required: true, since: V1, description: 'Maximum memories injected per turn.' },
} satisfies Record<keyof SerializableMemoryConfig, Field>;

export const RUNTIME_FIELDS = {
  model: { spec: { kind: 'string', nonEmpty: true }, required: true, since: V1, description: 'Gateway model identifier the handler runs.' },
  systemPrompt: { spec: { kind: 'string' }, since: V1, description: 'System prompt.' },
  temperature: { spec: { kind: 'number', min: 0, max: 2 }, since: V1, description: 'Sampling temperature.' },
  maxOutputTokens: { spec: { kind: 'number', integer: true, min: 1 }, since: V1, description: 'Output token cap per turn.' },
  followUps: {
    spec: { kind: 'union', options: [{ kind: 'boolean' }, { kind: 'object', fields: FOLLOW_UP_FIELDS }] },
    since: V1,
    description: 'Follow-up suggestions: boolean shorthand or detailed settings.',
  },
  titles: {
    spec: { kind: 'union', options: [{ kind: 'boolean' }, { kind: 'object', fields: TITLE_FIELDS }] },
    since: V1,
    description: 'Smart thread titles: boolean shorthand or detailed settings.',
  },
  memory: { spec: { kind: 'object', fields: MEMORY_FIELDS }, since: V1, description: 'Long-term memory settings.' },
} satisfies Record<keyof AgentRuntimeConfig, Field>;

// ── client ───────────────────────────────────────────────────────────────────

const THEME_FIELDS = {
  backgroundColor: { spec: { kind: 'string' }, required: true, since: V1, description: 'Chat background color (hex).' },
  textColor: { spec: { kind: 'string' }, required: true, since: V1, description: 'Body text color (hex).' },
  primaryColor: { spec: { kind: 'string' }, required: true, since: V1, description: 'Primary accent color (hex).' },
} satisfies Record<keyof ThemeConfig, Field>;

export const FEATURE_FIELDS = {
  fileUpload: { spec: { kind: 'boolean' }, since: V1, default: false, description: 'Show the attach button and accept file uploads.' },
  fileUploadAccept: { spec: { kind: 'string' }, since: V1, default: 'image/*', description: 'HTML `accept` filter for the file picker.' },
  fileUploadMaxBytes: { spec: { kind: 'number', integer: true, min: 1 }, since: V1, description: 'Client-side per-file size cap in bytes.' },
  webSearch: { spec: { kind: 'boolean' }, since: V1, default: false, description: 'Enable web search.' },
  voiceInput: { spec: { kind: 'boolean' }, since: V0_20, default: true, description: 'Show the microphone button for browser speech-to-text dictation into the composer (rendered only where the browser supports it; never auto-sends).' },
  voiceInputLanguage: { spec: { kind: 'string' }, since: V0_20, description: 'BCP-47 language for dictation. Defaults to the page language, then the browser language.' },
} satisfies Record<keyof FeatureConfig, Field>;

const TOGGLE_POSITION_FIELDS = {
  bottom: { spec: { kind: 'string' }, since: V1, description: 'CSS offset from the bottom edge.' },
  right: { spec: { kind: 'string' }, since: V1, description: 'CSS offset from the right edge.' },
} satisfies Record<keyof NonNullable<DisplayConfig['toggleButtonPosition']>, Field>;

export const DISPLAY_FIELDS = {
  layout: { spec: { kind: 'enum', values: ['popup', 'inline', 'page'] }, since: V1, default: 'popup', description: 'Layout shape the widget renders in.' },
  size: { spec: { kind: 'enum', values: ['compact', 'default', 'large', 'full'] }, since: V1, default: 'default', description: 'Width preset (popup layout).' },
  width: { spec: { kind: 'string' }, since: V1, description: 'Custom CSS width override.' },
  resizable: { spec: { kind: 'boolean' }, since: V1, default: true, description: 'Drag-to-resize.' },
  defaultOpen: { spec: { kind: 'boolean' }, since: V1, default: false, description: 'Start open.' },
  starterPromptsLayout: { spec: { kind: 'enum', values: ['list', 'grid'] }, since: V1, default: 'list', description: 'Empty-state starter prompt layout.' },
  showToggleButton: { spec: { kind: 'boolean' }, since: V1, default: true, description: 'Render the floating toggle button.' },
  toggleButtonPosition: { spec: { kind: 'object', fields: TOGGLE_POSITION_FIELDS }, since: V1, description: 'Toggle button offsets.' },
  keyboardShortcut: {
    spec: { kind: 'union', options: [{ kind: 'string' }, { kind: 'literal', value: false }] },
    since: V1,
    description: 'Keyboard combo that toggles the widget, or `false` for none.',
  },
} satisfies Record<keyof DisplayConfig, Field>;

const STARTER_PROMPT_FIELDS = {
  title: { spec: { kind: 'string' }, required: true, since: V1, description: 'Prompt text (sent as the message when clicked).' },
  subtitle: { spec: { kind: 'string' }, since: V1, description: 'Secondary line.' },
} satisfies Record<keyof SerializableStarterPrompt, Field>;

export const CLIENT_FIELDS = {
  greeting: { spec: { kind: 'string' }, since: V1, description: 'Empty-state headline.' },
  subGreeting: { spec: { kind: 'string' }, since: V1, description: 'Faint line under the greeting.' },
  assistantName: { spec: { kind: 'string' }, since: V1, description: "The assistant's display name." },
  theme: { spec: { kind: 'object', fields: THEME_FIELDS }, since: V1, description: 'Color theme (all-or-nothing).' },
  features: { spec: { kind: 'object', fields: FEATURE_FIELDS }, since: V1, description: 'Feature flags.' },
  display: { spec: { kind: 'object', fields: DISPLAY_FIELDS }, since: V1, description: 'Layout and chrome.' },
  starterPrompts: { spec: { kind: 'array', item: { kind: 'object', fields: STARTER_PROMPT_FIELDS } }, since: V1, description: 'Empty-state starter prompts.' },
  capabilitiesPrompt: { spec: { kind: 'string' }, since: V1, description: 'Client-visible capabilities blurb.' },
  feedback: { spec: { kind: 'boolean' }, since: V1, default: false, description: 'Show per-message feedback controls.' },
  streamingThrottleMs: { spec: { kind: 'number', integer: true, min: 0 }, since: V1, description: 'Render throttle for streamed text.' },
  persistState: { spec: { kind: 'boolean' }, since: V1, description: 'Persist open/closed state per user.' },
  allowAutoReopen: { spec: { kind: 'boolean' }, since: V1, description: 'Allow the widget to reopen itself after an explicit dismiss.' },
} satisfies Record<keyof AgentClientConfig, Field>;

// ── envelopes ────────────────────────────────────────────────────────────────

export const AGENT_CONFIG_FIELDS = {
  schemaVersion: { spec: { kind: 'literal', value: AGENT_CONFIG_SCHEMA_VERSION }, required: true, since: V1, description: 'Schema major.' },
  runtime: { spec: { kind: 'object', fields: RUNTIME_FIELDS }, required: true, since: V1, description: 'Server-side runtime settings.' },
  client: { spec: { kind: 'object', fields: CLIENT_FIELDS }, required: true, since: V1, description: 'Browser-safe client projection.' },
} satisfies Record<keyof AgentConfig, Field>;

/** Independent of `schemaVersion`: transport shape and config schema evolve separately. */
export const BOOTSTRAP_PROTOCOL_VERSION = 1 as const;

export const BOOTSTRAP_FIELDS = {
  protocolVersion: { spec: { kind: 'literal', value: BOOTSTRAP_PROTOCOL_VERSION }, required: true, since: V1, description: 'Bootstrap envelope version.' },
  agent: { spec: { kind: 'string', nonEmpty: true }, required: true, since: V1, description: 'Resolved agent identifier.' },
  revision: { spec: { kind: 'string', nonEmpty: true }, required: true, since: V1, description: 'Published revision identifier.' },
  client: { spec: { kind: 'object', fields: CLIENT_FIELDS }, required: true, since: V1, description: 'Browser-safe client projection.' },
  storageScope: { spec: { kind: 'string', nonEmpty: true }, required: true, since: V1, description: 'Opaque browser storage namespace.' },
} satisfies Record<keyof AgentBootstrap, Field>;

// ── defaults ─────────────────────────────────────────────────────────────────

/** Collect the `default`s declared on a field map — the one place defaults live. */
export function defaultsOf<T extends FieldMap>(fields: T): Partial<Record<keyof T, unknown>> {
  const out: Partial<Record<keyof T, unknown>> = {};
  for (const key of Object.keys(fields) as Array<keyof T>) {
    const d = fields[key].default;
    if (d !== undefined) out[key] = d;
  }
  return out;
}
