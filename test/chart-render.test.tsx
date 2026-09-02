/**
 * @vitest-environment jsdom
 *
 * Renderer tests: honesty defaults (PRD §3 Rule 3), the v2 y-axis fix, and the
 * v3 quality pass (negative data, label thinning, tooltip, HTML legend, donut
 * list, pixel-true frame).
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ChartBlock, ChartErrorCard } from '../src/charts/chart-block';
import { FALLBACK_WIDTH, formatTick, makeFrame, niceScale, planCategoryLabels } from '../src/charts/chart-geometry';
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

/** The screenshot case: a watchlist with two losers. */
const watchlist: ChartSpec = {
  schemaVersion: 2,
  type: 'bar',
  title: '5-Day Price Move — Watchlist',
  subtitle: 'Aug 25 → Aug 31, 2026',
  yLabel: '% Change',
  series: { points: [
    { label: 'TSLA', value: 5.1 }, { label: 'MSFT', value: 3.2 }, { label: 'AAPL', value: 2.2 }, { label: 'DBS', value: 1.3 },
    { label: 'OCBC', value: 0.1 }, { label: 'AMZN', value: -0.5 }, { label: 'GOOG', value: -1.0 },
  ] },
};

const ticks = (container: HTMLElement) => Array.from(container.querySelectorAll('.chat-chart-tick')).map((e) => e.textContent ?? '');
const num = (v: string | null) => parseFloat(v ?? 'NaN');

describe('niceScale — the y-axis', () => {
  it('produces only round grid ticks (no orphan fractional tick)', () => {
    const s = niceScale(12, 51, false);
    s.ticks.forEach((t) => {
      expect(Math.abs((t - s.min) / s.step - Math.round((t - s.min) / s.step))).toBeLessThan(1e-6);
    });
    expect(s.ticks[0]).toBe(s.min);
    for (let i = 1; i < s.ticks.length; i++) expect(s.ticks[i]).toBeGreaterThan(s.ticks[i - 1]);
  });

  it('forces min to 0 for all-positive bar data (honesty)', () => {
    const s = niceScale(40, 60, true);
    expect(s.min).toBe(0);
    expect(s.ticks).toContain(0);
  });

  it('includes zero INSIDE the axis when bar data has negatives (the overflow bug)', () => {
    const s = niceScale(-1.5, 5.1, true);
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThanOrEqual(5.1);
    expect(s.ticks).toContain(0);
    const allNeg = niceScale(-80, -20, true);
    expect(allNeg.max).toBe(0);
    expect(allNeg.min).toBeLessThanOrEqual(-80);
  });

  it('handles a single-value series without crashing', () => {
    const s = niceScale(5, 5, false);
    expect(s.ticks.length).toBeGreaterThan(1);
    expect(Number.isFinite(s.min)).toBe(true);
  });
});

describe('frame + labels — pixel-true layout', () => {
  it('sizes the left gutter to the widest tick label instead of a fixed pad', () => {
    const narrow = makeFrame(560, 240, { yTickLabels: ['0', '2', '4'] });
    const wide = makeFrame(560, 240, { yTickLabels: ['-1.5M', '0', '1.5M'] });
    expect(wide.left).toBeGreaterThan(narrow.left);
    expect(narrow.plotW + narrow.left + narrow.right).toBe(560);
  });

  it('thins crowded category labels instead of rotating them', () => {
    expect(planCategoryLabels(['TSLA', 'MSFT', 'AAPL'], 70).every).toBe(1);
    const dense = planCategoryLabels(Array.from({ length: 60 }, (_, i) => `Day ${i + 1}`), 8);
    expect(dense.every).toBeGreaterThan(1);
    expect(dense.every * 8).toBeGreaterThanOrEqual(40);
  });

  it('formats negatives and billions', () => {
    expect(formatTick(-1500)).toBe('-1.5k');
    expect(formatTick(2_500_000_000)).toBe('2.5B');
    expect(formatTick(-2)).toBe('-2');
  });
});

