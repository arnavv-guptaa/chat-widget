'use client';

/**
 * Chart renderers — one pure-SVG component per ChartType, sharing the pixel
 * frame, scales, and palette in chart-geometry.ts.
 *
 * v3 principles (the "does this look like a product or a homework plot" bar):
 *   - real pixels: 11px type and 1px hairlines at every card width
 *   - the value axis of a bar chart INCLUDES zero; with losses the baseline
 *     moves into the plot and negative bars take the negative color
 *   - category labels are thinned, never rotated; the tooltip carries the
 *     full text
 *   - gridlines only, no y-axis line; one baseline hairline
 *   - a real hover tooltip with crosshair / highlight, no native <title>s
 *   - legends live in HTML under the plot (ChartBlock), never inside it
 *
 * No chart library. All colors from the `--chat-*` token ramp via the
 * `--chat-chart-*` palette declared in styles.src.css.
 */
import { useId, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import type { ChartSpec, ChartSeries } from './chart-spec';
import { asSeriesArray } from './chart-spec';
import {
  CARTESIAN_HEIGHT,
  PIE_HEIGHT,
  SPARKLINE_HEIGHT,
  NEGATIVE_COLOR,
  makeFrame,
  niceScale,
  yToPx,
  xToPx,
  slotWidth,
  slotCenter,
  pointX,
  planCategoryLabels,
  formatTick,
  seriesColors,
  resolveSeriesColor,
  trimLabel,
  barPath,
  px,
  type Frame,
  type Scale,
} from './chart-geometry';
import { ChartTooltip, type TooltipRow, type TooltipState } from './chart-tooltip';

export interface RendererProps {
  spec: ChartSpec;
  /** Container width in CSS px (measured by ChartBlock). */
  width: number;
}

/** One legend entry. ChartBlock renders these as HTML under the plot. */
export interface LegendItem {
  name: string;
  color: string;
}

// ── shared chrome ─────────────────────────────────────────────────────────────

interface XLabel {
  x: number;
  label: string;
}

/** Y gridlines + ticks, x baseline + thinned labels, axis titles. */
function AxisChrome({ f, yScale, xLabels, xLabel, yLabel }: { f: Frame; yScale: Scale; xLabels: XLabel[]; xLabel?: string; yLabel?: string }) {
  const spacing = xLabels.length > 1 ? Math.abs(xLabels[1].x - xLabels[0].x) : f.plotW;
  const plan = planCategoryLabels(xLabels.map((l) => l.label), spacing);
  const baseY = f.top + f.plotH;
  return (
    <g>
      {yScale.ticks.map((t) => {
        const y = yToPx(t, yScale, f);
        const isBase = Math.abs(y - baseY) < 0.5;
        return (
          <g key={t}>
            {!isBase ? <line x1={f.left} y1={px(y)} x2={f.left + f.plotW} y2={px(y)} className="chat-chart-gridline" /> : null}
            <text x={f.left - 8} y={y} dy="0.35em" textAnchor="end" className="chat-chart-tick">
              {formatTick(t)}
            </text>
          </g>
        );
      })}
      <line x1={f.left} y1={px(baseY)} x2={f.left + f.plotW} y2={px(baseY)} className="chat-chart-axis" />
      {xLabels.map((l, i) =>
        i % plan.every === 0 ? (
          <text key={i} x={l.x} y={baseY + 16} textAnchor="middle" className="chat-chart-tick">
            {trimLabel(l.label, plan.maxChars)}
          </text>
        ) : null,
      )}
      {yLabel ? (
        <text x={-(f.top + f.plotH / 2)} y={12} transform="rotate(-90)" textAnchor="middle" className="chat-chart-axislabel">
          {yLabel}
        </text>
      ) : null}
      {xLabel ? (
        <text x={f.left + f.plotW / 2} y={f.height - 5} textAnchor="middle" className="chat-chart-axislabel">
          {xLabel}
        </text>
      ) : null}
    </g>
  );
}

/** The emphasized zero line, drawn only when the axis crosses zero. */
function ZeroLine({ f, scale }: { f: Frame; scale: Scale }) {
  if (scale.min >= 0) return null;
  const y = yToPx(0, scale, f);
  return <line x1={f.left} y1={px(y)} x2={f.left + f.plotW} y2={px(y)} className="chat-chart-zero" />;
}

/** Transparent per-category hit targets that drive the hover state. */
function HitSlots({ f, n, onHover, centers }: { f: Frame; n: number; centers: (i: number) => number; onHover: (i: number | null) => void }) {
  const slot = n > 1 ? Math.abs(centers(1) - centers(0)) : f.plotW;
  return (
    <g className="chat-chart-hits">
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={px(centers(i) - slot / 2)}
          y={f.top}
          width={px(Math.max(1, slot))}
          height={f.plotH}
          fill="transparent"
          onMouseEnter={() => onHover(i)}
          onClick={() => onHover(i)}
          data-index={i}
        />
      ))}
    </g>
  );
}

