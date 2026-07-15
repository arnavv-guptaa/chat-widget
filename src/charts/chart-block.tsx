'use client';

/**
 * ChartBlock — the widget's inline chart card.
 *
 * Owns the card chrome (title, subtitle, provenance line, legend, View-data +
 * Copy-CSV affordances, error card) and dispatches the validated spec to the
 * per-type renderer in chart-renderers.tsx. All colors come from the `--chat-*`
 * token ramp via the renderers, so a chart matches the surface in
 * light/dark/white-label for free.
 *
 * Trust boundary (PRD §3):
 *   - provenance line on every chart ("Source: <x>" / "Model-generated")
 *   - a renderer that throws (e.g. a pie that doesn't sum to a whole) is caught
 *     here and rendered as the error card — never a broken/partial chart
 *   - the data table + Copy CSV make the numbers one click away
 */
import { useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, ChevronDownIcon } from 'lucide-react';
import type { ChartSpec } from './chart-spec';
import { asSeriesArray } from './chart-spec';
import { renderChartSvg } from './chart-renderers';
import { formatTick } from './chart-geometry';

export interface ChartBlockProps {
  spec: ChartSpec;
  className?: string;
}

export function ChartBlock({ spec, className }: ChartBlockProps) {
  const [showData, setShowData] = useState(false);
  const [copied, setCopied] = useState(false);

  // Render the chart, catching a thrown honesty error (e.g. a non-whole pie) so
  // it degrades to the error card rather than crashing the message bubble.
  let svg: ReactNode;
  let renderError: string | null = null;
  try {
    svg = renderChartSvg(spec);
  } catch (err) {
    renderError = err instanceof Error ? err.message : String(err);
    svg = null;
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

  const provenance = spec.source ? `Source: ${spec.source}` : 'Model-generated';

  if (renderError) {
    return <ChartErrorCard error={renderError} rawText={JSON.stringify(spec, null, 2)} className={className} />;
  }

  return (
    <div className={`chat-chart not-prose ${className ?? ''}`} role="figure" aria-label={spec.title}>
      <div className="chat-chart-header">
        <div className="chat-chart-title">{spec.title}</div>
        {spec.subtitle ? <div className="chat-chart-subtitle">{spec.subtitle}</div> : null}
      </div>
      {svg}
      <div className="chat-chart-footer">
        <span className="chat-chart-provenance">{provenance}</span>
        <div className="chat-chart-actions">
          <button type="button" onClick={() => setShowData((s) => !s)} className="chat-chart-toggle" aria-expanded={showData} aria-label={showData ? 'Hide data' : 'View data'}>
            <ChevronDownIcon className="size-3.5" style={{ transform: showData ? 'rotate(180deg)' : undefined }} />
            <span>{showData ? 'Hide data' : 'View data'}</span>
          </button>
          <button type="button" onClick={copyCsv} className="chat-chart-toggle" aria-label={copied ? 'Copied' : 'Copy CSV'}>
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            <span>{copied ? 'Copied' : 'Copy CSV'}</span>
          </button>
        </div>
      </div>
      {showData ? <DataTable spec={spec} /> : null}
    </div>
  );
}

/** The View-data table — reuses the markdown-table card idiom. */
function DataTable({ spec }: { spec: ChartSpec }) {
  if (spec.type === 'scatter') {
    return (
      <div className="chat-chart-table">
        <table>
          <thead><tr><th>x</th><th>y</th>{spec.scatter?.[0]?.label ? <th>label</th> : null}</tr></thead>
          <tbody>
            {(spec.scatter ?? []).map((p, i) => (
              <tr key={i}><td>{formatTick(p.x)}</td><td>{formatTick(p.y)}</td>{p.label ? <td>{p.label}</td> : null}</tr>
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
          <thead><tr><th>{spec.xLabel ?? 'Label'}</th><th>{spec.yLabel ?? 'Value'}</th></tr></thead>
          <tbody>{s.points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{formatTick(p.value)}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  const categories = serieses[0].points.map((p) => p.label);
  return (
    <div className="chat-chart-table">
      <table>
        <thead><tr><th>category</th>{serieses.map((s, i) => <th key={i}>{s.name ?? `Series ${i + 1}`}</th>)}</tr></thead>
        <tbody>
          {categories.map((c, ci) => (
            <tr key={ci}><td>{c}</td>{serieses.map((s, si) => <td key={si}>{formatTick(s.points.find((p) => p.label === c)?.value ?? 0)}</td>)}</tr>
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
        <ChevronDownIcon className="size-3.5" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
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
