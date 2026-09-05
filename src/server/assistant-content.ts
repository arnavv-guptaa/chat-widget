import { isCustomMessageDataPart } from '../utils/custom-message-data';

/**
 * Whether a settled assistant turn is worth saving, including partial aborts.
 * Custom data is durable without a registered client renderer; control-only or
 * transient-only output must not create an empty history bubble. This checks
 * content eligibility only, not the provenance or safety of a payload.
 */
export function hasAssistantContent(messages: ReadonlyArray<{ role: string; parts?: unknown }>): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || !Array.isArray(last.parts)) return false;
  return (last.parts as Array<{ type?: string; text?: string }>).some((p) => {
    if (!p || typeof p.type !== 'string') return false;
    if (p.type === 'text' || p.type === 'reasoning') return Boolean(p.text && p.text.trim());
    // Preserve existing tool / source / file behavior; custom data is additive.
    return p.type.startsWith('tool-') || p.type === 'dynamic-tool' || p.type === 'source-url' || p.type === 'file' ||
      isCustomMessageDataPart(p as { type: string });
  });
}
