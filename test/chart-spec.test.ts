/**
 * ChartSpec v2 schema + parser tests.
 * Covers the widened vocabulary, multi-series normalization, honesty guards
 * (finite numbers, required title, point bounds, closed type enum, pie whole,
 * stacked/grouped shared labels), and the parse result shape.
 */
import { describe, it, expect } from 'vitest';
import {
  ChartSpecSchema,
  CHART_SPEC_SCHEMA_VERSION,
  CHART_TYPES,
  isChartFenceLanguage,
  parseChartSpec,
  validateChartSpec,
  asSeriesArray,
  type ChartSpec,
} from '../src/charts/chart-spec';

const bar: ChartSpec = {
  schemaVersion: 2,
  type: 'bar',
  title: 'Revenue by quarter',
  xLabel: 'Quarter',
  yLabel: 'USD (k)',
  series: { points: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }, { label: 'Q3', value: 180 }, { label: 'Q4', value: 210 }] },
};

const multiLine: ChartSpec = {
  schemaVersion: 2,
  type: 'multi-line',
  title: 'Two metrics',
  series: [
    { name: 'A', points: [{ label: '1', value: 1 }, { label: '2', value: 2 }] },
    { name: 'B', points: [{ label: '1', value: 3 }, { label: '2', value: 4 }] },
  ],
};

const pie: ChartSpec = {
  schemaVersion: 2,
  type: 'pie',
  title: 'Market share',
  whole: { total: 100, tolerance: 0.02 },
  series: { points: [{ label: 'A', value: 60 }, { label: 'B', value: 40 }] },
};

const scatter: ChartSpec = {
  schemaVersion: 2,
  type: 'scatter',
  title: 'Correlation',
  scatter: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 5 }],
};

describe('ChartSpecSchema — version + types', () => {
  it('is schemaVersion 2', () => expect(CHART_SPEC_SCHEMA_VERSION).toBe(2));
  it('supports the wide vocabulary', () => {
    expect(CHART_TYPES).toContain('bar');
    expect(CHART_TYPES).toContain('horizontal-bar');
    expect(CHART_TYPES).toContain('line');
    expect(CHART_TYPES).toContain('area');
    expect(CHART_TYPES).toContain('multi-line');
    expect(CHART_TYPES).toContain('stacked-bar');
    expect(CHART_TYPES).toContain('grouped-bar');
    expect(CHART_TYPES).toContain('pie');
    expect(CHART_TYPES).toContain('donut');
    expect(CHART_TYPES).toContain('scatter');
    expect(CHART_TYPES).toContain('sparkline');
  });
  it('rejects an unknown type', () => {
    expect(ChartSpecSchema.safeParse({ ...bar, type: 'radar' }).success).toBe(false);
  });
});

describe('ChartSpecSchema — series single vs array (backward-compat)', () => {
  it('accepts a single-series object (v1 shape)', () => {
    expect(ChartSpecSchema.safeParse(bar).success).toBe(true);
  });
  it('accepts a multi-series array', () => {
    expect(ChartSpecSchema.safeParse(multiLine).success).toBe(true);
  });
  it('asSeriesArray normalizes single -> [single]', () => {
    const r = ChartSpecSchema.safeParse(bar);
    if (r.success) expect(asSeriesArray(r.data).length).toBe(1);
  });
  it('asSeriesArray keeps an array as-is', () => {
    const r = ChartSpecSchema.safeParse(multiLine);
    if (r.success) expect(asSeriesArray(r.data).length).toBe(2);
  });
});

describe('ChartSpecSchema — honesty rules', () => {
  it('rejects an empty title', () => expect(ChartSpecSchema.safeParse({ ...bar, title: '' }).success).toBe(false));
  it('rejects NaN/Infinity values', () => {
    expect(ChartSpecSchema.safeParse({ ...bar, series: { points: [{ label: 'a', value: NaN }] } }).success).toBe(false);
    expect(ChartSpecSchema.safeParse({ ...bar, series: { points: [{ label: 'a', value: Infinity }] } }).success).toBe(false);
  });
  it('rejects empty points', () => expect(ChartSpecSchema.safeParse({ ...bar, series: { points: [] } }).success).toBe(false));
  it('rejects >500 points', () => {
    const pts = Array.from({ length: 501 }, (_, i) => ({ label: `x${i}`, value: i }));
    expect(ChartSpecSchema.safeParse({ ...bar, series: { points: pts } }).success).toBe(false);
  });
  it('rejects an empty point label', () => {
    expect(ChartSpecSchema.safeParse({ ...bar, series: { points: [{ label: '', value: 1 }] } }).success).toBe(false);
  });
  it('strips unknown fields (forward-compat)', () => {
    const r = ChartSpecSchema.safeParse({ ...bar, futureField: 'x' } as unknown);
    expect(r.success).toBe(true);
  });
  it('does not carry a yMin override through', () => {
    const r = ChartSpecSchema.safeParse({ ...bar, yMin: 990 } as unknown);
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as unknown as Record<string, unknown>).yMin).toBeUndefined();
  });
});

describe('ChartSpecSchema — type-specific guards', () => {
  it('scatter requires a scatter array', () => {
    expect(ChartSpecSchema.safeParse({ ...scatter, scatter: undefined }).success).toBe(false);
  });
  it('scatter accepts x/y pairs', () => {
    expect(ChartSpecSchema.safeParse(scatter).success).toBe(true);
  });
  it('pie rejects a series array', () => {
    expect(ChartSpecSchema.safeParse({ ...pie, series: pie.series ? [pie.series as never] : [] }).success).toBe(false);
  });
  it('pie accepts a single series', () => {
    expect(ChartSpecSchema.safeParse(pie).success).toBe(true);
  });
  it('stacked-bar requires an array of 2+', () => {
    expect(ChartSpecSchema.safeParse({ ...multiLine, type: 'stacked-bar', series: multiLine.series }).success).toBe(true);
    expect(ChartSpecSchema.safeParse({ ...bar, type: 'stacked-bar' }).success).toBe(false);
  });
  it('stacked-bar rejects mismatched category labels', () => {
    const bad = {
      ...multiLine,
      type: 'stacked-bar',
      series: [
        { name: 'A', points: [{ label: '1', value: 1 }, { label: '2', value: 2 }] },
        { name: 'B', points: [{ label: '1', value: 3 }, { label: '3', value: 4 }] },
      ],
    };
    expect(ChartSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseChartSpec', () => {
  it('parses valid JSON', () => {
    const r = parseChartSpec(JSON.stringify(bar));
    expect(r.ok).toBe(true);
  });
  it('returns a user-displayable error for invalid JSON', () => {
    const r = parseChartSpec('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/i);
  });
  it('returns issues for a schema mismatch', () => {
    const r = parseChartSpec(JSON.stringify({ type: 'bar' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('validateChartSpec', () => {
  it('throws on invalid input', () => expect(() => validateChartSpec({ type: 'bar' })).toThrow());
  it('returns the validated spec for valid input', () => expect(validateChartSpec(bar).type).toBe('bar'));
});

describe('isChartFenceLanguage', () => {
  it('recognizes mordn-chart + chart, case-insensitive', () => {
    expect(isChartFenceLanguage('mordn-chart')).toBe(true);
    expect(isChartFenceLanguage('chart')).toBe(true);
    expect(isChartFenceLanguage('  Mordn-Chart  ')).toBe(true);
  });
  it('does not match json/other', () => {
    expect(isChartFenceLanguage('json')).toBe(false);
    expect(isChartFenceLanguage(undefined)).toBe(false);
  });
});
