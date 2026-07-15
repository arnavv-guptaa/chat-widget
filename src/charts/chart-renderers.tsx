'use client';

/**
 * Chart renderers — one pure-SVG component per ChartType, sharing the geometry
 * + theming in chart-geometry.ts. Each enforces its honesty defaults and is
 * a11y-aware (role, aria, <title>/<desc>, minimum stroke, outlined shapes).
 *
 * No chart library. All colors from the `--chat-*` token ramp.
 */
import type { ReactElement } from 'react';
import type { ChartSpec, ChartSeries } from './chart-spec';
import { asSeriesArray } from './chart-spec';
import {
  VIEW_W,
  VIEW_H,
  PAD_LEFT,
  PAD_RIGHT,
  PAD_TOP,
  PAD_BOTTOM,
  PLOT_W,
  PLOT_H,
  niceScale,
  yToPx,
  xToPxScatter,
  categoryX,
  categorySlotX,
  categorySlotWidth,
  formatTick,
  seriesColors,
  resolveSeriesColor,
  trimLabel,
  type Scale,
} from './chart-geometry';

/** Shared axis chrome (y ticks + gridlines, x baseline + labels, axis titles). */
function AxisChrome({
  yScale,
  xLabels,
  xLabel,
  yLabel,
  rotateX,
}: {
  yScale: Scale;
  xLabels: { x: number; label: string }[];
  xLabel?: string;
  yLabel?: string;
  rotateX: boolean;
}) {
  return (
    <g>
      {yScale.ticks.map((t) => {
        const y = yToPx(t, yScale);
        return (
          <g key={t}>
            <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + PLOT_W} y2={y} className="chat-chart-gridline" />
            <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="chat-chart-tick">
              {formatTick(t)}
            </text>
          </g>
        );
      })}
      {yLabel ? (
        <text x={-(PAD_TOP + PLOT_H / 2)} y={14} transform="rotate(-90)" textAnchor="middle" className="chat-chart-axislabel">
          {yLabel}
        </text>
      ) : null}
      <line x1={PAD_LEFT} y1={PAD_TOP + PLOT_H} x2={PAD_LEFT + PLOT_W} y2={PAD_TOP + PLOT_H} className="chat-chart-axis" />
      {xLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={PAD_TOP + PLOT_H + 16}
          textAnchor={rotateX ? 'end' : 'middle'}
          transform={rotateX ? `rotate(-30 ${l.x} ${PAD_TOP + PLOT_H + 16})` : undefined}
          className="chat-chart-tick"
        >
          {trimLabel(l.label, rotateX ? 14 : 16)}
        </text>
      ))}
      {xLabel ? (
        <text x={PAD_LEFT + PLOT_W / 2} y={VIEW_H - 6} textAnchor="middle" className="chat-chart-axislabel">
          {xLabel}
        </text>
      ) : null}
    </g>
  );
}

/** Decide whether x labels should rotate (many or long). */
function shouldRotateX(labels: string[]): boolean {
  if (labels.length > 6) return true;
  return labels.some((l) => l.length > 8);
}

