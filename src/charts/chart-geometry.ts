/**
 * Shared chart geometry + scales + theming helpers.
 *
 * v3 renders at REAL PIXELS. Every chart measures its container width (see
 * use-chart-width.ts) and lays out a `Frame` in CSS pixels, so type is always
 * 11px and hairlines are always 1px — no more SVG text that shrinks with the
 * message column or balloons in a wide panel. The height is fixed per chart
 * kind; the width follows the card.
 *
 * `niceScale` is still the heart of it — a Heckbert nice-numbers axis that
 * snaps to a round step grid. v3 fixes the negative-data case: `forceZero`
 * now means "the axis INCLUDES zero", not "the axis starts at zero", so a bar
 * chart with losses gets a baseline in the middle of the plot instead of bars
 * drawn below the axis over the tick labels.
 *
 * Honesty rules encoded here (not the schema, so the model can't override):
 *   - bar/area/stacked-bar/grouped-bar: the value axis always includes 0.
 *   - line/multi-line: the axis pads to round steps around the data; it may
 *     touch 0 but never truncates the range to a flattering sliver.
 *   - the scale is always [floor-to-step, ceil-to-step] so ticks are round.
 */

/** Chart heights in CSS px. Widths follow the container. */
export const CARTESIAN_HEIGHT = 240;
export const PIE_HEIGHT = 220;
export const SPARKLINE_HEIGHT = 40;
/** Width used before the container has been measured (SSR, jsdom). */
export const FALLBACK_WIDTH = 560;
export const MIN_WIDTH = 220;

/** Type metrics for layout estimates (11px UI sans). */
export const FONT_SIZE = 11;
const CHAR_W = FONT_SIZE * 0.58;

/** Estimate the rendered width of a label in px (no DOM measurement needed). */
export function estimateTextWidth(text: string, size = FONT_SIZE): number {
  return text.length * size * 0.58;
}

/** The pixel frame a cartesian chart is laid out in. */
export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotW: number;
  plotH: number;
}

export interface FrameOptions {
  /** Tick strings on the left axis — the gutter is sized to the widest one. */
  yTickLabels?: string[];
  /** Category strings on the left axis (horizontal bars). */
  leftLabels?: string[];
  hasXLabel?: boolean;
  hasYLabel?: boolean;
  /** Whether the bottom edge carries tick labels at all. */
  hasXTicks?: boolean;
}

/** Build a frame: gutters sized to the labels they hold, never a fixed 52px. */
export function makeFrame(width: number, height: number, opts: FrameOptions = {}): Frame {
  const w = Math.max(MIN_WIDTH, Math.round(width));
  const labels = [...(opts.yTickLabels ?? []), ...(opts.leftLabels ?? [])];
  const widest = labels.reduce((m, l) => Math.max(m, estimateTextWidth(l)), 0);
  const left = Math.round(Math.min(w * 0.4, (labels.length ? widest + 12 : 8) + (opts.hasYLabel ? 18 : 0) + 4));
  const right = 12;
  const top = 12;
  const bottom = (opts.hasXTicks === false ? 8 : 26) + (opts.hasXLabel ? 16 : 0);
  return { width: w, height, left, right, top, bottom, plotW: Math.max(1, w - left - right), plotH: Math.max(1, height - top - bottom) };
}

/** A computed axis scale. */
export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * The nice-scale algorithm (a cleaned-up Nice Numbers / Heckbert). Produces a
 * [min, max] that snaps to a round step and a tick list that spans the data
 * with comfortable padding — never an orphan fractional tick at the baseline.
 *
 * @param dataMin  the minimum data value
 * @param dataMax  the maximum data value
 * @param forceZero  the axis must include 0 (bar/area honesty rule). With
 *                   all-positive data the axis starts at 0; with negatives it
 *                   extends below 0 so the baseline sits inside the plot.
 * @param maxTicks  target tick count (~4-5)
 */
export function niceScale(dataMin: number, dataMax: number, forceZero = false, maxTicks = 5): Scale {
  // Degenerate / single-value data: expand to a unit range so it renders.
  if (dataMin === dataMax) {
    if (dataMin === 0) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
    const span = Math.abs(dataMin) * 0.5 || 1;
    dataMin -= span;
    dataMax += span;
  }

  // Honesty: the value axis of a bar/area chart includes 0.
  if (forceZero) {
    dataMin = Math.min(0, dataMin);
    dataMax = Math.max(0, dataMax);
  }

  const range = niceNum(dataMax - dataMin, false);
  const step = niceNum(range / Math.max(1, maxTicks - 1), true);
  const min = Math.floor(dataMin / step + 1e-9) * step;
  const max = Math.ceil(dataMax / step - 1e-9) * step;

  const ticks: number[] = [];
  // Start at the floored min, step to the ceiled max. Use a small epsilon to
  // dodge float drift at the upper bound.
  for (let v = min; v <= max + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: Number(min.toFixed(6)), max: Number(max.toFixed(6)), step, ticks };
}

/** Heckbert's "nice number" — rounds a value to a clean 1/2/5 × 10^n. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1));
  const fraction = (range || 1) / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Map a data value to a y pixel inside the frame. */
export function yToPx(value: number, scale: Scale, f: Frame): number {
  const t = (value - scale.min) / (scale.max - scale.min || 1);
  return f.top + f.plotH * (1 - t);
}

