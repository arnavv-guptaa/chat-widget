/**
 * ChartSpec schema + parser tests.
 *
 * The trust boundary (PRD §3) lives here: the schema is what stops a model from
 * emitting a chart that misleads. These tests pin the honesty rules that are
 * enforceable at the schema layer (finite numbers, required title, bounded
 * points, closed type enum) and the parse-result shape.
 *
 * The renderer-level honesty rules (bar y-axis at 0, line no-truncate, ordinal
 * color) are enforced in chart-block.tsx and tested in chart-render.test.tsx —
 * they're rendering decisions, not schema decisions, so they live there.
 */
import { describe, it, expect } from 'vitest';
import {
  ChartSpecSchema,
  CHART_SPEC_SCHEMA_VERSION,
  isChartFenceLanguage,
  parseChartSpec,
  validateChartSpec,
  type ChartSpec,
} from '../src/charts/chart-spec';

const validBar: ChartSpec = {
  schemaVersion: 1,
  type: 'bar',
  title: 'Revenue by quarter',
  xLabel: 'Quarter',
  yLabel: 'USD (k)',
  series: {
    name: 'Revenue',
    points: [
      { label: 'Q1', value: 120 },
      { label: 'Q2', value: 150 },
      { label: 'Q3', value: 180 },
      { label: 'Q4', value: 210 },
    ],
  },
};

const validLine: ChartSpec = {
  schemaVersion: 1,
  type: 'line',
  title: 'Latency over the day',
  xLabel: 'hour',
  yLabel: 'ms',
  series: {
    points: [
      { label: '00', value: 42 },
      { label: '06', value: 38 },
      { label: '12', value: 91 },
      { label: '18', value: 74 },
    ],
  },
  source: 'metrics API',
};

describe('ChartSpecSchema — valid specs', () => {
  it('accepts a minimal bar spec (title + series only)', () => {
    const r = ChartSpecSchema.safeParse({
      schemaVersion: 1,
      type: 'bar',
      title: 'x',
      series: { points: [{ label: 'a', value: 1 }] },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a full bar spec with labels + source', () => {
    expect(ChartSpecSchema.safeParse(validBar).success).toBe(true);
  });

  it('accepts a line spec with provenance source', () => {
    const r = ChartSpecSchema.safeParse(validLine);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe('metrics API');
  });
});

describe('ChartSpecSchema — honesty rules at the schema layer', () => {
  it('rejects an empty title (untitled charts are a hand-wave)', () => {
    const r = ChartSpecSchema.safeParse({ ...validBar, title: '' });
    expect(r.success).toBe(false);
  });

  it('rejects NaN / Infinity values (a chart of NaN is a lie)', () => {
    const r = ChartSpecSchema.safeParse({
      ...validBar,
      series: { points: [{ label: 'Q1', value: NaN }] },
    });
    expect(r.success).toBe(false);
    const r2 = ChartSpecSchema.safeParse({
      ...validBar,
      series: { points: [{ label: 'Q1', value: Infinity }] },
    });
    expect(r2.success).toBe(false);
  });

  it('rejects an empty points array', () => {
    const r = ChartSpecSchema.safeParse({ ...validBar, series: { points: [] } });
    expect(r.success).toBe(false);
  });

  it('rejects more than 200 points (a 500-point bar chart is a misuse)', () => {
    const points = Array.from({ length: 201 }, (_, i) => ({ label: `x${i}`, value: i }));
    const r = ChartSpecSchema.safeParse({ ...validBar, series: { points } });
    expect(r.success).toBe(false);
  });

  it('rejects an empty point label', () => {
    const r = ChartSpecSchema.safeParse({
      ...validBar,
      series: { points: [{ label: '', value: 1 }] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown chart type (no guessing how to draw it)', () => {
    const r = ChartSpecSchema.safeParse({ ...validBar, type: 'scatter' });
    expect(r.success).toBe(false);
  });

  it('rejects the wrong schemaVersion', () => {
    const r = ChartSpecSchema.safeParse({ ...validBar, schemaVersion: 2 });
    expect(r.success).toBe(false);
  });

  it('strips unknown fields rather than rejecting (forward-compat with future model fields)', () => {
    const r = ChartSpecSchema.safeParse({ ...validBar, futureField: 'ignored' } as unknown);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as unknown as Record<string, unknown>).futureField).toBeUndefined();
    }
  });

  it('does NOT let the model set a yMin / yMax override (the field is silently dropped, not honored)', () => {
    // A model trying to sneak a truncated y-axis via a yMin field would have it
    // stripped — the renderer enforces y-starts-at-0, not the schema, but the
    // schema also refuses to carry the override through.
    const r = ChartSpecSchema.safeParse({ ...validBar, yMin: 990 } as unknown);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as unknown as Record<string, unknown>).yMin).toBeUndefined();
    }
  });
});

describe('parseChartSpec', () => {
  it('parses a valid JSON fence body', () => {
    const r = parseChartSpec(JSON.stringify(validBar));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.title).toBe('Revenue by quarter');
  });

  it('returns a user-displayable error for invalid JSON', () => {
    const r = parseChartSpec('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not valid JSON/i);
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it('returns a user-displayable error for valid JSON that fails the schema', () => {
    const r = parseChartSpec(JSON.stringify({ type: 'bar', series: { points: [] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('validateChartSpec', () => {
  it('throws on invalid input (programming error, not a render error)', () => {
    expect(() => validateChartSpec({ type: 'bar' })).toThrow();
  });

  it('returns the validated spec for valid input', () => {
    expect(validateChartSpec(validBar).type).toBe('bar');
  });
});

describe('isChartFenceLanguage', () => {
  it('recognizes the canonical fence language', () => {
    expect(isChartFenceLanguage('mordn-chart')).toBe(true);
  });

  it('recognizes the short alias', () => {
    expect(isChartFenceLanguage('chart')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isChartFenceLanguage('  Mordn-Chart  ')).toBe(true);
  });

  it('does not match json / other languages (a json fence must not trigger a chart)', () => {
    expect(isChartFenceLanguage('json')).toBe(false);
    expect(isChartFenceLanguage('typescript')).toBe(false);
    expect(isChartFenceLanguage(undefined)).toBe(false);
    expect(isChartFenceLanguage('')).toBe(false);
  });
});

describe('CHART_SPEC_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(CHART_SPEC_SCHEMA_VERSION).toBe(1);
  });
});