// ── bar ──────────────────────────────────────────────────────────────────────
export function BarChart({ spec }: { spec: ChartSpec }): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const n = points.length;
  const values = points.map((p) => p.value);
  const scale = niceScale(Math.min(...values, 0), Math.max(...values), true);
  const slot = categorySlotWidth(n);
  const barW = Math.min(slot * 0.62, 48);
  const ramp = seriesColors(1);
  const color = resolveSeriesColor(series.color, 0, ramp);
  const xLabels = points.map((p, i) => ({ x: categorySlotX(i, n) + slot / 2, label: p.label }));
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <AxisChrome yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} rotateX={shouldRotateX(points.map((p) => p.label))} />
      {points.map((p, i) => {
        const cx = categorySlotX(i, n) + slot / 2;
        const y = yToPx(p.value, scale);
        const baseY = yToPx(scale.min, scale);
        const h = Math.abs(baseY - y);
        return (
          <rect key={i} x={cx - barW / 2} y={Math.min(y, baseY)} width={barW} height={h} className="chat-chart-bar" rx={2} fill={color}>
            <title>{`${p.label}: ${formatTick(p.value)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// ── horizontal-bar ────────────────────────────────────────────────────────────
export function HorizontalBarChart({ spec }: { spec: ChartSpec }): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const n = points.length;
  const values = points.map((p) => p.value);
  // x-axis is the value axis (starts at 0); y-axis is the categories.
  const scale = niceScale(0, Math.max(...values, 0), true);
  const ramp = seriesColors(1);
  const color = resolveSeriesColor(series.color, 0, ramp);
  const slotH = PLOT_H / n;
  const barH = Math.min(slotH * 0.62, 32);
  const baseX = PAD_LEFT;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      {/* value (x) ticks + gridlines */}
      {scale.ticks.map((t) => {
        const x = PAD_LEFT + (PLOT_W * (t - scale.min)) / (scale.max - scale.min || 1);
        return (
          <g key={t}>
            <line x1={x} y1={PAD_TOP} x2={x} y2={PAD_TOP + PLOT_H} className="chat-chart-gridline" />
            <text x={x} y={PAD_TOP + PLOT_H + 16} textAnchor="middle" className="chat-chart-tick">
              {formatTick(t)}
            </text>
          </g>
        );
      })}
      {spec.xLabel ? (
        <text x={PAD_LEFT + PLOT_W / 2} y={VIEW_H - 6} textAnchor="middle" className="chat-chart-axislabel">{spec.xLabel}</text>
      ) : null}
      {spec.yLabel ? (
        <text x={-(PAD_TOP + PLOT_H / 2)} y={14} transform="rotate(-90)" textAnchor="middle" className="chat-chart-axislabel">{spec.yLabel}</text>
      ) : null}
      {points.map((p, i) => {
        const cy = PAD_TOP + slotH * i + slotH / 2;
        const w = (PLOT_W * (p.value - scale.min)) / (scale.max - scale.min || 1);
        return (
          <g key={i}>
            <rect x={baseX} y={cy - barH / 2} width={Math.max(0, w)} height={barH} className="chat-chart-bar" rx={2} fill={color}>
              <title>{`${p.label}: ${formatTick(p.value)}`}</title>
            </rect>
            <text x={PAD_LEFT - 8} y={cy + 4} textAnchor="end" className="chat-chart-tick">{trimLabel(p.label, 16)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── line / multi-line / area ──────────────────────────────────────────────────
export function LineChart({ spec, area = false }: { spec: ChartSpec; area?: boolean }): ReactElement {
  const serieses = asSeriesArray(spec);
  const multi = serieses.length > 1;
  // All series share x categories (assume aligned by index; the model is
  // steered to share labels). Use the longest series for x labels.
  const longest = serieses.reduce((a, s) => (s.points.length > a.points.length ? s : a), serieses[0]);
  const allValues = serieses.flatMap((s) => s.points.map((p) => p.value));
  const scale = niceScale(Math.min(...allValues), Math.max(...allValues), false);
  const ramp = seriesColors(serieses.length);
  const xLabels = longest.points.map((p, i) => ({ x: categoryX(i, longest.points.length), label: p.label }));
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <AxisChrome yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} rotateX={shouldRotateX(longest.points.map((p) => p.label))} />
      {serieses.map((s, si) => {
        const color = resolveSeriesColor(s.color, si, ramp);
        const coords = s.points.map((p, i) => [categoryX(i, s.points.length), yToPx(p.value, scale)] as const);
        const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        const areaPath = area && coords.length ? `${d} L${coords[coords.length - 1][0].toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} L${coords[0][0].toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} Z` : null;
        return (
          <g key={si}>
            {areaPath ? <path d={areaPath} className="chat-chart-area" fill={color} opacity={0.25} /> : null}
            <path d={d} className="chat-chart-line" fill="none" stroke={color} />
            {coords.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} className="chat-chart-point" fill={color}>
                <title>{`${s.points[i].label}: ${formatTick(s.points[i].value)}${s.name ? ` · ${s.name}` : ''}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {multi && spec.legend !== false ? <Legend serieses={serieses} ramp={ramp} /> : null}
    </svg>
  );
}

// ── stacked-bar ────────────────────────────────────────────────────────────────
export function StackedBarChart({ spec }: { spec: ChartSpec }): ReactElement {
  const serieses = asSeriesArray(spec);
  const categories = serieses[0].points.map((p) => p.label);
  const n = categories.length;
  // Per-category sums for the y-axis (always starts at 0).
  const sums = categories.map((_, i) => serieses.reduce((acc, s) => acc + (s.points[i]?.value ?? 0), 0));
  const scale = niceScale(0, Math.max(...sums, 0), true);
  const ramp = seriesColors(serieses.length);
  const slot = categorySlotWidth(n);
  const barW = Math.min(slot * 0.62, 48);
  const xLabels = categories.map((c, i) => ({ x: categorySlotX(i, n) + slot / 2, label: c }));
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <AxisChrome yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} rotateX={shouldRotateX(categories)} />
      {categories.map((cat, ci) => {
        const cx = categorySlotX(ci, n) + slot / 2;
        let acc = scale.min;
        return (
          <g key={ci}>
            {serieses.map((s, si) => {
              const v = s.points[ci]?.value ?? 0;
              const yTop = yToPx(acc + v, scale);
              const yBot = yToPx(acc, scale);
              acc += v;
              return (
                <rect key={si} x={cx - barW / 2} y={yTop} width={barW} height={Math.abs(yBot - yTop)} className="chat-chart-bar" rx={si === 0 ? 2 : 0} fill={resolveSeriesColor(s.color, si, ramp)}>
                  <title>{`${cat} · ${s.name ?? `series ${si + 1}`}: ${formatTick(v)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      {spec.legend !== false ? <Legend serieses={serieses} ramp={ramp} /> : null}
    </svg>
  );
}

// ── grouped-bar ────────────────────────────────────────────────────────────────
export function GroupedBarChart({ spec }: { spec: ChartSpec }): ReactElement {
  const serieses = asSeriesArray(spec);
  const categories = serieses[0].points.map((p) => p.label);
  const n = categories.length;
  const allValues = serieses.flatMap((s) => s.points.map((p) => p.value));
  const scale = niceScale(Math.min(...allValues, 0), Math.max(...allValues), true);
  const ramp = seriesColors(serieses.length);
  const slot = categorySlotWidth(n);
  const groupW = Math.min(slot * 0.78, 60);
  const barW = groupW / serieses.length;
  const xLabels = categories.map((c, i) => ({ x: categorySlotX(i, n) + slot / 2, label: c }));
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <AxisChrome yScale={scale} xLabels={xLabels} xLabel={spec.xLabel} yLabel={spec.yLabel} rotateX={shouldRotateX(categories)} />
      {categories.map((cat, ci) => {
        const groupX = categorySlotX(ci, n) + slot / 2 - groupW / 2;
        return (
          <g key={ci}>
            {serieses.map((s, si) => {
              const v = s.points[ci]?.value ?? 0;
              const y = yToPx(v, scale);
              const baseY = yToPx(scale.min, scale);
              return (
                <rect key={si} x={groupX + si * barW} y={Math.min(y, baseY)} width={barW * 0.92} height={Math.abs(baseY - y)} className="chat-chart-bar" rx={2} fill={resolveSeriesColor(s.color, si, ramp)}>
                  <title>{`${cat} · ${s.name ?? `series ${si + 1}`}: ${formatTick(v)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      {spec.legend !== false ? <Legend serieses={serieses} ramp={ramp} /> : null}
    </svg>
  );
}

// ── pie / donut ────────────────────────────────────────────────────────────────
export function PieChart({ spec, donut = false }: { spec: ChartSpec; donut?: boolean }): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const total = points.reduce((acc, p) => acc + p.value, 0);
  // Honesty: slices must sum to ~the declared whole. Default whole = 100.
  const whole = spec.whole ?? { total: 100, tolerance: 0.02 };
  const tolerance = whole.total * whole.tolerance;
  if (Math.abs(total - whole.total) > tolerance) {
    // Refuse — the caller (ChartBlock) catches a thrown Error and renders the
    // error card. A pie that doesn't sum to a whole is the #1 misleading pie.
    throw new Error(
      `The ${spec.type} slices sum to ${formatTick(total)}, which is outside the declared whole of ${formatTick(whole.total)} (±${formatTick(tolerance)}). A pie/donut must represent parts of a single whole.`,
    );
  }
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const r = Math.min(PLOT_W, PLOT_H) / 2 + 8;
  const innerR = donut ? r * 0.58 : 0;
  const ramp = seriesColors(points.length);
  let angle = -Math.PI / 2; // start at 12 o'clock
  const slices = points.map((p, i) => {
    const slice = (p.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + slice;
    angle = a1;
    const large = slice > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi0 = cx + innerR * Math.cos(a0);
    const yi0 = cy + innerR * Math.sin(a0);
    const xi1 = cx + innerR * Math.cos(a1);
    const yi1 = cy + innerR * Math.sin(a1);
    const d = donut
      ? `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${xi1.toFixed(2)},${yi1.toFixed(2)} A${innerR},${innerR} 0 ${large} 0 ${xi0.toFixed(2)},${yi0.toFixed(2)} Z`
      : `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
    const midA = (a0 + a1) / 2;
    const labelR = r + 14;
    const lx = cx + labelR * Math.cos(midA);
    const ly = cy + labelR * Math.sin(midA);
    return { d, color: resolveSeriesColor(p.color, i, ramp), label: p.label, value: p.value, pct: (p.value / total) * 100, lx, ly, midA };
  });
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <g>
        {slices.map((s, i) => (
          <path key={i} d={s.d} className="chat-chart-slice" fill={s.color} stroke="hsl(var(--chat-surface))" strokeWidth={1.5}>
            <title>{`${s.label}: ${formatTick(s.value)} (${s.pct.toFixed(1)}%)`}</title>
          </path>
        ))}
        {donut ? (
          <text x={cx} y={cy + 4} textAnchor="middle" className="chat-chart-axislabel" style={{ fontSize: 13 }}>
            {formatTick(total)}
          </text>
        ) : null}
        {slices.map((s, i) => (
          <text key={`l${i}`} x={s.lx} y={s.ly} textAnchor={s.midA > -Math.PI / 2 && s.midA < Math.PI / 2 ? 'start' : 'end'} className="chat-chart-tick">
            {trimLabel(s.label, 10)}
          </text>
        ))}
      </g>
    </svg>
  );
}

// ── scatter ────────────────────────────────────────────────────────────────────
export function ScatterChart({ spec }: { spec: ChartSpec }): ReactElement {
  const pts = spec.scatter ?? [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xScale = niceScale(Math.min(...xs), Math.max(...xs), false);
  const yScale = niceScale(Math.min(...ys), Math.max(...ys), false);
  const ramp = seriesColors(1);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" preserveAspectRatio="xMidYMid meet" style={{ minHeight: 180 }}>
      <AxisChrome yScale={yScale} xLabels={xScale.ticks.map((t) => ({ x: xToPxScatter(t, xScale), label: formatTick(t) }))} xLabel={spec.xLabel} yLabel={spec.yLabel} rotateX={false} />
      {pts.map((p, i) => (
        <circle key={i} cx={xToPxScatter(p.x, xScale)} cy={yToPx(p.y, yScale)} r={4} className="chat-chart-point" fill={resolveSeriesColor(p.color, 0, ramp)}>
          <title>{`${p.label ? `${p.label}: ` : ''}(${formatTick(p.x)}, ${formatTick(p.y)})`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── sparkline ──────────────────────────────────────────────────────────────────
/** A tiny inline trend — no axes, just the line. Renders at a short height. */
export function Sparkline({ spec }: { spec: ChartSpec }): ReactElement {
  const series = asSeriesArray(spec)[0];
  const points = series.points;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const SW = 200;
  const SH = 40;
  const pad = 4;
  const coords = points.map((p, i) => {
    const x = pad + ((SW - pad * 2) / (points.length - 1 || 1)) * i;
    const t = (p.value - min) / (max - min || 1);
    const y = pad + (SH - pad * 2) * (1 - t);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const trendUp = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} width="100%" height={SH} role="img" preserveAspectRatio="none" style={{ maxWidth: 240 }}>
      <path d={d} className="chat-chart-sparkline" fill="none" stroke={trendUp ? 'hsl(var(--chat-primary))' : 'hsl(var(--chat-error, var(--chat-primary)))'} strokeWidth={1.5}>
        <title>{series.name ? `${series.name}: ` : ''}${values.map((v) => formatTick(v)).join(' → ')}</title>
      </path>
    </svg>
  );
}

// ── legend (shared by multi-series charts) ─────────────────────────────────────
function Legend({ serieses, ramp }: { serieses: ChartSeries[]; ramp: string[] }) {
  const items = serieses.map((s, i) => ({ name: s.name ?? `Series ${i + 1}`, color: resolveSeriesColor(s.color, i, ramp) }));
  // Render the legend as SVG text in the top-right plot corner — keeps it inside
  // the viewBox so it scales with the chart and never overflows the card.
  const lx = PAD_LEFT + PLOT_W - 8;
  let ly = PAD_TOP + 14;
  return (
    <g>
      {items.map((it, i) => (
        <g key={i} transform={`translate(${lx - 120}, ${ly})`}>
          <rect x={0} y={-9} width={10} height={10} rx={2} fill={it.color} />
          <text x={16} y={0} textAnchor="start" className="chat-chart-legend">{trimLabel(it.name, 22)}</text>
        </g>
      )).map((el) => { ly += 16; return el; })}
    </g>
  );
}

/** Dispatch a validated spec to its renderer. Throws on a pie that doesn't sum to a whole. */
export function renderChartSvg(spec: ChartSpec): ReactElement {
  switch (spec.type) {
    case 'bar': return <BarChart spec={spec} />;
    case 'horizontal-bar': return <HorizontalBarChart spec={spec} />;
    case 'line': return <LineChart spec={spec} />;
    case 'area': return <LineChart spec={spec} area />;
    case 'multi-line': return <LineChart spec={spec} />;
    case 'stacked-bar': return <StackedBarChart spec={spec} />;
    case 'grouped-bar': return <GroupedBarChart spec={spec} />;
    case 'pie': return <PieChart spec={spec} />;
    case 'donut': return <PieChart spec={spec} donut />;
    case 'scatter': return <ScatterChart spec={spec} />;
    case 'sparkline': return <Sparkline spec={spec} />;
    default: throw new Error(`Unsupported chart type: ${(spec as { type: string }).type}`);
  }
}
