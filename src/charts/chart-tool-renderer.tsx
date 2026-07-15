/**
 * chartToolRenderer — Seam B helper (PRD §2, §8).
 *
 * The widget's `AgentTurnTranscript` already runs a `toolRenderers` precedence
 * chain: a host can pass `toolRenderers: { <toolName>: (part) => <JSX> }` and
 * their custom renderer wins over the default tool row. This helper builds a
 * `ToolRenderer` for a tool whose output is chart-shaped, so a host renders a
 * trusted chart (from the tool's REAL output) in one line:
 *
 *   toolRenderers: {
 *     query_metrics: chartToolRenderer('query_metrics', (output) => ({
 *       schemaVersion: 1,
 *       type: 'line',
 *       title: output.metric,
 *       xLabel: 'time',
 *       yLabel: output.unit,
 *       series: { points: output.points.map(p => ({ label: p.t, value: p.v })) },
 *       source: 'metrics API',
 *     })),
 *   }
 *
 * This is the MORE trusted path than the model fence (Seam A): the numbers came
 * from the host's system, not the model's prose, so the provenance line shows
 * "Source: metrics API" instead of "Model-generated".
 *
 * Only renders when the tool part is in the `output-available` state — for
 * streaming/pending states it returns `null` so the default tool row shows
 * (with its pending shimmer), and the chart appears once the result lands.
 */
import type { ReactNode } from 'react';
import { ChartBlock, ChartErrorCard } from './chart-block';
import { validateChartSpec, type ChartSpec } from './chart-spec';
import type { ToolPartLike, ToolRenderer } from '../types';

/**
 * Build a ToolRenderer that maps a tool's output to a ChartSpec and renders a
 * ChartBlock. The map function receives the tool's `output` (the real result)
 * and must return a valid ChartSpec (it will be run through validateChartSpec,
 * which throws on an invalid shape — a programming error, not a render error).
 *
 * @param toolName The tool name this renderer is keyed under (informational;
 *   the host still registers it under the matching key in `toolRenderers`).
 * @param map      Map the tool output to a ChartSpec. `source` should be set
 *   here so the provenance line reads "Source: ..." not "Model-generated".
 */
export function chartToolRenderer(
  toolName: string,
  map: (output: unknown) => ChartSpec,
): ToolRenderer {
  return (part: ToolPartLike): ReactNode | null => {
    // Only render once the tool has produced output. While pending/streaming,
    // fall through to the default tool row (return null).
    if (part.state !== 'output-available') return null;

    let spec: ChartSpec;
    try {
      spec = validateChartSpec(map(part.output));
    } catch (err) {
      // The map function produced an invalid spec. This is a host programming
      // error, not bad model data — surface it explicitly rather than silently
      // rendering nothing.
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

/** Best-effort JSON stringify for the error-card raw text. Never throws. */
function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