describe('ChartBlock — bar honesty', () => {
  const bar: ChartSpec = { schemaVersion: 2, type: 'bar', title: 'Rev', yLabel: 'USD', series: { points: [{ label: 'Q1', value: 100 }, { label: 'Q2', value: 200 }] } };
  it('renders a y tick at 0 (bar starts at 0)', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    expect(ticks(container)).toContain('0');
  });
  it('renders a bar per point', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    expect(container.querySelectorAll('.chat-chart-bar').length).toBe(2);
  });
  it('renders at real pixels — the svg is sized in px, not a scaling viewBox', () => {
    const { container } = render(<ChartBlock spec={bar} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe(String(FALLBACK_WIDTH));
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${FALLBACK_WIDTH} 240`);
    expect(svg.querySelectorAll('title').length).toBe(1); // one accessible title, no per-bar native tooltips
  });
});

describe('ChartBlock — negative bars (the screenshot bug)', () => {
  it('keeps every bar inside the plot, draws a zero line, and colors losses as negative', () => {
    const { container } = render(<ChartBlock spec={watchlist} />);
    const svg = container.querySelector('svg')!;
    const plotBottom = num(svg.querySelector('.chat-chart-axis')!.getAttribute('y1'));
    const zero = svg.querySelector('.chat-chart-zero');
    expect(zero).not.toBeNull();
    expect(num(zero!.getAttribute('y1'))).toBeLessThan(plotBottom);
    // Every bar path ends above the baseline: no coordinate in any bar exceeds the plot bottom.
    const bars = Array.from(svg.querySelectorAll('.chat-chart-bar'));
    expect(bars.length).toBe(7);
    for (const b of bars) {
      // Bar paths are `M x,y V y Q x,y x,y H x Q x,y x,y V y Z` — every y follows a comma or a V.
      const ys = Array.from((b.getAttribute('d') ?? '').matchAll(/(?:,|V)(-?\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
      expect(ys.length).toBeGreaterThan(0);
      ys.forEach((y) => expect(y).toBeLessThanOrEqual(plotBottom + 0.5));
    }
    const negatives = bars.filter((b) => b.getAttribute('fill') === 'var(--chat-chart-negative)');
    expect(negatives.length).toBe(2);
    // Tick labels include the negative grid value and every category label is drawn once, unrotated.
    expect(ticks(container).some((t) => t.startsWith('-'))).toBe(true);
    expect(svg.querySelectorAll('text[transform*="rotate(-30"]').length).toBe(0);
    for (const label of ['TSLA', 'MSFT', 'AAPL', 'DBS', 'OCBC', 'AMZN', 'GOOG']) expect(ticks(container)).toContain(label);
  });
});

describe('ChartBlock — hover tooltip', () => {
  it('shows a tooltip for the hovered category and hides it on leave', () => {
    const { container } = render(<ChartBlock spec={watchlist} />);
    const hits = container.querySelectorAll('.chat-chart-hits rect');
    expect(hits.length).toBe(7);
    expect(container.querySelector('.chat-chart-tooltip')).toBeNull();
    fireEvent.mouseEnter(hits[5]);
    const tip = container.querySelector('.chat-chart-tooltip')!;
    expect(tip).not.toBeNull();
    expect(tip.querySelector('.chat-chart-tooltip-title')?.textContent).toBe('AMZN');
    expect(tip.querySelector('.chat-chart-tooltip-value')?.textContent).toBe('-0.5');
    // Other bars dim while one is hovered.
    expect(container.querySelectorAll('.chat-chart-bar.is-dim').length).toBe(6);
    fireEvent.mouseLeave(container.querySelector('svg')!);
    expect(container.querySelector('.chat-chart-tooltip')).toBeNull();
  });

  it('lists every series for a multi-line hover, with swatches', () => {
    const ml: ChartSpec = {
      schemaVersion: 2, type: 'multi-line', title: 'Two',
      series: [
        { name: 'A', points: [{ label: '1', value: 1 }, { label: '2', value: 2 }] },
        { name: 'B', points: [{ label: '1', value: 3 }, { label: '2', value: 4 }] },
      ],
    };
    const { container } = render(<ChartBlock spec={ml} />);
    fireEvent.mouseEnter(container.querySelectorAll('.chat-chart-hits rect')[1]);
    const rows = container.querySelectorAll('.chat-chart-tooltip-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('A');
    expect(rows[1].querySelector('.chat-chart-tooltip-value')?.textContent).toBe('4');
    expect(container.querySelector('.chat-chart-crosshair')).not.toBeNull();
  });
});

describe('ChartBlock — line y-axis (the v2 screenshot bug)', () => {
  it('renders round y ticks with no orphan fractional value at the baseline', () => {
    const { container } = render(<ChartBlock spec={line} />);
    const numeric = ticks(container).map(num).filter((n) => Number.isFinite(n));
    numeric.forEach((n) => expect(Number.isInteger(n)).toBe(true));
    expect(new Set(ticks(container)).size).toBe(ticks(container).length);
  });
  it('renders a line path + a point per data point', () => {
    const { container } = render(<ChartBlock spec={line} />);
    expect(container.querySelectorAll('.chat-chart-line').length).toBe(1);
    expect(container.querySelectorAll('.chat-chart-point').length).toBe(8);
  });
  it('honors valueLabels', () => {
    const { container } = render(<ChartBlock spec={{ ...line, valueLabels: true }} />);
    expect(container.querySelectorAll('.chat-chart-value').length).toBe(8);
    const { container: plain } = render(<ChartBlock spec={line} />);
    expect(plain.querySelectorAll('.chat-chart-value').length).toBe(0);
  });
});

describe('ChartBlock — horizontal bars', () => {
  it('shows value labels at the bar ends by default and grows with the row count', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ label: `Region ${i + 1}`, value: (10 - i) * 7 }));
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'horizontal-bar', title: 'Ranked', series: { points } }} />);
    expect(container.querySelectorAll('.chat-chart-bar').length).toBe(10);
    expect(container.querySelectorAll('.chat-chart-value').length).toBe(10);
    expect(num(container.querySelector('svg')!.getAttribute('height'))).toBe(10 * 30 + 40);
  });
});

describe('ChartBlock — provenance + a11y', () => {
  it('shows no provenance label when no source (model-generated is a tautology in an assistant bubble)', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'x', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('.chat-chart-provenance')).toBeNull();
  });
  it('shows Source: <x> when source is set', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'x', source: 'CRM', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('.chat-chart-provenance')?.textContent).toBe('Source: CRM');
  });
  it('carries role=figure + aria-label', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'Sales', series: { points: [{ label: 'a', value: 1 }] } }} />);
    expect(container.querySelector('[role="figure"]')?.getAttribute('aria-label')).toBe('Sales');
  });
  it('right-aligns numeric columns in the data table', () => {
    const { container, getByRole } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'bar', title: 'Sales', series: { points: [{ label: 'a', value: 1 }] } }} />);
    fireEvent.click(getByRole('button', { name: 'View data' }));
    expect(container.querySelectorAll('td.is-num').length).toBe(1);
  });
});

describe('ChartBlock — pie whole guard (Rule 3) + donut list', () => {
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
  it('renders the pie when slices sum to the whole, with a slice list', () => {
    const goodPie: ChartSpec = {
      schemaVersion: 2, type: 'pie', title: 'Good',
      whole: { total: 100, tolerance: 0.02 },
      series: { points: [{ label: 'A', value: 60 }, { label: 'B', value: 40 }] },
    };
    const { container } = render(<ChartBlock spec={goodPie} />);
    expect(container.querySelectorAll('.chat-chart-slice').length).toBe(2);
    const rows = container.querySelectorAll('.chat-chart-pie-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('60%');
  });
  it('a donut shows the total in the center and the hovered share on hover', () => {
    const donut: ChartSpec = {
      schemaVersion: 2, type: 'donut', title: 'Share',
      whole: { total: 100, tolerance: 0.02 },
      series: { points: [{ label: 'Alpha', value: 75 }, { label: 'Beta', value: 25 }] },
    };
    const { container } = render(<ChartBlock spec={donut} />);
    expect(container.querySelector('.chat-chart-donut-value')?.textContent).toBe('100');
    fireEvent.mouseEnter(container.querySelectorAll('.chat-chart-slice')[1]);
    expect(container.querySelector('.chat-chart-donut-value')?.textContent).toBe('25%');
    expect(container.querySelector('.chat-chart-donut-label')?.textContent).toBe('Beta');
    expect(container.querySelector('.chat-chart-pie-row.is-active')?.textContent).toContain('Beta');
  });
});

describe('ChartBlock — multi-series legend', () => {
  const ml: ChartSpec = {
    schemaVersion: 2, type: 'multi-line', title: 'Two',
    series: [
      { name: 'A', points: [{ label: '1', value: 1 }, { label: '2', value: 2 }] },
      { name: 'B', points: [{ label: '1', value: 3 }, { label: '2', value: 4 }] },
    ],
  };
  it('renders an HTML legend above the plot, never inside the svg', () => {
    const { container } = render(<ChartBlock spec={ml} />);
    const items = container.querySelectorAll('.chat-chart-legend');
    expect(items.length).toBe(2);
    expect(container.querySelector('svg .chat-chart-legend')).toBeNull();
    expect(items[0].textContent).toBe('A');
  });
  it('omits the legend when legend: false', () => {
    const { container } = render(<ChartBlock spec={{ ...ml, legend: false }} />);
    expect(container.querySelectorAll('.chat-chart-legend').length).toBe(0);
  });
  it('renders stacked and grouped bars with a segment per series', () => {
    const stacked: ChartSpec = { ...ml, type: 'stacked-bar' };
    const grouped: ChartSpec = { ...ml, type: 'grouped-bar' };
    expect(render(<ChartBlock spec={stacked} />).container.querySelectorAll('.chat-chart-bar').length).toBe(4);
    expect(render(<ChartBlock spec={grouped} />).container.querySelectorAll('.chat-chart-bar').length).toBe(4);
  });
});

describe('ChartBlock — scatter + sparkline', () => {
  it('renders a dot per scatter point', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'scatter', title: 'S', scatter: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 5 }] }} />);
    expect(container.querySelectorAll('.chat-chart-dot').length).toBe(3);
  });
  it('renders a sparkline with its last value', () => {
    const { container } = render(<ChartBlock spec={{ schemaVersion: 2, type: 'sparkline', title: 'Trend', series: { points: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }, { label: 'c', value: 2 }] } }} />);
    expect(container.querySelector('.chat-chart-sparkline')).not.toBeNull();
    expect(container.querySelector('.chat-chart-sparkline-value')?.textContent).toBe('2');
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
