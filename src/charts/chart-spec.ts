/**
 * ChartSpec — the declarative, JSON-serializable chart description the widget
 * renders inline in assistant transcripts.
 *
 * v2 widens v1 to a broad, high-quality chart vocabulary while preserving the
 * trust boundary (PRD §3): minimal enough for a model to emit reliably, strict
 * on honesty (finite numbers, required title, bounded points, closed type
 * enum), lenient on unknown fields (forward-compat).
 *
 * Multi-series: `series` accepts either a single ChartSeries (v1 shape, still
 * supported verbatim) or an array. The renderer normalizes to an array
 * internally; a single-series chart needs no array wrapping. Charts that are
 * inherently single-series (pie/donut/sparkline) accept a single `series`.
 *
 * Honesty overrides the model CANNOT set (enforced by the renderer, not the
 * schema, because they're rendering decisions): bar/area y-axis always starts
 * at 0; no dual y-axes (out of scope); pie/donut refused if parts don't sum to
 * ~100% of a stated whole; ordinal single-hue ramp for ranked data, distinct
 * categorical hues only when multiple named series exist. Deliberately absent
 * from the schema so a model can't sneak in a `yMin: 990`.
 *
 * No new runtime deps. zod is already a peer dependency of @mordn/chat-widget
 * (^3.25 || ^4). The schema is written against zod's stable API so both majors
 * accept it.
 */
import { z } from 'zod';

/** Schema version. Bumped only on a breaking change to this shape. */
export const CHART_SPEC_SCHEMA_VERSION = 2 as const;

/** The chart kinds the renderer supports. Closed — an unknown type is a validation error. */
export const CHART_TYPES = [
  'bar',
  'horizontal-bar',
  'line',
  'area',
  'multi-line',
  'stacked-bar',
  'grouped-bar',
  'pie',
  'donut',
  'scatter',
  'sparkline',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** A single labelled numeric point. `value` MUST be finite (a chart of NaN is a lie). */
const ChartPoint = z.object({
  label: z.string().min(1),
  value: z.number().finite(),
});

/**
 * One data series. For categorical charts (bar/line/area) `points` is the
 * measured values. For scatter, `points` carries (x = value, y = label-as-number)
 * — see the scatter renderer for the convention. `color` is a host/model hint
 * the renderer MAY honor, but the honesty ramp wins by default; it's mainly for
 * semantically meaningful colors (e.g. "this series is the SLA breach line").
 */
const ChartColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional();
export const ChartSeriesSchema = z.object({
  name: z.string().min(1).optional(),
  points: z.array(ChartPoint).min(1).max(500),
  /** Optional semantic color (hex). Renderer honors it when set; otherwise the theme ramp. */
  color: ChartColor,
});
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;

/** A single-series spec (v1-compatible) OR multi-series. */
const SeriesField = z.union([ChartSeriesSchema, z.array(ChartSeriesSchema).min(1).max(12)]);

/** Pie/donut-specific honesty: a whole the slices must sum to (~within tolerance). */
const WholeField = z
  .object({
    /** The total the slices should sum to. Default 100 (percentages). */
    total: z.number().finite().positive().default(100),
    /** Allowed deviation from `total` before the pie is refused (fraction of total). Default 0.02 (2%). */
    tolerance: z.number().finite().min(0).max(0.1).default(0.02),
  })
  .optional();

/** Scatter point: (x, y) pair. `label` is the hover/legend text. */
const ScatterPoint = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  label: z.string().min(1).optional(),
  color: ChartColor,
});

/** Stacked/grouped honesty: every series shares the same set of category labels. */
const CategoricalSeriesField = z
  .array(ChartSeriesSchema)
  .min(1)
  .max(12)
  .superRefine((serieses, ctx) => {
    if (serieses.length < 2) return;
    const base = new Set(serieses[0].points.map((p) => p.label));
    serieses.slice(1).forEach((s, i) => {
      const labels = new Set(s.points.map((p) => p.label));
      for (const l of base) {
        if (!labels.has(l)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, 'points'],
            message: `stacked/grouped series must share category labels; series ${i + 1} is missing "${l}"`,
          });
        }
      }
    });
  });

