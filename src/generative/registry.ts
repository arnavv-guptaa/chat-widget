/**
 * Generative component registry — the single source of truth for what the
 * model may emit in a response beyond plain prose, and the vocabulary that
 * teaches it to do so.
 *
 * Each entry pairs:
 *   - `fenceLanguages` — the fence tag(s) the client renderer routes to the
 *     component (response.tsx maps them to React renderers), and
 *   - `prompt` — the steering sentence(s) contributed to EVERY system prompt
 *     (assembled by `buildRenderingSystem`, appended in the server handler).
 *
 * Adding a generative component = add an entry here + a renderer route in
 * response.tsx. The prompt and the renderer can no longer drift apart, which
 * was the failure mode of the previous hardcoded RENDERING_SYSTEM blob (e.g.
 * mermaid fences silently rendering as plain code).
 *
 * Shared module by design: no React, no server-only — imported by both the
 * server handler (prompt assembly) and the client renderer (fence routing).
 */

export interface GenerativeComponentDef {
  /** Stable identifier for the component. */
  name: string;
  /** Fence languages routed to this component's renderer, if fence-based. */
  fenceLanguages?: readonly string[];
  /** Steering sentence(s) contributed to every system prompt. */
  prompt: string;
}

/** Fence tag for Mermaid diagrams — referenced by the client fence router. */
export const MERMAID_FENCE_LANGUAGE = 'mermaid';

export const GENERATIVE_COMPONENTS: readonly GenerativeComponentDef[] = [
  {
    name: 'tables',
    prompt:
      'Present tabular data as GFM pipe tables (`| Col | Col |` with a `| --- |` separator row). ' +
      'Never draw tables as ASCII or box-drawing art, and never put a table inside a code fence — fences are for code only.',
  },
  {
    name: 'charts',
    fenceLanguages: ['mordn-chart', 'chart'],
    // Charts steer (PRD §7): one paragraph. The model gets a hint + a shape,
    // not a schema dump — keeping the prompt small. The fence language
    // `mordn-chart` is distinctive enough that a normal `json` fence won't
    // trigger the chart renderer. The widget validates the body and renders an
    // error card on any mismatch, so an invalid spec never ships a misleading
    // partial chart.
    prompt:
      'When your answer would benefit from a chart, emit a fenced `mordn-chart` block whose body is a JSON object: { "schemaVersion": 2, "type": "bar"|"horizontal-bar"|"line"|"area"|"multi-line"|"stacked-bar"|"grouped-bar"|"pie"|"donut"|"scatter"|"sparkline", "title": string, "subtitle"?: string, "xLabel"?: string, "yLabel"?: string, "source"?: string, "legend"?: boolean, "valueLabels"?: boolean, "series": { "name"?: string, "points": [{ "label": string, "value": number }], "color"?: "#hex" } | [{ ... }], "whole"?: { "total": number, "tolerance"?: number }, "scatter"?: [{ "x": number, "y": number, "label"?: string }] }. ' +
      'Choose the chart kind to fit the data: bar to compare discrete categories, horizontal-bar when category names are long, line/area for a sequence over an ordered axis, multi-line to compare several series over the same axis, stacked-bar to show parts-of-a-whole across categories, grouped-bar to compare series side-by-side per category, pie/donut ONLY for parts summing to a single whole (set `whole.total`), scatter for two numeric variables, sparkline for a tiny inline trend. ' +
      'Always start numeric axes at zero for bar/area/stacked-bar. For pie/donut the slices must sum to the declared whole. Only chart data you are confident is accurate; if you are unsure of the numbers, say so in prose instead. Keep categorical charts to at most 20 points and line/scatter to at most 200.',
  },
  {
    name: 'diagrams',
    fenceLanguages: [MERMAID_FENCE_LANGUAGE],
    prompt:
      'When structure or flow is clearer as a diagram (flowcharts, sequence diagrams, state machines, ER models), emit a fenced `mermaid` block containing valid Mermaid syntax and nothing else. ' +
      'Keep diagrams small (at most ~15 nodes), label the edges that carry meaning, and prefer prose for simple relationships. Only diagram relationships you are confident are accurate.',
  },
];

/**
 * Assemble the rendering-system prompt appended to EVERY system prompt
 * (default, hosted, or buildSystemPrompt). It describes the widget's rendering
 * surface, not behavior, so it composes with any operator prompt.
 */
export function buildRenderingSystem(): string {
  return [
    'Formatting: replies render as GitHub-Flavored Markdown.',
    ...GENERATIVE_COMPONENTS.map((component) => component.prompt),
  ].join(' ');
}
