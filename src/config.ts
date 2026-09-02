/**
 * Canonical, JSON-serializable agent configuration shared by the control plane,
 * server handler, bootstrap response, and browser preview transport.
 *
 * Validation lives in two flavours, both derived from ONE descriptor
 * (`src/agent-config/descriptor.ts`) so they cannot drift:
 *
 *   • `isAgentConfig` / `isAgentBootstrap` — STRICT. The writer contract.
 *     Unknown keys are errors. Use where a document is authored or accepted
 *     for storage (publish, preview trust boundary).
 *   • `readAgentConfig` / `readAgentBootstrap` — TOLERANT. The reader
 *     contract. Unknown keys and uninterpretable optional values are dropped
 *     (and reported), never fatal. Use in every runtime consumer, so a
 *     document published by a NEWER dashboard/schema loads on an OLDER
 *     deployed widget. See docs/config-evolution.md.
 */
import type { DisplayConfig, FeatureConfig, ThemeConfig } from './types';
import { describeFields, readObject, type ReadIssue, type ReadResult } from './agent-config/field';
import {
  AGENT_CONFIG_FIELDS,
  AGENT_CONFIG_SCHEMA_VERSION,
  BOOTSTRAP_FIELDS,
  BOOTSTRAP_PROTOCOL_VERSION,
  FEATURE_FIELDS,
  defaultsOf,
} from './agent-config/descriptor';

export { AGENT_CONFIG_SCHEMA_VERSION, BOOTSTRAP_PROTOCOL_VERSION };
export type { ReadIssue as ConfigReadIssue, ReadResult as ConfigReadResult };
export type { FieldDescription as ConfigFieldDescription } from './agent-config/field';

export interface SerializableStarterPrompt {
  title: string;
  subtitle?: string;
}

export interface SerializableFollowUpConfig {
  enabled?: boolean;
  max?: number;
  timeoutMs?: number;
}

export interface SerializableTitleConfig {
  enabled?: boolean;
  timeoutMs?: number;
}

export interface SerializableMemoryConfig {
  enabled: boolean;
  /** Inject recalled memories before generation. */
  inject: boolean;
  /** Extract and store memories after a completed turn. */
  extract: boolean;
  /** Maximum memories injected per turn. */
  limit: number;
}

export interface AgentRuntimeConfig {
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  followUps?: boolean | SerializableFollowUpConfig;
  /**
   * Smart thread titles: a lightweight post-response model call names the
   * conversation after its first exchange. Default ON — pass `false` to keep
   * the first-message-prefix placeholder titles.
   */
  titles?: boolean | SerializableTitleConfig;
  memory?: SerializableMemoryConfig;
}

export interface AgentClientConfig {
  greeting?: string;
  /** Faint line under the greeting headline (free display text). */
  subGreeting?: string;
  /** The assistant's name (identity, not the greeting sub line). */
  assistantName?: string;
  theme?: ThemeConfig;
  features?: FeatureConfig;
  display?: DisplayConfig;
  starterPrompts?: SerializableStarterPrompt[];
  capabilitiesPrompt?: string;
  feedback?: boolean;
  streamingThrottleMs?: number;
  persistState?: boolean;
  allowAutoReopen?: boolean;
}

export interface AgentConfig {
  schemaVersion: typeof AGENT_CONFIG_SCHEMA_VERSION;
  runtime: AgentRuntimeConfig;
  client: AgentClientConfig;
}

/** Hosted control-plane record consumed by the handler. */
export interface PublishedAgentConfig {
  agent: string;
  revision: string;
  config: AgentConfig;
}

/** Browser-safe projection returned from GET /bootstrap. */
export interface AgentBootstrap {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  agent: string;
  revision: string;
  client: AgentClientConfig;
  storageScope: string;
}

