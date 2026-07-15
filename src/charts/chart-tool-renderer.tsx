'use client';

/**
 * chartToolRenderer — Seam B helper (PRD §2, §8). Builds a ToolRenderer that
 * maps a tool's real output to a ChartSpec and renders a ChartBlock. The MORE
 * trusted path: numbers from the host's system, not the model's prose, so the
 * provenance line reads "Source: ..." not "Model-generated".
 *
 * Only renders on `output-available`; returns null for pending/streaming so the
 * default tool row (with its pending shimmer) shows until the result lands.
 */
import type { ReactNode } from 'react';
import { ChartBlock, ChartErrorCard } from './chart-block';
import { validateChartSpec, type ChartSpec } from './chart-spec';
import type { ToolPartLike, ToolRenderer } from '../types';

export function chartToolRenderer(
  toolName: string,
  map: (output: unknown) => ChartSpec,
): ToolRenderer {
  return (part: ToolPartLike): ReactNode | null => {
    if (part.state !== 'output-available') return null;
    let spec: ChartSpec;
    try {
      spec = validateChartSpec(map(part.output));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return (
        <ChartErrorCard
          error={`The ${toolName} tool returned data that did not map to a valid chart: ${message}`}
          rawText={safeStringify(part.output)}
        />
      );
    }
    return <ChartBlock spec={spec} />;
  };
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
