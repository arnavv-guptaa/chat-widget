/**
 * Shared chart geometry + scales + theming helpers.
 *
 * The single most important function here is `niceScale` — it produces an axis
 * that snaps to a round step grid (no orphan 8.1 tick clipped at the baseline,
 * which was the line-chart bug in v1's `niceTicks`). Every renderer routes its
 * y-axis (and scatter's x-axis) through it so the fix is in one place.
 *
 * Honesty rules encoded here (not the schema, so the model can't override):
 *   - bar/area/stacked-bar/grouped-bar: y-min forced to 0.
 *   - line/multi-line: y-min padded by 10% of the span but never clipped to the
 *     top sliver; for all-positive data it may touch 0 but never goes negative.
 *   - the scale is always [floor-to-step-min, ceil-to-step-max] so ticks are
 *     round and the data sits comfortably inside the plot area.
 */

/** SVG canvas geometry — shared by every renderer for visual consistency. */
export const VIEW_W = 640;
export const VIEW_H = 380;
export const PAD_LEFT = 52;
export const PAD_RIGHT = 20;
export const PAD_TOP = 16;
export const PAD_BOTTOM = 52;
export const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
export const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

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
 * @param forceZero  force the min to 0 (bar/area honesty rule)
 * @param maxTicks  target tick count (~4-5)
 */
export function niceScale(
  dataMin: number,
  dataMax: number,
  forceZero = false,
  maxTicks = 5,
): Scale {
  // Degenerate / single-value data: expand to a unit range so it renders.
  if (dataMin === dataMax) {
    if (dataMin === 0) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
    const span = Math.abs(dataMin) * 0.5 || 1;
    dataMin -= span;
    dataMax += span;
  }

  // Honesty: bar/area must start at 0.
  if (forceZero) dataMin = Math.min(0, dataMin);

  const range = niceNum(dataMax - dataMin, false);
  const step = niceNum(range / Math.max(1, maxTicks - 1), true);
  const min = forceZero ? 0 : Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step;

  const ticks: number[] = [];
  // Start at the floored min, step to the ceiled max. Use a small epsilon to
  // dodge float drift at the upper bound.
  for (let v = min; v <= max + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min, max, step, ticks };
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

/** Map a data value to an SVG y coordinate given a scale. */
export function yToPx(value: number, scale: Scale): number {
  const t = (value - scale.min) / (scale.max - scale.min || 1);
  return PAD_TOP + PLOT_H * (1 - t);
}

/** Map a data value to an SVG x coordinate given a scale (scatter). */
export function xToPxScatter(value: number, scale: Scale): number {
  const t = (value - scale.min) / (scale.max - scale.min || 1);
  return PAD_LEFT + PLOT_W * t;
}

/** Map a categorical index [0..n-1] to an SVG x center (bar/line). */
export function categoryX(i: number, n: number): number {
  if (n <= 1) return PAD_LEFT + PLOT_W / 2;
  return PAD_LEFT + (PLOT_W / (n - 1)) * i;
}

/** Map a categorical index to the left edge of its slot (for bar widths). */
export function categorySlotX(i: number, n: number): number {
  const slot = PLOT_W / n;
  return PAD_LEFT + slot * i;
}
export function categorySlotWidth(n: number): number {
  return PLOT_W / n;
}

/** Format a tick compactly: 1200 -> "1.2k", 1500000 -> "1.5M", 0.045 -> "0.045". */
export function formatTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (Number.isInteger(n)) return String(n);
  // Small fractions: trim trailing zeros, cap precision.
  return String(Number(n.toFixed(3)));
}

/**
 * The mordn chart color ramp. A single-hue ramp keyed to `--chat-primary` for
 * ranked/ordinal data (the honest default — a categorical rainbow implies N
 * unrelated categories for what is often a ranked series), with distinct hues
 * for genuinely categorical multi-series. The ramp is CSS-var-driven so it
 * tracks the theme (light/dark/white-label) for free.
 *
 * Returns an array of CSS color values; index by series/slice.
 */
export function seriesColors(count: number): string[] {
  if (count <= 1) return ['hsl(var(--chat-primary))'];
  // Up to 4 series: a primary ramp (descending opacity reads as "rank").
  if (count <= 4) {
    const opacities = [1, 0.72, 0.52, 0.34];
    return opacities.slice(0, count).map((o) => `hsl(var(--chat-primary) / ${o})`);
  }
  // 5+: distinct hues, but drawn from a small, perceptually-spaced set anchored
  // on the primary so it still feels of-a-piece (not a 12-color rainbow).
  // Uses oklch-ish stops via hsl rotation around the primary's hue slot.
  // Kept to a hand-picked 8-color max (count is capped at 12 by the schema;
  // beyond 8 the ramp repeats with reduced opacity, which still reads as
  // "more of the same family" rather than a rainbow explosion).
  const hues = [
    'hsl(var(--chat-primary))',
    'hsl(var(--chat-primary-2, calc(var(--chat-primary-h, 24) + 35deg)) 70% 50%)',
    'hsl(var(--chat-primary-3, calc(var(--chat-primary-h, 24) + 180deg)) 60% 45%)',
    'hsl(var(--chat-primary-4, calc(var(--chat-primary-h, 24) + 60deg)) 65% 50%)',
    'hsl(var(--chat-primary-5, calc(var(--chat-primary-h, 24) + 210deg)) 55% 50%)',
    'hsl(var(--chat-primary-6, calc(var(--chat-primary-h, 24) + 120deg)) 55% 45%)',
    'hsl(var(--chat-primary-7, calc(var(--chat-primary-h, 24) + 300deg)) 55% 50%)',
    'hsl(var(--chat-primary-8, calc(var(--chat-primary-h, 24) + 90deg)) 60% 45%)',
  ];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i < hues.length) out.push(hues[i]);
    else out.push(hues[i % hues.length].replace(')', ` / 0.55)`));
  }
  return out;
}

/** Resolve a series color: honor a model/host hex hint, else the ramp slot. */
export function resolveSeriesColor(
  hint: string | undefined,
  rampSlot: number,
  ramp: string[],
): string {
  if (hint && /^#[0-9a-fA-F]{3,8}$/.test(hint)) return hint;
  return ramp[Math.min(rampSlot, ramp.length - 1)] ?? 'hsl(var(--chat-primary))';
}

/** Trim a label to a max length with an ellipsis, for axis ticks. */
export function trimLabel(label: string, max = 12): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
