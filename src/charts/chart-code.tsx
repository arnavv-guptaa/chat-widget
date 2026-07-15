/**
 * Chart fence glue — Seam A (PRD §2).
 *
 * `response.tsx` overrides Streamdown's `code` component with `CollapsibleCode`.
 * Charts intercept the SAME override: when a fenced block's language is
 * `mordn-chart` (or the `chart` alias), we render a `ChartBlock`/`ChartErrorCard`
 * instead of `CollapsibleCode`. Everything else (the fence, streaming, the rest
 * of markdown) is untouched.
 *
 * This module exports a `ChartCode` component that response.tsx delegates to
 * when the fence language is a chart language; response.tsx keeps `CollapsibleCode`
 * as the fallback for every other language. Keeping the dispatch in response.tsx
 * (not here) means this module owns ONLY the chart case, and the existing
 * code-block path is unchanged.
 *
 * Streaming-safety (PRD Rule 4): Streamdown hands the `code` component the
 * COMPLETE fenced text once the closing backticks arrive — a fenced block is
 * atomic to the markdown parser. So we only ever see a closed fence here; we
 * never attempt to parse a partial JSON body. (If a future markdown renderer
 * streams fence bodies incrementally, the `parseChartSpec` failure path renders
 * the error card rather than a partial chart — still safe.)
 */
'use client';

import { ChartBlockOrError } from './chart-block';
import { isChartFenceLanguage, parseChartSpec } from './chart-spec';

/**
 * The props Streamdown passes to a `code` component override. Kept loose
 * (matching how CollapsibleCode receives them) so we don't import Streamdown's
 * internal types. `inline` distinguishes inline code from a fenced block;
 * `className` carries the language as `language-mordn-chart`.
 */
interface StreamdownCodeProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  // react-markdown passes the mdast node to every component override; ignore.
  node?: unknown;
}

/** Extract the fence language from the `className` Streamdown sets. */
function fenceLanguage(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const m = /language-([\w-]+)/.exec(className);
  return m ? m[1] : undefined;
}

/**
 * Render a fenced `mordn-chart` block. If the body parses to a valid ChartSpec,
 * render the chart; otherwise render the error card with the raw text.
 * Inline code (`inline: true`) is never a chart — it falls back (the caller
 * handles that before reaching here, but we guard anyway).
 */
export function ChartCode({ inline, className, children, node: _node }: StreamdownCodeProps) {
  if (inline) return <code className={className}>{children}</code>;

  const language = fenceLanguage(className);
  // Double-check the dispatch (response.tsx only routes chart languages here,
  // but be defensive: a non-chart language should never have been routed).
  if (!isChartFenceLanguage(language)) return <code className={className}>{children}</code>;

  const rawText = typeof children === 'string' ? children : stringifyChildren(children);
  const result = parseChartSpec(rawText);

  return <ChartBlockOrError result={result} rawText={rawText} />;
}

/** Flatten React children to a string (a fence body is text). */
function stringifyChildren(children: React.ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(stringifyChildren).join('');
  // A React element wrapping text — read its text content best-effort.
  if (typeof children === 'object' && 'props' in children) {
    return stringifyChildren((children as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return String(children);
}
