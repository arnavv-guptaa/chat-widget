export const DEFAULT_FOLLOW_UP_COUNT = 3;
export const MAX_FOLLOW_UP_COUNT = 5;
export const MAX_FOLLOW_UP_CHARS = 160;

/** JSON-safe follow-up config stored in a hosted agent version. */
export interface SerializedFollowUpConfig {
  enabled?: boolean;
  max?: number;
  suggestions?: string[];
  timeoutMs?: number;
}

/** Normalize an untrusted hosted/config blob without allowing functions through. */
export function normalizeSerializedFollowUpConfig(
  value: unknown,
): boolean | SerializedFollowUpConfig | null {
  if (typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.max === 'number' && Number.isFinite(raw.max) ? { max: raw.max } : {}),
    ...(Array.isArray(raw.suggestions)
      ? { suggestions: raw.suggestions.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs)
      ? { timeoutMs: raw.timeoutMs }
      : {}),
  };
}

/** Clamp a public max setting to the small, bounded chip range the UI supports. */
export function resolveFollowUpCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FOLLOW_UP_COUNT;
  return Math.min(MAX_FOLLOW_UP_COUNT, Math.max(1, Math.floor(value)));
}

/** Keep model/host output compact, de-duplicated, and free of multiline noise. */
export function normalizeFollowUpSuggestions(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const limit = resolveFollowUpCount(max);
  const seen = new Set<string>();
  const clean: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLLOW_UP_CHARS).trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(text);
    if (clean.length >= limit) break;
  }
  return clean;
}
