'use client';

import { ChartBlockOrError } from './chart-block';
import { isChartFenceLanguage, parseChartSpec } from './chart-spec';

/**
 * ChartCode — Seam A fence renderer (PRD §2). Streamdown hands the `code`
 * component the COMPLETE fenced text once the closing backticks arrive, so we
 * only ever see a closed fence — no partial-chart risk. response.tsx routes
 * chart fence languages here; everything else stays CollapsibleCode.
 */
interface StreamdownCodeProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}

function fenceLanguage(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const m = /language-([\w-]+)/.exec(className);
  return m ? m[1] : undefined;
}

export function ChartCode({ inline, className, children, node: _node }: StreamdownCodeProps) {
  if (inline) return <code className={className}>{children}</code>;
  const language = fenceLanguage(className);
  if (!isChartFenceLanguage(language)) return <code className={className}>{children}</code>;
  const rawText = typeof children === 'string' ? children : stringifyChildren(children);
  const result = parseChartSpec(rawText);
  return <ChartBlockOrError result={result} rawText={rawText} />;
}

function stringifyChildren(children: React.ReactNode): string {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(stringifyChildren).join('');
  if (typeof children === 'object' && 'props' in children) {
    return stringifyChildren((children as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return String(children);
}
