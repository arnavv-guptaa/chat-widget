'use client';

/**
 * ChartBlock — the widget's inline chart renderer.
 *
 * Pure SVG, zero chart-library dependency (see PRD §5). Every color reads from
 * the widget's `--chat-*` CSS-var token ramp so a chart matches the surface in
 * light/dark/white-label for free — the same property that makes MarkdownTable
 * and the code blocks theme-correct. No hardcoded palette.
 *
 * Honesty defaults enforced HERE (not in the schema, so the model can't
 * override them):
 *   - bar y-axis always starts at 0 (the #1 misleading chart is a truncated
 *     y-axis; non-negotiable).
 *   - line y-axis never truncates the visible range below 10% of the span — a
 *     line that floats in the top 2% of the plot area implies volatility that
 *     the data doesn't have.
 *   - ordinal single-hue ramp keyed to --chat-primary (not a categorical
 *     rainbow, which implies N unrelated categories for what is often a ranked
 *     series).
 *
 * Provenance line (PRD Rule 1): "Source: <source>" when present, else
 * "Model-generated". This is the single most important trust affordance — it
 * tells the user the picture was drawn from the model's own numbers, not
 * measured by a system.
 *
 * Streaming-safe (PRD Rule 4): the caller (the fence hook) only hands us a
 * CLOSED fence, so we never see a partial JSON body. If given an invalid spec
 * we render the error card (Rule 2) — never a broken/partial chart.
 */
import { useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, ChevronDownIcon } from 'lucide-react';
import type { ChartSpec } from './chart-spec';

// SVG geometry. A 16:9-ish viewBox scales with the message column via
// width:100% (like MarkdownTable). No ResizeObserver needed in v1.
const VIEW_W = 640;
const VIEW_H = 360;
const PAD_LEFT = 48; // room for y tick labels
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 48; // room for x labels + axis title
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

/** Format a tick value compactly (1200 -> "1.2k", 1500000 -> "1.5M"). */
function formatTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(2)));
}

/**
 * Compute "nice" y-axis ticks. For bar, `min` is forced to 0 (honesty rule).
 * For line, `min` is the data min but clamped so the visible span is at least
 * 10% of the value range (the no-truncate guard).
 */
function yScale(spec: ChartSpec): { min: number; max: number; ticks: number[] } {
  const values = spec.series.points.map((p) => p.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  if (spec.type === 'bar') {
    const max = dataMax > 0 ? dataMax * 1.1 : dataMax < 0 ? 0 : 1;
    const min = 0; // non-negotiable
    return { min, max, ticks: niceTicks(min, max, 4) };
  }

  // line
  const span = dataMax - dataMin || Math.abs(dataMax) || 1;
  // No-truncate guard: never let the visible min sit within the top 90% of the
  // span (i.e. the plot showing only the top 10% of the range).
  let min = dataMin - span * 0.1;
  let max = dataMax + span * 0.1;
  if (dataMin >= 0 && min < 0) min = 0; // don't force a negative axis for all-positive data
  return { min, max, ticks: niceTicks(min, max, 4) };
}

/** Produce ~count round tick values between min and max (inclusive). */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(6)));
  if (out.length === 0 || out[0] !== min) out.unshift(min);
  return out;
}

/** Map a data value to an SVG y coordinate. */
function yToPx(value: number, scale: { min: number; max: number }): number {
  const t = (value - scale.min) / (scale.max - scale.min || 1);
  return PAD_TOP + PLOT_H * (1 - t);
}

export interface ChartBlockProps {
  spec: ChartSpec;
  /** Optional className for the outer card. */
  className?: string;
}

/**
 * Render a validated ChartSpec as an inline SVG chart card. For an invalid
 * spec, the caller should render <ChartErrorCard> instead (see below) — this
 * component assumes `spec` has already passed `parseChartSpec`.
 */