export function mergeAgentClientConfig(
  published: AgentClientConfig | undefined,
  explicit: AgentClientConfig | undefined,
): AgentClientConfig {
  if (!published) return explicit ?? {};
  if (!explicit) return published;
  return {
    ...published,
    ...explicit,
    theme: explicit.theme ?? published.theme,
    features:
      published.features || explicit.features
        ? { ...published.features, ...explicit.features }
        : undefined,
    display:
      published.display || explicit.display
        ? {
            ...published.display,
            ...explicit.display,
            toggleButtonPosition:
              published.display?.toggleButtonPosition || explicit.display?.toggleButtonPosition
                ? {
                    ...published.display?.toggleButtonPosition,
                    ...explicit.display?.toggleButtonPosition,
                  }
                : undefined,
          }
        : undefined,
  };
}

// ── Readers (tolerant) ───────────────────────────────────────────────────────

/**
 * Read a complete schema-v1 config the way a RUNTIME must: fields this build
 * doesn't know are dropped and reported in `dropped`, never fatal. Fails only
 * on a wrong `schemaVersion` or a missing/invalid required field. Use in the
 * handler, the hosted config fetcher, and any other consumer of a published
 * document. The returned `value` contains only known, valid fields.
 */
export function readAgentConfig(value: unknown): ReadResult<AgentConfig> {
  return readObject<AgentConfig>(value, AGENT_CONFIG_FIELDS, 'tolerant');
}

/** Tolerant reader for the browser-safe bootstrap envelope (see `readAgentConfig`). */
export function readAgentBootstrap(value: unknown): ReadResult<AgentBootstrap> {
  return readObject<AgentBootstrap>(value, BOOTSTRAP_FIELDS, 'tolerant');
}

// ── Validators (strict) ──────────────────────────────────────────────────────

/**
 * Validate the complete, strict schema-v1 config before it is authored,
 * stored, or trusted as a preview. Unknown keys are rejected — this is what
 * keeps typos and junk out of published revisions. Runtime consumers must use
 * `readAgentConfig` instead, or a newer dashboard will break older deployments.
 */
export function isAgentConfig(value: unknown): value is AgentConfig {
  return readObject<AgentConfig>(value, AGENT_CONFIG_FIELDS, 'strict').ok;
}

/** Strict validator for the bootstrap envelope. Browsers should prefer `readAgentBootstrap`. */
export function isAgentBootstrap(value: unknown): value is AgentBootstrap {
  return readObject<AgentBootstrap>(value, BOOTSTRAP_FIELDS, 'strict').ok;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

/** `FeatureConfig` with every defaulted flag resolved. */
export interface ResolvedFeatureConfig {
  fileUpload: boolean;
  fileUploadAccept: string;
  fileUploadMaxBytes?: number;
  webSearch: boolean;
}

/** Feature defaults, sourced from the descriptor — the single place they live. */
export const DEFAULT_FEATURES: ResolvedFeatureConfig = defaultsOf(FEATURE_FIELDS) as ResolvedFeatureConfig;

/**
 * Apply schema defaults to a (possibly partial or absent) `features` object.
 * Consumers read flags from the result instead of sprinkling `=== true` /
 * `?? 'image/*'` fallbacks through UI code, so a default changes in one place.
 */
export function resolveFeatures(features?: FeatureConfig | null): ResolvedFeatureConfig {
  const resolved: ResolvedFeatureConfig = { ...DEFAULT_FEATURES };
  if (!features) return resolved;
  for (const [key, value] of Object.entries(features)) {
    if (value !== undefined) (resolved as unknown as Record<string, unknown>)[key] = value;
  }
  return resolved;
}

// ── Schema description ───────────────────────────────────────────────────────

/**
 * Machine-readable description of the whole contract: every path with its
 * kind, requiredness, `since`, default and constraints. The compatibility gate
 * (`test/config-evolution.test.ts`) snapshots this and diffs it against the
 * last release; dashboards and docs can render it directly.
 */
export function describeAgentConfigSchema() {
  return {
    schemaVersion: AGENT_CONFIG_SCHEMA_VERSION,
    bootstrapProtocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
    config: describeFields(AGENT_CONFIG_FIELDS),
    bootstrap: describeFields(BOOTSTRAP_FIELDS),
  };
}

/** One-line summary of read issues for error messages and logs. */
export function formatConfigIssues(issues: readonly ReadIssue[]): string {
  return issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ');
}
