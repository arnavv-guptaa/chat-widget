import 'server-only';
import type { UsageRecord } from './types';

/**
 * Normalise streamText's `onFinish` outputs into a {@link UsageRecord}.
 *
 * The shapes we read (verified against a live Vercel AI Gateway call):
 *
 *   usage / totalUsage = {
 *     inputTokens, outputTokens, totalTokens, cachedInputTokens,
 *     inputTokenDetails: { cacheReadTokens, cacheWriteTokens },
 *   }
 *
 *   providerMetadata.gateway = {
 *     cost, inputInferenceCost, outputInferenceCost, marketCost, surchargeCost,
 *     generationId,
 *     routing: { resolvedProvider, modelAttempts: [{ providerAttempts:
 *       [{ startTime, endTime }] }] },
 *   }
 *
 * Cost fields arrive as decimal STRINGS and are kept as strings (exact money).
 * Everything is defensive: any missing/oddly-shaped field is simply omitted —
 * usage capture must never be able to break a turn.
 *
 * Returns `null` when there's nothing worth recording (no tokens and no cost),
 * so the handler can skip the write entirely.
 */
export function normalizeUsage(args: {
  usage: unknown;
  totalUsage?: unknown;
  providerMetadata: unknown;
  /** Falls back here when the gateway doesn't echo the model. */
  modelLabel?: string;
  finishReason?: string;
  stepCount?: number;
  messageId?: string;
}): UsageRecord | null {
  try {
    // Prefer totalUsage (whole turn, summed across tool steps); fall back to usage.
    const u = asRecord(args.totalUsage) ?? asRecord(args.usage) ?? {};
    const details = asRecord(u.inputTokenDetails) ?? {};
    const meta = asRecord(args.providerMetadata) ?? {};
    const gateway = asRecord(meta.gateway) ?? {};
    const routing = asRecord(gateway.routing) ?? {};

    const record: UsageRecord = {
      ...(args.messageId ? { messageId: args.messageId } : {}),
      model: str(gateway.canonicalSlug) ?? str(routing.originalModelId) ?? args.modelLabel,
      resolvedProvider: str(routing.resolvedProvider) ?? str(routing.finalProvider),
      finishReason: args.finishReason,
      ...(typeof args.stepCount === 'number' ? { stepCount: args.stepCount } : {}),

      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      totalTokens: num(u.totalTokens),
      cachedInputTokens: num(u.cachedInputTokens),
      cacheReadTokens: num(details.cacheReadTokens),
      cacheWriteTokens: num(details.cacheWriteTokens),

      // Money — keep as exact decimal strings.
      costUsd: money(gateway.cost),
      inputCostUsd: money(gateway.inputInferenceCost),
      outputCostUsd: money(gateway.outputInferenceCost),
      marketCostUsd: money(gateway.marketCost),
      surchargeUsd: money(gateway.surchargeCost),

      latencyMs: attemptLatencyMs(routing),
      generationId: str(gateway.generationId),

      // Keep the whole provider metadata so nothing is lost.
      raw: Object.keys(meta).length > 0 ? (meta as Record<string, unknown>) : undefined,
    };

    // Drop keys that came out undefined so the payload stays compact.
    for (const k of Object.keys(record) as (keyof UsageRecord)[]) {
      if (record[k] === undefined) delete record[k];
    }

    // Nothing worth recording? (no tokens AND no cost)
    const hasTokens = (record.totalTokens ?? 0) > 0 || (record.inputTokens ?? 0) > 0;
    const hasCost = record.costUsd !== undefined;
    if (!hasTokens && !hasCost) return null;

    return record;
  } catch {
    // Belt-and-braces: capture must never throw into the turn.
    return null;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Money may arrive as a string ("0.000114") or number; normalise to a decimal string. */
function money(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Best-effort latency from the gateway's first successful provider attempt. */
function attemptLatencyMs(routing: Record<string, unknown>): number | undefined {
  const attempts = Array.isArray(routing.modelAttempts) ? routing.modelAttempts : [];
  for (const a of attempts) {
    const pa = asRecord(a)?.providerAttempts;
    const list = Array.isArray(pa) ? pa : [];
    for (const p of list) {
      const rec = asRecord(p);
      const start = num(rec?.startTime);
      const end = num(rec?.endTime);
      if (start !== undefined && end !== undefined && end >= start) return end - start;
    }
  }
  return undefined;
}
