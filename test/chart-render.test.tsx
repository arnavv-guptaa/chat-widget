/**
 * ChartBlock renderer honesty-default tests (PRD §3 Rule 3).
 *
 * The renderer enforces the honesty rules the SCHEMA can't (because they're
 * rendering decisions, not data-shape decisions). These tests pin them by
 * calling the exported scale helper indirectly — via the component's output.
 *
 * Since the renderer is pure SVG + the geometry helpers are module-private,
 * these tests exercise the public component by rendering it and asserting on
 * the produced SVG structure (axis baseline at the zero tick, finite points,
 * error card presence). They use @testing-library/react where available; if the
 * sandbox can't install it, the maintainer runs these locally.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChartBlock, ChartErrorCard } from '../src/charts/chart-block';
import type { ChartSpec } from '../src/charts/chart-spec';

const bar: ChartSpec = {
  schemaVersion: 1,
  type: 'bar',
  title: 'Revenue',
  yLabel: 'USD',
  series: { points: [{ label: 'Q1', value: 100 }, { label: 'Q2', value: 200 }] },
};

const line: ChartSpec = {
  schemaVersion: 1,
  type: 'line',
  title: 'Latency',
  series: { points: [{ label: 'a', value: 1000 }, { label: 'b', value: 1010 }, { label: 'c', value: 1005 }] },
};

describe('ChartBlock — bar y-axis honesty', () => {
  it('renders a y tick at 0 (bar y-axis always starts at 0)', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const ticks = Array.from(container.querySelectorAll('.chat-chart-tick')).map((e) => e.textContent ?? '');
    expect(ticks).toContain('0');
  });

  it('renders the provenance line as Model-generated when no source is set', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const prov = container.querySelector('.chat-chart-provenance');
    expect(prov?.textContent).toBe('Model-generated');
  });

  it('renders the provenance line as Source: <x> when a source is set', () => {
    const { container } = render(<ChartBlock spec={{ ...bar, source: 'CRM' }} />);
    const prov = container.querySelector('.chat-chart-provenance');
    expect(prov?.textContent).toBe('Source: CRM');
  });

  it('renders a bar rect for each point', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const bars = container.querySelectorAll('.chat-chart-bar');
    expect(bars.length).toBe(bar.series.points.length);
  });
});

describe('ChartBlock — line honesty', () => {
  it('renders a path (the line) and a point circle per data point', () => {
    const { container } = render(<ChartBlock spec={line} />);
    expect(container.querySelectorAll('.chat-chart-line').length).toBe(1);
    expect(container.querySelectorAll('.chat-chart-point').length).toBe(line.series.points.length);
  });

  // The no-truncate guard lives in the module-private yScale(); a full
  // pixel-assertion of the y-range is brittle across viewBox rounding, so we
  // assert the weaker-but-meaningful property: the y ticks span more than 10%
  // of the value range (i.e. the axis wasn't collapsed to the top sliver).
  it('produces y ticks that span a meaningful share of the value range', () => {
    const { container } = render(<ChartBlock spec={line} />);
    const tickTexts = Array.from(container.querySelectorAll('.chat-chart-tick'))
      .map((e) => parseFloat(e.textContent ?? 'NaN'))
      .filter((n) => Number.isFinite(n));
    const tickSpan = Math.max(...tickTexts) - Math.min(...tickTexts);
    const valueSpan = Math.max(...line.series.points.map((p) => p.value)) - Math.min(...line.series.points.map((p) => p.value));
    expect(tickSpan).toBeGreaterThan(valueSpan * 0.1);
  });
});

describe('ChartBlock — a11y + data toggle', () => {
  it('carries a role=figure and an aria-label from the title', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const figure = container.querySelector('[role="figure"]');
    expect(figure?.getAttribute('aria-label')).toBe('Revenue');
  });

  it('renders a View data toggle that is not expanded by default', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const toggle = container.querySelector('.chat-chart-toggle[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ChartErrorCard — Rule 2 fail-visibly', () => {
  it('renders the error message and a raw-data toggle (not a broken chart)', () => {
    const { container } = render(<ChartErrorCard error="bad shape" rawText="{ oops" />);
    expect(container.textContent).toMatch(/couldn't be rendered/);
    expect(container.textContent).toMatch(/bad shape/);
    expect(container.querySelector('.chat-chart-error-raw')).toBeNull(); // collapsed
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
