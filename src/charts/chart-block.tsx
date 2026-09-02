'use client';

/**
 * ChartBlock — the widget's inline chart card.
 *
 * Owns the card chrome (title, subtitle, legend, provenance line, View-data +
 * Copy-CSV affordances, error card), measures its own width, and dispatches
 * the validated spec to the per-type renderer in chart-renderers.tsx. All
 * colors come from the `--chat-*` token ramp via the `--chat-chart-*` palette,
 * so a chart matches the surface in light/dark/white-label for free.
 *
 * Trust boundary (PRD §3):
 *   - provenance line when the spec declares one ("Source: <x>"); unsourced
 *     charts render no label - inside an assistant bubble "model-generated"
 *     is a tautology, so only positive provenance carries signal
 *   - a renderer that throws (e.g. a pie that doesn't sum to a whole) is caught
 *     here and rendered as the error card — never a broken/partial chart
 *   - the data table + Copy CSV make the numbers one click away
 */
import { useRef, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, ChevronDownIcon } from 'lucide-react';
import type { ChartSpec } from './chart-spec';
import { asSeriesArray } from './chart-spec';
import { chartHeight, legendItems, renderChart } from './chart-renderers';
import { formatTick } from './chart-geometry';
import { useChartWidth } from './use-chart-width';

export interface ChartBlockProps {
  spec: ChartSpec;
  className?: string;
}