/** Map a data value to an x pixel inside the frame (scatter, horizontal bars). */
export function xToPx(value: number, scale: Scale, f: Frame): number {
  const t = (value - scale.min) / (scale.max - scale.min || 1);
  return f.left + f.plotW * t;
}

/** Width of one category slot. */
export function slotWidth(n: number, f: Frame): number {
  return f.plotW / Math.max(1, n);
}

/** Center x of category `i` when categories are slots (bars). */
export function slotCenter(i: number, n: number, f: Frame): number {
  const slot = slotWidth(n, f);
  return f.left + slot * i + slot / 2;
}

/** x of point `i` when categories are points along the axis (lines). */
export function pointX(i: number, n: number, f: Frame): number {
  if (n <= 1) return f.left + f.plotW / 2;
  return f.left + (f.plotW / (n - 1)) * i;
}

/**
 * Decide which category labels to draw, and how long they may be, so labels
 * never overlap and never rotate. Rotated labels are the tell of a chart that
 * gave up on layout; thinning keeps every drawn label legible and the tooltip
 * carries the full text for the rest.
 *
 * @param spacing  pixels between adjacent label anchors
 */
export function planCategoryLabels(labels: string[], spacing: number): { every: number; maxChars: number } {
  const MIN_SPACING = 40;
  let every = 1;
  while (spacing * every < MIN_SPACING && every < labels.length) every++;
  const room = spacing * every - 8;
  const maxChars = Math.max(3, Math.min(28, Math.floor(room / CHAR_W)));
  return { every, maxChars };
}

/**
 * Format a value compactly: 1200 -> "1.2k", 1500000 -> "1.5M", 2.5e9 -> "2.5B",
 * 0.045 -> "0.045". Negative values keep their sign.
 */
export function formatTick(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${trimZeros((abs / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${sign}${trimZeros((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${trimZeros((abs / 1_000).toFixed(1))}k`;
  if (Number.isInteger(n)) return String(n);
  // Small fractions: trim trailing zeros, cap precision.
  return String(Number(n.toFixed(3)));
}

function trimZeros(s: string): string {
  return s.replace(/\.0$/, '');
}

/**
 * The chart palette. Series colors are CSS custom properties declared on
 * `.chat-chart` in styles.src.css, so they follow the theme and can be
 * overridden per host (`--chat-chart-1` … `--chat-chart-8`).
 *
 *   - single series: `--chat-chart-1` (= `--chat-primary`) — the honest
 *     ordinal default; a ranked series is one thing, not N categories
 *   - multiple named series: the categorical set. The defaults derive every
 *     hue from the brand primary with `color-mix()`, so a white-label theme
 *     gets a palette that is of-a-piece with its accent for free.
 */
export const PALETTE_SIZE = 8;

export function seriesColors(count: number): string[] {
  if (count <= 1) return ['var(--chat-chart-1)'];
  return Array.from({ length: count }, (_, i) => `var(--chat-chart-${(i % PALETTE_SIZE) + 1})`);
}

/** Color for a value that is below zero (losses, declines). */
export const NEGATIVE_COLOR = 'var(--chat-chart-negative)';

/** Resolve a series color: honor a model/host hex hint, else the palette slot. */
export function resolveSeriesColor(hint: string | undefined, rampSlot: number, ramp: string[]): string {
  if (hint && /^#[0-9a-fA-F]{3,8}$/.test(hint)) return hint;
  return ramp[Math.min(rampSlot, ramp.length - 1)] ?? 'var(--chat-chart-1)';
}

/** Trim a label to a max length with an ellipsis, for axis ticks. */
export function trimLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}

/** Round to one decimal for crisp path data. */
export function px(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * A bar path with radius only on the OUTER end (the end away from the
 * baseline). Rounding both ends makes a bar read as a pill; rounding the
 * baseline end lifts it off the axis.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number, side: 'top' | 'bottom' | 'left' | 'right'): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (h <= 0 || w <= 0) return '';
  const X = px, x2 = x + w, y2 = y + h;
  switch (side) {
    case 'top':
      return `M${X(x)},${X(y2)} V${X(y + rr)} Q${X(x)},${X(y)} ${X(x + rr)},${X(y)} H${X(x2 - rr)} Q${X(x2)},${X(y)} ${X(x2)},${X(y + rr)} V${X(y2)} Z`;
    case 'bottom':
      return `M${X(x)},${X(y)} V${X(y2 - rr)} Q${X(x)},${X(y2)} ${X(x + rr)},${X(y2)} H${X(x2 - rr)} Q${X(x2)},${X(y2)} ${X(x2)},${X(y2 - rr)} V${X(y)} Z`;
    case 'right':
      return `M${X(x)},${X(y)} H${X(x2 - rr)} Q${X(x2)},${X(y)} ${X(x2)},${X(y + rr)} V${X(y2 - rr)} Q${X(x2)},${X(y2)} ${X(x2 - rr)},${X(y2)} H${X(x)} Z`;
    case 'left':
      return `M${X(x2)},${X(y)} H${X(x + rr)} Q${X(x)},${X(y)} ${X(x)},${X(y + rr)} V${X(y2 - rr)} Q${X(x)},${X(y2)} ${X(x + rr)},${X(y2)} H${X(x2)} Z`;
  }
}
