/**
 * Canonical, JSON-serializable agent configuration shared by the control plane,
 * server handler, bootstrap response, and browser preview transport.
 */
import type { DisplayConfig, FeatureConfig, ThemeConfig } from './types';

export interface SerializableStarterPrompt {
  title: string;
  subtitle?: string;
}

export interface SerializableFollowUpConfig {
  enabled?: boolean;
  max?: number;
  timeoutMs?: number;
}

/**
 * Published compression tuning only. Endpoint URLs, credentials, and custom
 * transports belong in server-only `CompressionConfig`, never AgentConfig.
 */
export interface SerializableCompressionConfig {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
  minChars?: number;
  tokenBudget?: number;
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
  compression?: boolean | SerializableCompressionConfig;
  followUps?: boolean | SerializableFollowUpConfig;
  memory?: SerializableMemoryConfig;
}

export interface AgentClientConfig {
  greeting?: string;
  theme?: ThemeConfig;
  features?: FeatureConfig;
  display?: DisplayConfig;
  starterPrompts?: SerializableStarterPrompt[];
  capabilitiesPrompt?: string;
  feedback?: boolean;
  followUps?: Pick<SerializableFollowUpConfig, 'enabled' | 'max'>;
  streamingThrottleMs?: number;
  persistState?: boolean;
  allowAutoReopen?: boolean;
}

