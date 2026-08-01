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
 *
 * CONTAINMENT — why this file is careful about the DOM:
 *
 * mermaid renders by measuring real layout, so it needs a live element. Left to
 * itself it creates one on `document.body` — OUTSIDE `.chat-widget-container`,
 * i.e. in the host page the widget is embedded in. On success it cleans up; on a
 * SYNTAX ERROR it instead paints its "bomb" error graphic into that node, throws,
 * and leaves the node behind. The widget's own fallback then renders correctly
 * while the host page is left with a full-width error graphic below its footer —
 * the widget defacing someone else's site with a diagnostic meant for us.
 *
 * Model output is untrusted input to a parser, so invalid diagrams are the
 * expected case, not the exceptional one. Three independent guards, because any
 * one of them alone still leaks in some path:
 *
 *   1. `suppressErrorRendering: true` — mermaid's own switch for "never insert a
 *      Syntax error diagram into the DOM". The real fix.
 *   2. `parse(code, { suppressErrors: true })` before rendering — validate first,
 *      so a bad diagram never reaches `render()` at all.
 *   3. An owned, offscreen container passed to `render()` — so anything mermaid
 *      does attach lands in a node this component removes on cleanup, never on
 *      `document.body`.
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
      // Guard 1: never let mermaid inject its "Syntax error" diagram into the
      // page. Without this a malformed fence paints a bomb graphic on the HOST
      // site's body — outside the widget, outside our scoped CSS. We show the
      // raw code instead, which is more useful to the reader anyway.
      suppressErrorRendering: true,
    });
    return mermaid;
  });
  return mermaidPromise;
}

/**
 * An offscreen element that mermaid may measure and scribble into, owned by the
 * caller so it can be removed unconditionally.
 *
 * It must be IN the document (mermaid measures real layout; a detached node
 * reports zero and diagrams come out mis-sized), so it is hidden rather than
 * unattached: off-viewport, non-interactive, and `aria-hidden` so it never
 * reaches the accessibility tree. `.chat-widget-container` keeps our own scoped
 * styles applying to it.
 */
function createScratchContainer(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-widget-container';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;';
  document.body.appendChild(el);
  return el;
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
    let scratch: HTMLElement | null = null;
    setSvg(null);
    setFailed(false);
    if (!code) {
      setFailed(true);
      return;
    }

    // Every exit path goes through here, so no scratch node can outlive the
    // render that created it — not on success, failure, unmount, or a code
    // change mid-render.
    const releaseScratch = () => {
      scratch?.remove();
      scratch = null;
    };

    loadMermaid()
      .then(async (mermaid) => {
        // Guard 2: validate before rendering. `suppressErrors` makes this return
        // false for a bad diagram instead of throwing, so an invalid fence never
        // reaches render() — the only call that touches the DOM.
        const valid = await mermaid.parse(code, { suppressErrors: true });
        if (!valid) throw new Error('invalid mermaid diagram');
        if (cancelled) return null;

        // Guard 3: give mermaid a node we own. Anything it attaches lands here
        // rather than on document.body, and releaseScratch() takes it away.
        scratch = createScratchContainer();
        return mermaid.render(`mordn-mermaid-${id}`, code, scratch);
      })
      .then((result: { svg: string } | null) => {
        if (!cancelled && result) setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(releaseScratch);

    return () => {
      cancelled = true;
      releaseScratch();
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
