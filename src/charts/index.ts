/**
 * Charts barrel — public exports for the @mordn/chat-widget charts feature.
 *
 * Consumers use these via `@mordn/chat-widget` (the main entry re-exports them):
 *   - `ChartBlock` / `ChartErrorCard` — render a validated spec (or an error
 *     card) directly, e.g. inside host UI outside the transcript.
 *   - `parseChartSpec` / `validateChartSpec` — validate a model's fence body or
 *     build a spec programmatically.
 *   - `chartToolRenderer` — the one-line Seam B helper for tool-output charts.
 *   - `ChartCode` — the fence renderer; wired into response.tsx's Streamdown
 *     `code` override (not usually imported directly by hosts).
 *   - `isChartFenceLanguage`, `CHART_FENCE_LANGUAGES` — for hosts/docs that need
 *     to detect chart fences.
 */
export { ChartBlock, ChartErrorCard, ChartBlockOrError } from './chart-block';
export type { ChartBlockProps, ChartErrorCardProps } from './chart-block';
export {
  ChartSpecSchema,
  CHART_SPEC_SCHEMA_VERSION,
  CHART_FENCE_LANGUAGES,
  isChartFenceLanguage,
  parseChartSpec,
  validateChartSpec,
} from './chart-spec';
export type { ChartSpec, ChartFenceLanguage, ChartSpecParseResult } from './chart-spec';
export { chartToolRenderer } from './chart-tool-renderer';
export { ChartCode } from './chart-code';
