'use client';

/**
 * MermaidCode — fence renderer for `mermaid` blocks (generative registry:
 * 'diagrams'). Mirrors ChartCode's contract: Streamdown hands the code
 * component the COMPLETE fenced text once the closing backticks arrive, so we
 * never parse a partial diagram.
 *
 * The mermaid library (already a streamdown dependency) is imported lazily on
 * first use, so it costs nothing until a diagram actually appears. SECURITY:
 * the fence body is model output — mermaid runs with `securityLevel: 'strict'`
 * (labels sanitized, no script/click handlers) before the produced SVG is
 * injected. A render failure falls back to the plain collapsible code view so
 * the model's output is never silently dropped.
 */

import { useEffect, useId, useState } from 'react';
import { CollapsibleCode } from './collapsible-code';

interface StreamdownCodeProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidPromise: Promise<any> | null = null;
function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      fontFamily: 'inherit',
    });
    return mermaid;
  });
  return mermaidPromise;
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

export function MermaidCode({ inline, className, children }: StreamdownCodeProps) {
  if (inline) return <code className={className}>{children}</code>;
  const code = (typeof children === 'string' ? children : stringifyChildren(children)).trim();
  return <MermaidDiagram code={code} className={className} rawChildren={children} />;
}

function MermaidDiagram({
  code,
  className,
  rawChildren,
}: {
  code: string;
  className?: string;
  rawChildren?: React.ReactNode;
}) {
  // useId can contain characters mermaid's selector handling rejects.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    if (!code) {
      setFailed(true);
      return;
    }
    loadMermaid()
      .then((mermaid) => mermaid.render(`mordn-mermaid-${id}`, code))
      .then(({ svg: rendered }: { svg: string }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  // Invalid mermaid (or an empty fence): degrade to the normal code view so
  // the output is inspectable rather than a broken image or nothing.
  if (failed) return <CollapsibleCode className={className}>{rawChildren ?? code}</CollapsibleCode>;
  if (!svg) return null; // one frame while the lazy import + render settle
  return (
    <div
      className="chat-mermaid not-prose"
      role="figure"
      aria-label="Diagram"
      // Sanitized by mermaid securityLevel:'strict' before reaching us.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
