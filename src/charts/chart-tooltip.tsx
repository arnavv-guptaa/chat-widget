'use client';

/**
 * ChartTooltip — the hover card shared by every chart kind.
 *
 * Renderers own the hit-testing (they know their geometry) and hand this
 * component a `TooltipState`: an anchor point in chart pixels plus the rows to
 * show. The card is plain HTML positioned over the SVG so it can use the
 * widget's type, shadow, and surface tokens, and it flips to stay inside the
 * chart when the anchor is near an edge.
 */
import type { ReactElement } from 'react';

export interface TooltipRow {
  /** Swatch color (CSS color). Omitted for single-series charts. */
  swatch?: string;
  /** Series / slice name. */
  name?: string;
  /** The formatted value. */
  value: string;
  /** Secondary text after the value (e.g. a percentage). */
  note?: string;
}

export interface TooltipState {
  /** Anchor in chart pixels. */
  x: number;
  y: number;
  /** Header — usually the category label. */
  title: string;
  rows: TooltipRow[];
}

const CARD_W = 168;
const GAP = 10;

export function ChartTooltip({ tip, width }: { tip: TooltipState; width: number }): ReactElement {
  // Prefer the right side of the anchor; flip left when it would clip.
  const flip = tip.x + GAP + CARD_W > width;
  const left = flip ? Math.max(0, tip.x - GAP - CARD_W) : tip.x + GAP;
  return (
    <div className="chat-chart-tooltip" role="presentation" style={{ left, top: Math.max(0, tip.y - 8), width: CARD_W }}>
      <div className="chat-chart-tooltip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="chat-chart-tooltip-row">
          {r.swatch ? <span className="chat-chart-swatch" style={{ background: r.swatch }} /> : null}
          {r.name ? <span className="chat-chart-tooltip-name">{r.name}</span> : null}
          <span className="chat-chart-tooltip-value">
            {r.value}
            {r.note ? <span className="chat-chart-tooltip-note">{r.note}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