export function ChartBlock({ spec, className }: ChartBlockProps) {
  const [showData, setShowData] = useState(false);
  const [copied, setCopied] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const width = useChartWidth(plotRef);

  // Render the chart, catching a thrown honesty error (e.g. a non-whole pie) so
  // it degrades to the error card rather than crashing the message bubble.
  let chart: ReactNode;
  let renderError: string | null = null;
  try {
    chart = renderChart(spec, width);
  } catch (err) {
    renderError = err instanceof Error ? err.message : String(err);
    chart = null;
  }

  const copyCsv = async () => {
    const serieses = asSeriesArray(spec);
    // For scatter, export x,y pairs.
    if (spec.type === 'scatter') {
      const rows = (spec.scatter ?? []).map((p) => `${p.x},${p.y}${p.label ? `,${csvEscape(p.label)}` : ''}`);
      const csv = [`x,y${spec.scatter?.[0]?.label ? ',label' : ''}`, ...rows].join('\n');
      await writeClipboard(csv);
      return;
    }
    // Single series: label,value. Multi: a header row + one row per category.
    if (serieses.length === 1) {
      const s = serieses[0];
      const csv = [`${csvEscape(spec.xLabel ?? 'label')},${csvEscape(spec.yLabel ?? 'value')}`, ...s.points.map((p) => `${csvEscape(p.label)},${p.value}`)].join('\n');
      await writeClipboard(csv);
      return;
    }
    const categories = serieses[0].points.map((p) => p.label);
    const header = ['category', ...serieses.map((s) => csvEscape(s.name ?? 'series'))].join(',');
    const rows = categories.map((c) => [csvEscape(c), ...serieses.map((s) => s.points.find((p) => p.label === c)?.value ?? '')].join(','));
    await writeClipboard([header, ...rows].join('\n'));
  };

  const writeClipboard = async (csv: string) => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. http) — ignore */
    }
  };

  // Positive provenance only. The old fallback ("Model-generated") labeled
  // every unsourced chart, but inside an assistant bubble that's a tautology -
  // the signal lives entirely in "Source: <x>" being present.
  const provenance = spec.source ? `Source: ${spec.source}` : null;

  if (renderError) {
    return <ChartErrorCard error={renderError} rawText={JSON.stringify(spec, null, 2)} className={className} />;
  }

  const legend = legendItems(spec);
  const isSparkline = spec.type === 'sparkline';

  return (
    <div className={`chat-chart not-prose${isSparkline ? ' is-sparkline' : ''} ${className ?? ''}`} role="figure" aria-label={spec.title}>
      <div className="chat-chart-header">
        <div className="chat-chart-title">{spec.title}</div>
        {spec.subtitle ? <div className="chat-chart-subtitle">{spec.subtitle}</div> : null}
      </div>
      {legend ? (
        <ul className="chat-chart-legend-row" aria-label="Legend">
          {legend.map((item, i) => (
            <li key={i} className="chat-chart-legend">
              <span className="chat-chart-swatch" style={{ background: item.color }} />
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The plot measures its own width and reserves its height before the
          first measurement so the card never jumps when the SVG mounts. */}
      <div ref={plotRef} className="chat-chart-plot" style={{ minHeight: chartHeight(spec) }}>
        {chart}
      </div>
      <div className="chat-chart-footer">
        {provenance ? <span className="chat-chart-provenance">{provenance}</span> : <span />}
        <div className="chat-chart-actions">
          <button type="button" onClick={() => setShowData((s) => !s)} className="chat-chart-toggle" aria-expanded={showData} aria-label={showData ? 'Hide data' : 'View data'}>
            <ChevronDownIcon style={{ transform: showData ? 'rotate(180deg)' : undefined }} />
            <span>{showData ? 'Hide data' : 'View data'}</span>
          </button>
          <button type="button" onClick={copyCsv} className="chat-chart-toggle" aria-label={copied ? 'Copied' : 'Copy CSV'}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy CSV'}</span>
          </button>
        </div>
      </div>
      {showData ? <DataTable spec={spec} /> : null}
    </div>
  );
}

/** The View-data table — reuses the markdown-table card idiom. Numbers right-align. */
function DataTable({ spec }: { spec: ChartSpec }) {
  if (spec.type === 'scatter') {
    return (
      <div className="chat-chart-table">
        <table>
          <thead>
            <tr>
              <th className="is-num">{spec.xLabel ?? 'x'}</th>
              <th className="is-num">{spec.yLabel ?? 'y'}</th>
              {spec.scatter?.[0]?.label ? <th>Label</th> : null}
            </tr>
          </thead>
          <tbody>
            {(spec.scatter ?? []).map((p, i) => (
              <tr key={i}>
                <td className="is-num">{formatTick(p.x)}</td>
                <td className="is-num">{formatTick(p.y)}</td>
                {p.label ? <td>{p.label}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const serieses = asSeriesArray(spec);
  if (serieses.length === 1) {
    const s = serieses[0];
    return (
      <div className="chat-chart-table">
        <table>
          <thead>
            <tr>
              <th>{spec.xLabel ?? 'Label'}</th>
              <th className="is-num">{spec.yLabel ?? 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {s.points.map((p, i) => (
              <tr key={i}>
                <td>{p.label}</td>
                <td className="is-num">{formatTick(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const categories = serieses[0].points.map((p) => p.label);
  return (
    <div className="chat-chart-table">
      <table>
        <thead>
          <tr>
            <th>{spec.xLabel ?? 'Category'}</th>
            {serieses.map((s, i) => (
              <th key={i} className="is-num">{s.name ?? `Series ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((c, ci) => (
            <tr key={ci}>
              <td>{c}</td>
              {serieses.map((s, si) => (
                <td key={si} className="is-num">{formatTick(s.points.find((p) => p.label === c)?.value ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ChartErrorCardProps {
  error: string;
  rawText: string;
  className?: string;
}

export function ChartErrorCard({ error, rawText, className }: ChartErrorCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`chat-chart chat-chart-error ${className ?? ''}`} role="alert">
      <div className="chat-chart-error-head">This chart couldn't be rendered.</div>
      <div className="chat-chart-error-body">{error}</div>
      <button type="button" className="chat-chart-toggle" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
        <ChevronDownIcon style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
        <span>{expanded ? 'Hide raw data' : 'Show raw data'}</span>
      </button>
      {expanded ? <pre className="chat-chart-error-raw">{rawText}</pre> : null}
    </div>
  );
}

/** Render a spec-or-error in one call (used by the fence hook + tool renderer). */
export function ChartBlockOrError({
  result,
  rawText,
}: {
  result: { ok: true; spec: ChartSpec } | { ok: false; error: string };
  rawText: string;
}): ReactNode {
  return result.ok ? <ChartBlock spec={result.spec} /> : <ChartErrorCard error={result.error} rawText={rawText} />;
}

/** RFC 4180 CSV cell escape. */
function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