function useHover(): [number | null, (i: number | null) => void] {
  const [i, setI] = useState<number | null>(null);
  return [i, setI];
}

function svgProps(f: Frame, title: string) {
  return {
    width: f.width,
    height: f.height,
    viewBox: `0 0 ${f.width} ${f.height}`,
    role: 'img' as const,
    'aria-label': title,
    className: 'chat-chart-svg',
  };
}

function seriesRows(serieses: ChartSeries[], colors: string[], i: number): TooltipRow[] {
  return serieses.map((s, si) => ({
    swatch: serieses.length > 1 ? colors[si] : undefined,
    name: serieses.length > 1 ? s.name ?? `Series ${si + 1}` : undefined,
    value: formatTick(s.points[i]?.value ?? 0),
  }));
}

// ── bar ──────────────────────────────────────────────────────────────────────
export function BarChart({ spec, width }: RendererProps): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const n = points.length;
  const values = points.map((p) => p.value);
  const scale = niceScale(Math.min(...values), Math.max(...values), true);
  const f = makeFrame(width, CARTESIAN_HEIGHT, { yTickLabels: scale.ticks.map(formatTick), hasXLabel: !!spec.xLabel, hasYLabel: !!spec.yLabel });
  const slot = slotWidth(n, f);
  const barW = Math.max(4, Math.min(slot * 0.6, 40));
  const color = resolveSeriesColor(series.color, 0, seriesColors(1));
  const hasNeg = values.some((v) => v < 0);
  const zeroY = yToPx(0, scale, f);
  const [hover, setHover] = useHover();
  const xLabels = points.map((p, i) => ({ x: slotCenter(i, n, f), label: p.label }));

  let tip: TooltipState | null = null;
  if (hover !== null && points[hover]) {
    const v = points[hover].value;
    tip = { x: slotCenter(hover, n, f), y: Math.min(yToPx(v, scale, f), zeroY), title: points[hover].label, rows: [{ value: formatTick(v) }] };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        <AxisChrome f={f} yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} />
        <ZeroLine f={f} scale={scale} />
        {points.map((p, i) => {
          const cx = slotCenter(i, n, f);
          const y = yToPx(p.value, scale, f);
          const top = Math.min(y, zeroY);
          const h = Math.abs(zeroY - y);
          const neg = p.value < 0;
          return (
            <path
              key={i}
              d={barPath(cx - barW / 2, top, barW, Math.max(h, p.value === 0 ? 0 : 1), 3, neg ? 'bottom' : 'top')}
              className={`chat-chart-bar${hover !== null && hover !== i ? ' is-dim' : ''}`}
              fill={hasNeg && neg ? NEGATIVE_COLOR : resolveSeriesColor(p.color, 0, [color])}
            />
          );
        })}
        {spec.valueLabels
          ? points.map((p, i) => {
              const y = yToPx(p.value, scale, f);
              return (
                <text key={`v${i}`} x={slotCenter(i, n, f)} y={p.value < 0 ? y + 12 : y - 5} textAnchor="middle" className="chat-chart-value">
                  {formatTick(p.value)}
                </text>
              );
            })
          : null}
        <HitSlots f={f} n={n} centers={(i) => slotCenter(i, n, f)} onHover={setHover} />
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── horizontal-bar ────────────────────────────────────────────────────────────
export function HorizontalBarChart({ spec, width }: RendererProps): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const n = points.length;
  const values = points.map((p) => p.value);
  const scale = niceScale(Math.min(...values), Math.max(...values), true);
  const height = Math.max(150, Math.min(440, n * 30 + 40));
  const labels = points.map((p) => trimLabel(p.label, 18));
  const f = makeFrame(width, height, { leftLabels: labels, hasXLabel: !!spec.xLabel, hasYLabel: false });
  const rowH = f.plotH / n;
  const barH = Math.max(4, Math.min(rowH * 0.62, 26));
  const color = resolveSeriesColor(series.color, 0, seriesColors(1));
  const hasNeg = values.some((v) => v < 0);
  const zeroX = xToPx(0, scale, f);
  const showValues = spec.valueLabels !== false;
  const [hover, setHover] = useHover();

  let tip: TooltipState | null = null;
  if (hover !== null && points[hover]) {
    const v = points[hover].value;
    tip = { x: Math.max(xToPx(v, scale, f), zeroX), y: f.top + rowH * hover + rowH / 2, title: points[hover].label, rows: [{ value: formatTick(v) }] };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        {scale.ticks.map((t) => {
          const x = xToPx(t, scale, f);
          return (
            <g key={t}>
              <line x1={px(x)} y1={f.top} x2={px(x)} y2={f.top + f.plotH} className={t === 0 && scale.min < 0 ? 'chat-chart-zero' : 'chat-chart-gridline'} />
              <text x={x} y={f.top + f.plotH + 16} textAnchor="middle" className="chat-chart-tick">
                {formatTick(t)}
              </text>
            </g>
          );
        })}
        {spec.xLabel ? (
          <text x={f.left + f.plotW / 2} y={f.height - 5} textAnchor="middle" className="chat-chart-axislabel">
            {spec.xLabel}
          </text>
        ) : null}
        {points.map((p, i) => {
          const cy = f.top + rowH * i + rowH / 2;
          const xv = xToPx(p.value, scale, f);
          const x0 = Math.min(xv, zeroX);
          const w = Math.abs(xv - zeroX);
          const neg = p.value < 0;
          return (
            <g key={i} className={hover !== null && hover !== i ? 'is-dim' : undefined}>
              <text x={f.left - 8} y={cy} dy="0.35em" textAnchor="end" className="chat-chart-tick chat-chart-category">
                {labels[i]}
              </text>
              <path d={barPath(x0, cy - barH / 2, Math.max(w, p.value === 0 ? 0 : 1), barH, 3, neg ? 'left' : 'right')} className="chat-chart-bar" fill={hasNeg && neg ? NEGATIVE_COLOR : resolveSeriesColor(p.color, 0, [color])} />
              {showValues ? (
                <text x={neg ? x0 - 6 : x0 + w + 6} y={cy} dy="0.35em" textAnchor={neg ? 'end' : 'start'} className="chat-chart-value">
                  {formatTick(p.value)}
                </text>
              ) : null}
            </g>
          );
        })}
        <g className="chat-chart-hits">
          {points.map((_, i) => (
            <rect key={i} x={0} y={px(f.top + rowH * i)} width={f.width} height={px(rowH)} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} data-index={i} />
          ))}
        </g>
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── line / multi-line / area ──────────────────────────────────────────────────
export function LineChart({ spec, width, area = false }: RendererProps & { area?: boolean }): ReactElement {
  const serieses = asSeriesArray(spec);
  const longest = serieses.reduce((a, s) => (s.points.length > a.points.length ? s : a), serieses[0]);
  const n = longest.points.length;
  const allValues = serieses.flatMap((s) => s.points.map((p) => p.value));
  const scale = niceScale(Math.min(...allValues), Math.max(...allValues), area);
  const f = makeFrame(width, CARTESIAN_HEIGHT, { yTickLabels: scale.ticks.map(formatTick), hasXLabel: !!spec.xLabel, hasYLabel: !!spec.yLabel });
  const colors = seriesColors(serieses.length).map((c, i) => resolveSeriesColor(serieses[i].color, i, [c]));
  const gradientId = useId();
  const [hover, setHover] = useHover();
  const showDots = n <= 24;
  const xLabels = longest.points.map((p, i) => ({ x: pointX(i, n, f), label: p.label }));
  const baseY = f.top + f.plotH;

  let tip: TooltipState | null = null;
  if (hover !== null && longest.points[hover]) {
    const ys = serieses.map((s) => (s.points[hover] ? yToPx(s.points[hover].value, scale, f) : baseY));
    tip = { x: pointX(hover, n, f), y: Math.min(...ys), title: longest.points[hover].label, rows: seriesRows(serieses, colors, hover) };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        {area ? (
          <defs>
            {serieses.map((_, si) => (
              <linearGradient key={si} id={`${gradientId}-${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[si]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={colors[si]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
        ) : null}
        <AxisChrome f={f} yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} />
        <ZeroLine f={f} scale={scale} />
        {hover !== null ? <line x1={px(pointX(hover, n, f))} y1={f.top} x2={px(pointX(hover, n, f))} y2={baseY} className="chat-chart-crosshair" /> : null}
        {serieses.map((s, si) => {
          const m = s.points.length;
          const coords = s.points.map((p, i) => [pointX(i, m, f), yToPx(p.value, scale, f)] as const);
          const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)},${px(y)}`).join(' ');
          const areaD = area && coords.length ? `${d} L${px(coords[coords.length - 1][0])},${px(baseY)} L${px(coords[0][0])},${px(baseY)} Z` : null;
          return (
            <g key={si}>
              {areaD ? <path d={areaD} className="chat-chart-area" fill={`url(#${gradientId}-${si})`} /> : null}
              <path d={d} className="chat-chart-line" fill="none" stroke={colors[si]} />
              {coords.map(([x, y], i) => {
                const active = hover === i;
                if (!showDots && !active) return null;
                return <circle key={i} cx={px(x)} cy={px(y)} r={active ? 4.5 : 3} className={`chat-chart-point${active ? ' is-active' : ''}`} fill={colors[si]} />;
              })}
              {spec.valueLabels && showDots
                ? coords.map(([x, y], i) => (
                    <text key={`v${i}`} x={x} y={y - 8} textAnchor="middle" className="chat-chart-value">
                      {formatTick(s.points[i].value)}
                    </text>
                  ))
                : null}
            </g>
          );
        })}
        <HitSlots f={f} n={n} centers={(i) => pointX(i, n, f)} onHover={setHover} />
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── stacked-bar ────────────────────────────────────────────────────────────────
export function StackedBarChart({ spec, width }: RendererProps): ReactElement {
  const serieses = asSeriesArray(spec);
  const categories = serieses[0].points.map((p) => p.label);
  const n = categories.length;
  const sums = categories.map((_, i) => serieses.reduce((acc, s) => acc + Math.max(0, s.points[i]?.value ?? 0), 0));
  const scale = niceScale(0, Math.max(...sums, 0), true);
  const f = makeFrame(width, CARTESIAN_HEIGHT, { yTickLabels: scale.ticks.map(formatTick), hasXLabel: !!spec.xLabel, hasYLabel: !!spec.yLabel });
  const colors = seriesColors(serieses.length).map((c, i) => resolveSeriesColor(serieses[i].color, i, [c]));
  const slot = slotWidth(n, f);
  const barW = Math.max(4, Math.min(slot * 0.6, 40));
  const [hover, setHover] = useHover();
  const xLabels = categories.map((c, i) => ({ x: slotCenter(i, n, f), label: c }));

  let tip: TooltipState | null = null;
  if (hover !== null && categories[hover] !== undefined) {
    tip = {
      x: slotCenter(hover, n, f),
      y: yToPx(sums[hover], scale, f),
      title: categories[hover],
      rows: [...seriesRows(serieses, colors, hover), { name: 'Total', value: formatTick(sums[hover]) }],
    };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        <AxisChrome f={f} yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} />
        {categories.map((_, ci) => {
          const cx = slotCenter(ci, n, f);
          let acc = 0;
          const lastIdx = serieses.reduce((last, s, si) => ((s.points[ci]?.value ?? 0) > 0 ? si : last), -1);
          return (
            <g key={ci} className={hover !== null && hover !== ci ? 'is-dim' : undefined}>
              {serieses.map((s, si) => {
                const v = Math.max(0, s.points[ci]?.value ?? 0);
                if (v <= 0) return null;
                const yTop = yToPx(acc + v, scale, f);
                const yBot = yToPx(acc, scale, f);
                acc += v;
                const h = Math.max(1, yBot - yTop);
                return si === lastIdx ? (
                  <path key={si} d={barPath(cx - barW / 2, yTop, barW, h, 3, 'top')} className="chat-chart-bar" fill={colors[si]} />
                ) : (
                  <rect key={si} x={px(cx - barW / 2)} y={px(yTop)} width={px(barW)} height={px(h)} className="chat-chart-bar" fill={colors[si]} />
                );
              })}
            </g>
          );
        })}
        {spec.valueLabels
          ? sums.map((sum, i) => (
              <text key={`v${i}`} x={slotCenter(i, n, f)} y={yToPx(sum, scale, f) - 5} textAnchor="middle" className="chat-chart-value">
                {formatTick(sum)}
              </text>
            ))
          : null}
        <HitSlots f={f} n={n} centers={(i) => slotCenter(i, n, f)} onHover={setHover} />
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── grouped-bar ────────────────────────────────────────────────────────────────
export function GroupedBarChart({ spec, width }: RendererProps): ReactElement {
  const serieses = asSeriesArray(spec);
  const categories = serieses[0].points.map((p) => p.label);
  const n = categories.length;
  const k = serieses.length;
  const allValues = serieses.flatMap((s) => s.points.map((p) => p.value));
  const scale = niceScale(Math.min(...allValues), Math.max(...allValues), true);
  const f = makeFrame(width, CARTESIAN_HEIGHT, { yTickLabels: scale.ticks.map(formatTick), hasXLabel: !!spec.xLabel, hasYLabel: !!spec.yLabel });
  const colors = seriesColors(k).map((c, i) => resolveSeriesColor(serieses[i].color, i, [c]));
  const slot = slotWidth(n, f);
  const gap = 2;
  const groupW = Math.min(slot * 0.76, k * 22);
  const barW = Math.max(3, (groupW - gap * (k - 1)) / k);
  const hasNeg = allValues.some((v) => v < 0);
  const zeroY = yToPx(0, scale, f);
  const [hover, setHover] = useHover();
  const xLabels = categories.map((c, i) => ({ x: slotCenter(i, n, f), label: c }));

  let tip: TooltipState | null = null;
  if (hover !== null && categories[hover] !== undefined) {
    const ys = serieses.map((s) => yToPx(s.points[hover]?.value ?? 0, scale, f));
    tip = { x: slotCenter(hover, n, f), y: Math.min(...ys, zeroY), title: categories[hover], rows: seriesRows(serieses, colors, hover) };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        <AxisChrome f={f} yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} />
        <ZeroLine f={f} scale={scale} />
        {categories.map((_, ci) => {
          const groupX = slotCenter(ci, n, f) - (barW * k + gap * (k - 1)) / 2;
          return (
            <g key={ci} className={hover !== null && hover !== ci ? 'is-dim' : undefined}>
              {serieses.map((s, si) => {
                const v = s.points[ci]?.value ?? 0;
                const y = yToPx(v, scale, f);
                const neg = v < 0;
                const x = groupX + si * (barW + gap);
                return <path key={si} d={barPath(x, Math.min(y, zeroY), barW, Math.max(Math.abs(zeroY - y), v === 0 ? 0 : 1), 2, neg ? 'bottom' : 'top')} className="chat-chart-bar" fill={hasNeg && neg ? NEGATIVE_COLOR : colors[si]} />;
              })}
            </g>
          );
        })}
        <HitSlots f={f} n={n} centers={(i) => slotCenter(i, n, f)} onHover={setHover} />
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── pie / donut ────────────────────────────────────────────────────────────────

/**
 * Honesty guard: pie/donut slices must sum to ~the declared whole (default 100).
 * A pie that doesn't sum to a whole is the single most misleading chart there is.
 *
 * This is a PLAIN FUNCTION, called by renderChart BEFORE the element is
 * created, and that placement is load-bearing: `renderChart` only *creates*
 * elements, so ChartBlock's try/catch wraps element creation, not the component
 * call. A throw from inside the component body would escape the catch and blank
 * the whole message bubble. Validating here keeps the throw inside the try.
 */
function assertPieSumsToWhole(spec: ChartSpec): void {
  const points = asSeriesArray(spec)[0].points;
  const total = points.reduce((acc, p) => acc + p.value, 0);
  const whole = spec.whole ?? { total: 100, tolerance: 0.02 };
  const tolerance = whole.total * whole.tolerance;
  if (Math.abs(total - whole.total) > tolerance) {
    throw new Error(
      `The ${spec.type} slices sum to ${formatTick(total)}, which is outside the declared whole of ${formatTick(whole.total)} (±${formatTick(tolerance)}). A pie/donut must represent parts of a single whole.`,
    );
  }
}

export function PieChart({ spec, width, donut = false }: RendererProps & { donut?: boolean }): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const total = points.reduce((acc, p) => acc + p.value, 0);
  const size = PIE_HEIGHT;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const innerR = donut ? r * 0.64 : 0;
  const colors = seriesColors(Math.max(2, points.length));
  const [hover, setHover] = useHover();
  const sideBySide = width >= 420;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const slices = points.map((p, i) => {
    const frac = total > 0 ? p.value / total : 0;
    const sweep = frac * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + Math.min(sweep, Math.PI * 2 - 1e-4);
    angle += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const d = donut
      ? `M${px(x0)},${px(y0)} A${r},${r} 0 ${large} 1 ${px(x1)},${px(y1)} L${px(cx + innerR * Math.cos(a1))},${px(cy + innerR * Math.sin(a1))} A${innerR},${innerR} 0 ${large} 0 ${px(cx + innerR * Math.cos(a0))},${px(cy + innerR * Math.sin(a0))} Z`
      : `M${cx},${cy} L${px(x0)},${px(y0)} A${r},${r} 0 ${large} 1 ${px(x1)},${px(y1)} Z`;
    return { d, color: resolveSeriesColor(p.color, i, colors), label: p.label, value: p.value, pct: frac * 100 };
  });

  const active = hover !== null ? slices[hover] : null;

  return (
    <div className={`chat-chart-pie${sideBySide ? ' is-side' : ''}`} onMouseLeave={() => setHover(null)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={spec.title} className="chat-chart-svg">
        <title>{spec.title}</title>
        {slices.map((s, i) => (
          <path key={i} d={s.d} className={`chat-chart-slice${hover !== null && hover !== i ? ' is-dim' : ''}`} fill={s.color} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} data-index={i} />
        ))}
        {donut ? (
          <g className="chat-chart-donut-center">
            <text x={cx} y={cy - 4} textAnchor="middle" className="chat-chart-donut-value">
              {active ? `${active.pct.toFixed(active.pct < 10 ? 1 : 0)}%` : formatTick(total)}
            </text>
            <text x={cx} y={cy + 13} textAnchor="middle" className="chat-chart-donut-label">
              {active ? trimLabel(active.label, 16) : 'Total'}
            </text>
          </g>
        ) : null}
      </svg>
      <ul className="chat-chart-pie-list" aria-label="Slices">
        {slices.map((s, i) => (
          <li key={i} className={`chat-chart-legend chat-chart-pie-row${hover === i ? ' is-active' : ''}${hover !== null && hover !== i ? ' is-dim' : ''}`} onMouseEnter={() => setHover(i)} data-index={i}>
            <span className="chat-chart-swatch" style={{ background: s.color }} />
            <span className="chat-chart-pie-name">{s.label}</span>
            <span className="chat-chart-pie-value">{formatTick(s.value)}</span>
            <span className="chat-chart-pie-pct">{s.pct.toFixed(s.pct < 10 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── scatter ────────────────────────────────────────────────────────────────────
export function ScatterChart({ spec, width }: RendererProps): ReactElement {
  const pts = spec.scatter ?? [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xScale = niceScale(Math.min(...xs), Math.max(...xs), false);
  const yScale = niceScale(Math.min(...ys), Math.max(...ys), false);
  const f = makeFrame(width, CARTESIAN_HEIGHT, { yTickLabels: yScale.ticks.map(formatTick), hasXLabel: !!spec.xLabel, hasYLabel: !!spec.yLabel });
  const color = seriesColors(1)[0];
  const [hover, setHover] = useHover();
  const coords = pts.map((p) => [xToPx(p.x, xScale, f), yToPx(p.y, yScale, f)] as const);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: number | null = null;
    let bestD = 18 * 18;
    coords.forEach(([x, y], i) => {
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  let tip: TooltipState | null = null;
  if (hover !== null && pts[hover]) {
    const p = pts[hover];
    tip = { x: coords[hover][0], y: coords[hover][1], title: p.label ?? `Point ${hover + 1}`, rows: [{ name: spec.xLabel ?? 'x', value: formatTick(p.x) }, { name: spec.yLabel ?? 'y', value: formatTick(p.y) }] };
  }

  return (
    <>
      <svg {...svgProps(f, spec.title)} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <title>{spec.title}</title>
        <AxisChrome f={f} yScale={yScale} xLabels={xScale.ticks.map((t) => ({ x: xToPx(t, xScale, f), label: formatTick(t) }))} xLabel={spec.xLabel} yLabel={spec.yLabel} />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={px(x)} cy={px(y)} r={hover === i ? 6 : 4} className={`chat-chart-point chat-chart-dot${hover === i ? ' is-active' : ''}`} fill={resolveSeriesColor(pts[i].color, 0, [color])} onMouseEnter={() => setHover(i)} data-index={i} />
        ))}
      </svg>
      {tip ? <ChartTooltip tip={tip} width={f.width} /> : null}
    </>
  );
}

// ── sparkline ──────────────────────────────────────────────────────────────────
/** A tiny inline trend — no axes, just the line and its last value. */
export function Sparkline({ spec, width }: RendererProps): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const W = Math.max(120, Math.min(width, 260));
  const H = SPARKLINE_HEIGHT;
  const pad = 4;
  const gradientId = useId();
  const coords = points.map((p, i) => {
    const x = pad + ((W - pad * 2) / (points.length - 1 || 1)) * i;
    const t = (p.value - min) / (max - min || 1);
    const y = pad + (H - pad * 2) * (1 - t);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)},${px(y)}`).join(' ');
  const areaD = `${d} L${px(coords[coords.length - 1][0])},${H} L${px(coords[0][0])},${H} Z`;
  const trendUp = values[values.length - 1] >= values[0];
  const stroke = trendUp ? 'var(--chat-chart-1)' : NEGATIVE_COLOR;
  const last = coords[coords.length - 1];
  return (
    <div className="chat-chart-sparkline-row">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title} className="chat-chart-svg">
        <title>{`${series.name ? `${series.name}: ` : ''}${values.map((v) => formatTick(v)).join(' → ')}`}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} className="chat-chart-area" />
        <path d={d} className="chat-chart-sparkline" fill="none" stroke={stroke} />
        <circle cx={px(last[0])} cy={px(last[1])} r={3} fill={stroke} className="chat-chart-point" />
      </svg>
      <span className="chat-chart-sparkline-value">{formatTick(values[values.length - 1])}</span>
    </div>
  );
}

// ── legend + dispatch ──────────────────────────────────────────────────────────

/** Legend entries for multi-series cartesian charts; null when no legend applies. */
export function legendItems(spec: ChartSpec): LegendItem[] | null {
  if (spec.legend === false) return null;
  if (spec.type === 'pie' || spec.type === 'donut' || spec.type === 'scatter' || spec.type === 'sparkline') return null;
  const serieses = asSeriesArray(spec);
  if (serieses.length < 2) return null;
  const colors = seriesColors(serieses.length);
  return serieses.map((s, i) => ({ name: s.name ?? `Series ${i + 1}`, color: resolveSeriesColor(s.color, i, colors) }));
}

/** Fixed plot height per kind, so the card reserves space before the first measurement. */
export function chartHeight(spec: ChartSpec): number {
  switch (spec.type) {
    case 'pie':
    case 'donut':
      return PIE_HEIGHT;
    case 'sparkline':
      return SPARKLINE_HEIGHT;
    case 'horizontal-bar': {
      const n = asSeriesArray(spec)[0]?.points.length ?? 1;
      return Math.max(150, Math.min(440, n * 30 + 40));
    }
    default:
      return CARTESIAN_HEIGHT;
  }
}

/** Dispatch a validated spec to its renderer. Throws on a pie that doesn't sum to a whole. */
export function renderChart(spec: ChartSpec, width: number): ReactNode {
  switch (spec.type) {
    case 'bar': return <BarChart spec={spec} width={width} />;
    case 'horizontal-bar': return <HorizontalBarChart spec={spec} width={width} />;
    case 'line': return <LineChart spec={spec} width={width} />;
    case 'area': return <LineChart spec={spec} width={width} area />;
    case 'multi-line': return <LineChart spec={spec} width={width} />;
    case 'stacked-bar': return <StackedBarChart spec={spec} width={width} />;
    case 'grouped-bar': return <GroupedBarChart spec={spec} width={width} />;
    // Validate BEFORE creating the element: a throw here is inside ChartBlock's
    // try/catch and degrades to the error card. A throw from the component body
    // would escape it (React calls the component after this function returns)
    // and crash the message bubble.
    case 'pie': assertPieSumsToWhole(spec); return <PieChart spec={spec} width={width} />;
    case 'donut': assertPieSumsToWhole(spec); return <PieChart spec={spec} width={width} donut />;
    case 'scatter': return <ScatterChart spec={spec} width={width} />;
    case 'sparkline': return <Sparkline spec={spec} width={width} />;
    default: throw new Error(`Unsupported chart type: ${(spec as { type: string }).type}`);
  }
}