export function ChartBlock({ spec, className }: ChartBlockProps) {
  const [showData, setShowData] = useState(false);
  const [copied, setCopied] = useState(false);

  const scale = yScale(spec);
  const points = spec.series.points;
  const n = points.length;

  // Bar geometry: equal-width bars across the plot area.
  const barSlot = PLOT_W / n;
  const barW = Math.min(barSlot * 0.62, 48);

  const xLabels = points.map((p, i) => {
    const cx = PAD_LEFT + barSlot * i + barSlot / 2;
    // Rotate long labels to avoid overlap; keep horizontal when few/short.
    const label = p.label;
    return { x: cx, label, rotate: label.length > 8 && n > 6 };
  });

  const copyCsv = async () => {
    const csv = [
      `${spec.xLabel ?? 'label'},${spec.yLabel ?? 'value'}`,
      ...points.map((p) => `${csvEscape(p.label)},${p.value}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. http) — ignore */
    }
  };

  const provenance = spec.source ? `Source: ${spec.source}` : 'Model-generated';

  return (
    <div
      className={`chat-chart not-prose ${className ?? ''}`}
      role="figure"
      aria-label={spec.title}
    >
      <div className="chat-chart-header">
        <div className="chat-chart-title">{spec.title}</div>
        {spec.subtitle ? <div className="chat-chart-subtitle">{spec.subtitle}</div> : null}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        role="img"
        aria-labelledby="chart-desc"
        preserveAspectRatio="xMidYMid meet"
        style={{ minHeight: 180 }}
      >
        <desc id="chart-desc">
          {spec.title}. {spec.type} chart of ${spec.yLabel ?? 'value'} over ${spec.xLabel ?? 'label'}. {provenance}.
        </desc>

        {/* y-axis ticks + gridlines */}
        {scale.ticks.map((t) => {
          const y = yToPx(t, scale);
          return (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={PAD_LEFT + PLOT_W}
                y2={y}
                className="chat-chart-gridline"
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                className="chat-chart-tick"
              >
                {formatTick(t)}
              </text>
            </g>
          );
        })}

        {/* y-axis title (rotated) */}
        {spec.yLabel ? (
          <text
            x={-(PAD_TOP + PLOT_H / 2)}
            y={14}
            transform="rotate(-90)"
            textAnchor="middle"
            className="chat-chart-axislabel"
          >
            {spec.yLabel}
          </text>
        ) : null}

        {/* the data */}
        {spec.type === 'bar'
          ? points.map((p, i) => {
              const cx = PAD_LEFT + barSlot * i + barSlot / 2;
              const y = yToPx(p.value, scale);
              const baseY = yToPx(scale.min, scale);
              const h = Math.abs(baseY - y);
              const top = Math.min(y, baseY);
              return (
                <g key={i}>
                  <rect
                    x={cx - barW / 2}
                    y={top}
                    width={barW}
                    height={h}
                    className="chat-chart-bar"
                    rx={2}
                  >
                    <title>{`${p.label}: ${formatTick(p.value)}`}</title>
                  </rect>
                </g>
              );
            })
          : (() => {
              // line
              const coords = points.map((p, i) => {
                const cx = PAD_LEFT + (PLOT_W / (n - 1 || 1)) * i;
                return [cx, yToPx(p.value, scale)] as const;
              });
              const d = coords
                .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ');
              return (
                <>
                  <path d={d} className="chat-chart-line" fill="none" />
                  {coords.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={3} className="chat-chart-point">
                      <title>{`${points[i].label}: ${formatTick(points[i].value)}`}</title>
                    </circle>
                  ))}
                </>
              );
            })()}

        {/* x-axis baseline */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP + PLOT_H}
          x2={PAD_LEFT + PLOT_W}
          y2={PAD_TOP + PLOT_H}
          className="chat-chart-axis"
        />

        {/* x-axis labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={PAD_TOP + PLOT_H + 16}
            textAnchor={l.rotate ? 'end' : 'middle'}
            transform={l.rotate ? `rotate(-30 ${l.x} ${PAD_TOP + PLOT_H + 16})` : undefined}
            className="chat-chart-tick"
          >
            {l.label}
          </text>
        ))}

        {/* x-axis title */}
        {spec.xLabel ? (
          <text
            x={PAD_LEFT + PLOT_W / 2}
            y={VIEW_H - 6}
            textAnchor="middle"
            className="chat-chart-axislabel"
          >
            {spec.xLabel}
          </text>
        ) : null}
      </svg>

      <div className="chat-chart-footer">
        <span className="chat-chart-provenance">{provenance}</span>
        <div className="chart-chart-actions">
          <button
            type="button"
            onClick={() => setShowData((s) => !s)}
            className="chat-chart-toggle"
            aria-expanded={showData}
            aria-label={showData ? 'Hide data' : 'View data'}
          >
            <ChevronDownIcon
              className="size-3.5"
              style={{ transform: showData ? 'rotate(180deg)' : undefined }}
            />
            <span>{showData ? 'Hide data' : 'View data'}</span>
          </button>
          <button
            type="button"
            onClick={copyCsv}
            className="chat-chart-toggle"
            aria-label={copied ? 'Copied' : 'Copy CSV'}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            <span>{copied ? 'Copied' : 'Copy CSV'}</span>
          </button>
        </div>
      </div>

      {showData ? (
        <div className="chat-chart-table">
          <table>
            <thead>
              <tr>
                <th>{spec.xLabel ?? 'Label'}</th>
                <th>{spec.yLabel ?? 'Value'}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i}>
                  <td>{p.label}</td>
                  <td>{formatTick(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Escape a CSV cell (RFC 4180: quote cells containing comma/quote/newline). */
function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * The Rule-2 error card. Rendered when a fence body fails validation — never a
 * broken/partial chart. Shows a short message + the raw text in a collapsible
 * so the user can still read what the model sent.
 */
export interface ChartErrorCardProps {
  /** Short, user-displayable reason. */
  error: string;
  /** The raw fence body, shown in the collapsible for transparency. */
  rawText: string;
  className?: string;
}

export function ChartErrorCard({ error, rawText, className }: ChartErrorCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`chat-chart chart-chart-error ${className ?? ''}`} role="alert">
      <div className="chat-chart-error-head">This chart couldn't be rendered.</div>
      <div className="chat-chart-error-body">{error}</div>
      <button
        type="button"
        className="chat-chart-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronDownIcon
          className="size-3.5"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        />
        <span>{expanded ? 'Hide raw data' : 'Show raw data'}</span>
      </button>
      {expanded ? (
        <pre className="chat-chart-error-raw">{rawText}</pre>
      ) : null}
    </div>
  );
}

/** Convenience: render a spec-or-error in one call (used by the fence hook). */
export function ChartBlockOrError({
  result,
  rawText,
}: {
  result: { ok: true; spec: ChartSpec } | { ok: false; error: string };
  rawText: string;
}): ReactNode {
  return result.ok ? (
    <ChartBlock spec={result.spec} />
  ) : (
    <ChartErrorCard error={result.error} rawText={rawText} />
  );
}
