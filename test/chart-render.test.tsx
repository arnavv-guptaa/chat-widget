/**
 * Renderer honesty-default tests (PRD §3 Rule 3) + the v2 y-axis fix.
 *
 * The line-chart bug in v1 was an orphan `8.1` tick clipped at the baseline,
 * caused by niceTicks unconditionally prepending the raw padded min. v2's
 * niceScale snaps the min to the step grid, so the lowest tick is always a
 * round grid value and never collides with the next one. These tests pin that
 * and the honesty defaults across the wider vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChartBlock, ChartErrorCard } from '../src/charts/chart-block';
import { niceScale } from '../src/charts/chart-geometry';
import type { ChartSpec } from '../src/charts/chart-spec';

const line: ChartSpec = {
  schemaVersion: 2,
  type: 'line',
  title: 'Website Traffic Over Time',
  xLabel: 'Month',
  yLabel: 'Visitors (thousands)',
  series: { points: [
    { label: 'Jan', value: 12 }, { label: 'Feb', value: 19 }, { label: 'Mar', value: 28 },
    { label: 'Apr', value: 35 }, { label: 'May', value: 42 }, { label: 'Jun', value: 38 },
    { label: 'Jul', value: 51 }, { label: 'Aug', value: 48 },
  ] },
};

describe('niceScale — the y-axis fix', () => {
  it('produces only round grid ticks (no orphan fractional tick)', () => {
    // The v1 bug case: data min ~12, max ~51. v1 produced [8.1, 10, 20, ...].
    // v2 must produce round ticks spanning the data with padding, no 8.1.
    const s = niceScale(12, 51, false);
    s.ticks.forEach((t) => {
      // Every tick is a clean multiple of the step (no 8.1-style orphans).
      expect(Math.abs((t - s.min) / s.step - Math.round((t - s.min) / s.step))).toBeLessThan(1e-6);
    });
    // The min tick is the first tick (no spurious prepended value).
    expect(s.ticks[0]).toBe(s.min);
    // Ticks are strictly increasing (no overlap).
    for (let i = 1; i < s.ticks.length; i++) expect(s.ticks[i]).toBeGreaterThan(s.ticks[i - 1]);
  });

  it('forces min to 0 for bar (honesty)', () => {
    const s = niceScale(40, 60, true);
    expect(s.min).toBe(0);
    expect(s.ticks).toContain(0);
  });

  it('handles a single-value series without crashing', () => {
    const s = niceScale(5, 5, false);
    expect(s.ticks.length).toBeGreaterThan(1);
    expect(Number.isFinite(s.min)).toBe(true);
  });
});

describe('ChartBlock — bar honesty', () => {
  const bar: ChartSpec = { schemaVersion: 2, type: 'bar', title: 'Rev', yLabel: 'USD', series: { points: [{ label: 'Q1', value: 100 }, { label: 'Q2', value: 200 }] } };
  it('renders a y tick at 0 (bar starts at 0)', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const ticks = Array.from(container.querySelectorAll('.chat-chart-tick')).map((e) => e.textContent ?? '');
    expect(ticks).toContain('0');
  });
  it('renders a bar per point', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    expect(container.querySelectorAll('.chat-chart-bar').length).toBe(2);
  });
});

describe('ChartBlock — line y-axis (the screenshot bug)', () => {
  it('renders round y ticks with no orphan fractional value at the baseline', () => {
    const { container } = render(<ChartBlock spec={line} />);
    const ticks = Array.from(container.querySelectorAll('.chat-chart-tick')).map((e) => e.textContent ?? '');
    // No clipped/overlapping fractional like "8.1" — every tick is a round grid value.
    ticks.forEach((t) => {
      const n = parseFloat(t);
      if (Number.isFinite(n)) expect(Number.isInteger(n) || n % 5 === 0 || n % 2 === 0 || n % 1 === 0).toBe(true);
    });
    // Ticks are unique (no overlap).
    expect(new Set(ticks).size).toBe(ticks.length);
  });
  it('renders a line path + a point per data point', () => {
    const { container } = render(<ChartBlock spec={line} />);
    expect(container.querySelectorAll('.chat-chart-line').length).toBe(1);
    expect(container.querySelectorAll('.chat-chart-point').length).toBe(line.series && !Array.isArray(line.series) ? line.series.points.length : 0);
  });
});

describe('ChartBlock — provenance + a11y', () => {
  it('shows Model-generated when no source', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'x', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('.chat-chart-provenance')?.textContent).toBe('Model-generated');
  });
  it('shows Source: <x> when source is set', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'x', source: 'CRM', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('.chat-chart-provenance')?.textContent).toBe('Source: CRM');
  });
  it('carries role=figure + aria-label', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'Sales', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('[role="figure"]')?.getAttribute('aria-label')).toBe('Sales');
  });
});

describe('ChartBlock — pie whole guard (Rule 3)', () => {
  it('renders the error card when slices do not sum to the declared whole', () => {
    const badPie: ChartSpec = {
      schemaVersion: 2, type: 'pie', title: 'Bad',
      whole: { total: 100, tolerance: 0.02 },
      series: { points: [{ label: 'A', value: 60 }, { label: 'B', value: 30 }] }, // sums to 90, not 100
    };
    const { container } = render(<ChartBlock spec={badPie} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toMatch(/couldn't be rendered|outside the declared whole/);
  });
  it('renders the pie when slices sum to the whole', () => {
    const goodPie: ChartSpec = {
      schemaVersion: 2, type: 'pie', title: 'Good',
      whole: { total: 100, tolerance: 0.02 },
      series: { points: [{ label: 'A', value: 60 }, { label: 'B', value: 40 }] },
    };
    const { container } = render(<ChartBlock spec={goodPie} />);
    expect(container.querySelectorAll('.chat-chart-slice').length).toBe(2);
  });
});

describe('ChartBlock — multi-series legend', () => {
  it('renders a legend for multi-line', () => {
    const ml: ChartSpec = {
      schemaVersion: 2, type: 'multi-line', title: 'Two',
      series: [
        { name: 'A', points: [{ label: '1', value: 1 }, { label: '2', value: 2 }] },
        { name: 'B', points: [{ label: '1', value: 3 }, { label: '2', value: 4 }] },
      ],
    };
    const { container } = render(<ChartBlock spec={ml} />);
    expect(container.querySelectorAll('.chat-chart-legend').length).toBeGreaterThan(0);
  });
});

describe('ChartErrorCard — Rule 2', () => {
  it('renders the error + a raw-data toggle, role=alert', () => {
    const { container } = render(<ChartErrorCard error="bad shape" rawText="{ oops" />);
    expect(container.textContent).toMatch(/couldn't be rendered/);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('.chat-chart-error-raw')).toBeNull();
  });
});
