/**
 * ChartSpec — the declarative, JSON-serializable chart description the widget
 * renders inline in assistant transcripts.
 *
 * Design goals (see the Charts PRD, doc cmrm9rilj0gkd07ad17fe2wvb):
 *   - Minimal enough that a model can emit it reliably. A tiny owned schema the
 *     model nails every time beats a rich grammar (Vega-Lite) that fails 30%
 *     of renders.
 *   - Strict enough to enforce honesty: required title, finite numbers, bounded
 *     point count, no fields that let the model override the renderer's
 *     honesty-preserving defaults (e.g. a bar y-axis must start at 0).
 *   - Lenient on unknown fields (a model adding a future field must not break
 *     an older widget — the validator strips them rather than rejecting).
 *
 * Provenance: `source` is present when the chart is rendered from a tool's real
 * output (Seam B). It is absent for model-emitted fences (Seam A), in which case
 * the renderer shows "Model-generated" — the critical trust affordance that
 * tells the user the picture was drawn from the model's own numbers, not
 * measured by a system.
 *
 * No new runtime deps. zod is already a peer dependency of @mordn/chat-widget
 * (^3.25 || ^4). The schema is written against zod's stable API so both majors
 * accept it.
 */
import { z } from 'zod';

/** Schema version. Bumped only on a breaking change to this shape. */
export const CHART_SPEC_SCHEMA_VERSION = 1 as const;

/**
 * A single labelled numeric point. `label` is the x-axis/category label;
 * `value` is the measured quantity. `value` MUST be a finite number — NaN /
 * Infinity are rejected (a chart of NaN is a lie).
 */
const ChartPoint = z.object({
  label: z.string().min(1),
  value: z.number().finite(),
});

/**
 * One data series. v1 supports a single series per chart; multi-series (with a
 * legend + per-series color ramp) is a v1.1 addition that extends this shape
 * with `series: ChartSeries[]` + a `legend` affordance, not a replacement.
 */
const ChartSeries = z.object({
  name: z.string().min(1).optional(),
  points: z.array(ChartPoint).min(1).max(200),
});

/**
 * The full chart spec. `type` is closed to the chart kinds the renderer
 * supports in this version; an unknown type is a validation error (the renderer
 * shows its error card rather than guessing how to draw something it can't).
 *
 * Honesty overrides the model CANNOT set (enforced by the renderer, not the
 * schema, because they're rendering decisions not data):
 *   - bar y-axis always starts at 0
 *   - no dual y-axes (out of scope entirely)
 *   - line y-axis never truncates the visible range below 10% of the span
 *   - ordinal single-hue color ramp (not a categorical rainbow)
 * These are deliberately absent from the schema so a model can't sneak in a
 * `yMin: 990` that would produce the #1 misleading chart.
 */
export const ChartSpecSchema = z.object({
  schemaVersion: z.literal(CHART_SPEC_SCHEMA_VERSION),
  type: z.enum(['bar', 'line']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  series: ChartSeries,
  /** Provenance. Absent => "Model-generated". Present => "Source: <source>". */
  source: z.string().min(1).optional(),
});

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/** The fence languages that trigger the chart renderer (Seam A). */
export const CHART_FENCE_LANGUAGES = ['mordn-chart', 'chart'] as const;
export type ChartFenceLanguage = (typeof CHART_FENCE_LANGUAGES)[number];

/** True if a fenced-block language should render as a chart. */
export function isChartFenceLanguage(language: string | undefined): boolean {
  if (!language) return false;
  const lower = language.trim().toLowerCase();
  return (CHART_FENCE_LANGUAGES as readonly string[]).includes(lower);
}

/**
 * Parse + validate a fence body (or any JSON string) as a ChartSpec.
 *
 * Returns a discriminated result so callers (the fence hook, host code, docs
 * previews) can branch without try/catch. On failure `error` is a short,
 * user-displayable message (the renderer shows it in the error card); the full
 * zod issue list is available on the `issues` field for debugging/logs.
 *
 * Lenient on unknown fields: `.passthrough()` would keep them; we instead use
 * the default zod object behaviour (strip unknown keys) so the validated
 * `ChartSpec` is exactly the known shape, but a model adding a future field
 * does not cause a rejection.
 */
export type ChartSpecParseResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; error: string; issues: string[] };

export function parseChartSpec(text: string): ChartSpecParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'Chart data is not valid JSON.',
      issues: ['The fence body could not be parsed as JSON.'],
    };
  }

  const result = ChartSpecSchema.safeParse(json);
  if (result.success) {
    return { ok: true, spec: result.data };
  }
  const issues = result.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  return {
    ok: false,
    error: 'Chart data did not match the expected shape.',
    issues,
  };
}

/**
 * Validate an already-parsed object as a ChartSpec (for hosts building a spec
 * programmatically, e.g. via `chartToolRenderer`). Throws on invalid input so
 * programming errors surface immediately rather than rendering an error card.
 */
export function validateChartSpec(input: unknown): ChartSpec {
  return ChartSpecSchema.parse(input);
}