export const ChartSpecSchema = z
  .object({
    schemaVersion: z.literal(CHART_SPEC_SCHEMA_VERSION),
    type: z.enum(CHART_TYPES),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
    /** Provenance. Absent => "Model-generated". Present => "Source: <source>". */
    source: z.string().min(1).optional(),
    /** Show the legend (multi-series only). Default true when >1 series. */
    legend: z.boolean().optional(),
    /** Show value labels on bars/points. Default false (clutter). */
    valueLabels: z.boolean().optional(),
    // series: type-dependent. Pie/donut/sparkline => single ChartSeries.
    //        stacked-bar/grouped-bar => array with shared labels (enforced).
    //        everything else => single or array.
    series: SeriesField,
    /** Pie/donut only: the whole the slices must sum to. */
    whole: WholeField,
    /** Scatter only (replaces `series`). */
    scatter: z.array(ScatterPoint).min(1).max(500).optional(),
  })
  .passthrough() // lenient: strip-and-ignore unknown future fields on the validated output
  .superRefine((spec, ctx) => {
    // Type-specific field requirements + honesty guards.
    if (spec.type === 'scatter') {
      if (!spec.scatter || spec.scatter.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scatter'], message: 'scatter charts require a `scatter` array' });
      }
    } else if (spec.type === 'pie' || spec.type === 'donut') {
      // Pie/donut: a single series; the whole is checked at render time against
      // the actual slice sum (the renderer refuses + shows the error card if the
      // slices don't sum within tolerance of `whole.total`).
      if (Array.isArray(spec.series)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series'], message: `${spec.type} charts take a single series, not an array` });
      }
    } else if (spec.type === 'stacked-bar' || spec.type === 'grouped-bar') {
      // These REQUIRE an array (the schema's SeriesField union would also accept
      // a single object, so enforce the array here). The shared-labels guard
      // lives on CategoricalSeriesField — but SeriesField doesn't carry it, so
      // we re-validate here.
      if (!Array.isArray(spec.series)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series'], message: `${spec.type} charts require a series array (2+ series)` });
      } else {
        const s = spec.series;
        if (s.length < 2) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series'], message: `${spec.type} charts need at least 2 series` });
        }
        const base = new Set(s[0].points.map((p) => p.label));
        s.slice(1).forEach((ser, i) => {
          const labels = new Set(ser.points.map((p) => p.label));
          for (const l of base) {
            if (!labels.has(l)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series', i, 'points'], message: `${spec.type} series must share category labels; series ${i + 2} is missing "${l}"` });
            }
          }
        });
      }
    }
  });

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/**
 * Normalize a spec's `series` field to an array of ChartSeries, regardless of
 * whether the model passed a single object or an array. Single-series charts
 * (pie/donut/sparkline) still get a 1-element array; callers index [0].
 */
export function asSeriesArray(spec: ChartSpec): ChartSeries[] {
  return Array.isArray(spec.series) ? spec.series : [spec.series];
}

/** The fence languages that trigger the chart renderer (Seam A). */
export const CHART_FENCE_LANGUAGES = ['mordn-chart', 'chart'] as const;
export type ChartFenceLanguage = (typeof CHART_FENCE_LANGUAGES)[number];

/** True if a fenced-block language should render as a chart. */
export function isChartFenceLanguage(language: string | undefined): boolean {
  if (!language) return false;
  const lower = language.trim().toLowerCase();
  return (CHART_FENCE_LANGUAGES as readonly string[]).includes(lower);
}

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
  const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { ok: false, error: 'Chart data did not match the expected shape.', issues };
}

/** Validate an already-parsed object (for hosts building a spec programmatically). Throws on invalid. */
export function validateChartSpec(input: unknown): ChartSpec {
  return ChartSpecSchema.parse(input);
}