export interface AgentConfig {
  schemaVersion: 1;
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
  schemaVersion: 1;
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
    followUps:
      published.followUps || explicit.followUps
        ? { ...published.followUps, ...explicit.followUps }
        : undefined,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const optional = (value: unknown, check: (candidate: unknown) => boolean) =>
  value === undefined || check(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const safeInteger = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value);
const integerInRange = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  safeInteger(value) && value >= min && value <= max;
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const str = (value: unknown): value is string => typeof value === 'string';
const nonEmptyString = (value: unknown): value is string => str(value) && value.trim().length > 0;

function validFollowUps(value: unknown): boolean {
  return (
    isRecord(value) &&
    only(value, ['enabled', 'max', 'timeoutMs']) &&
    optional(value.enabled, bool) &&
    optional(value.max, (candidate) => integerInRange(candidate, 1, 5)) &&
    optional(value.timeoutMs, (candidate) => integerInRange(candidate, 1))
  );
}

function validRuntime(value: unknown): value is AgentRuntimeConfig {
  if (!isRecord(value) || !only(value, ['model', 'systemPrompt', 'temperature', 'maxOutputTokens', 'compression', 'followUps', 'memory'])) return false;
  if (!nonEmptyString(value.model)) return false;
  if (!optional(value.systemPrompt, str)) return false;
  if (!optional(value.temperature, (v) => finite(v) && v >= 0 && v <= 2)) return false;
  if (!optional(value.maxOutputTokens, (v) => integerInRange(v, 1))) return false;
  if (
    !optional(value.compression, (candidate) => {
      if (typeof candidate === 'boolean') return true;
      return (
        isRecord(candidate) &&
        only(candidate, ['enabled', 'model', 'timeoutMs', 'minChars', 'tokenBudget']) &&
        optional(candidate.enabled, bool) &&
        optional(candidate.model, nonEmptyString) &&
        optional(candidate.timeoutMs, (v) => integerInRange(v, 1)) &&
        optional(candidate.minChars, (v) => integerInRange(v, 0)) &&
        optional(candidate.tokenBudget, (v) => integerInRange(v, 1))
      );
    })
  ) return false;
  if (!optional(value.followUps, (candidate) => typeof candidate === 'boolean' || validFollowUps(candidate))) return false;
  return optional(
    value.memory,
    (candidate) =>
      isRecord(candidate) &&
      only(candidate, ['enabled', 'inject', 'extract', 'limit']) &&
      bool(candidate.enabled) &&
      bool(candidate.inject) &&
      bool(candidate.extract) &&
      finite(candidate.limit) &&
      Number.isInteger(candidate.limit) &&
      candidate.limit >= 1 &&
      candidate.limit <= 20,
  );
}

function validClient(value: unknown): value is AgentClientConfig {
  if (!isRecord(value) || !only(value, ['greeting', 'theme', 'features', 'display', 'starterPrompts', 'capabilitiesPrompt', 'feedback', 'followUps', 'streamingThrottleMs', 'persistState', 'allowAutoReopen'])) return false;
  if (!optional(value.greeting, str)) return false;
  if (!optional(value.theme, (candidate) => isRecord(candidate) && only(candidate, ['backgroundColor', 'textColor', 'primaryColor']) && str(candidate.backgroundColor) && str(candidate.textColor) && str(candidate.primaryColor))) return false;
  if (!optional(value.features, (candidate) => isRecord(candidate) && only(candidate, ['fileUpload', 'fileUploadAccept', 'fileUploadMaxBytes', 'webSearch']) && optional(candidate.fileUpload, bool) && optional(candidate.fileUploadAccept, str) && optional(candidate.fileUploadMaxBytes, (v) => integerInRange(v, 1)) && optional(candidate.webSearch, bool))) return false;
  if (!optional(value.display, (candidate) => {
    if (!isRecord(candidate) || !only(candidate, ['layout', 'size', 'width', 'resizable', 'defaultOpen', 'starterPromptsLayout', 'showToggleButton', 'toggleButtonPosition', 'keyboardShortcut'])) return false;
    return optional(candidate.layout, (v) => v === 'popup' || v === 'inline' || v === 'page') &&
      optional(candidate.size, (v) => v === 'compact' || v === 'default' || v === 'large' || v === 'full') &&
      optional(candidate.width, str) && optional(candidate.resizable, bool) && optional(candidate.defaultOpen, bool) &&
      optional(candidate.starterPromptsLayout, (v) => v === 'list' || v === 'grid') && optional(candidate.showToggleButton, bool) &&
      optional(candidate.keyboardShortcut, (v) => v === false || str(v)) &&
      optional(candidate.toggleButtonPosition, (v) => isRecord(v) && only(v, ['bottom', 'right']) && optional(v.bottom, str) && optional(v.right, str));
  })) return false;
  if (!optional(value.starterPrompts, (candidate) => Array.isArray(candidate) && candidate.every((prompt) => isRecord(prompt) && only(prompt, ['title', 'subtitle']) && str(prompt.title) && optional(prompt.subtitle, str)))) return false;
  return optional(value.capabilitiesPrompt, str) && optional(value.feedback, bool) &&
    optional(value.followUps, (candidate) => isRecord(candidate) && only(candidate, ['enabled', 'max']) && optional(candidate.enabled, bool) && optional(candidate.max, (v) => integerInRange(v, 1, 5))) && optional(value.streamingThrottleMs, (v) => integerInRange(v, 0)) &&
    optional(value.persistState, bool) && optional(value.allowAutoReopen, bool);
}

/** Validate the browser-safe bootstrap payload before it reaches widget state. */
export function isAgentBootstrap(value: unknown): value is AgentBootstrap {
  return (
    isRecord(value) &&
    only(value, ['schemaVersion', 'agent', 'revision', 'client', 'storageScope']) &&
    value.schemaVersion === 1 &&
    nonEmptyString(value.agent) &&
    nonEmptyString(value.revision) &&
    validClient(value.client) &&
    nonEmptyString(value.storageScope)
  );
}

/** Validate the complete, strict schema-v1 config before preview trust. */
export function isAgentConfig(value: unknown): value is AgentConfig {
  return (
    isRecord(value) &&
    only(value, ['schemaVersion', 'runtime', 'client']) &&
    value.schemaVersion === 1 &&
    validRuntime(value.runtime) &&
    validClient(value.client)
  );
}
