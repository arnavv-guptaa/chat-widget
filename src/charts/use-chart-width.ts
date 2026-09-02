'use client';

import { useEffect, useState, type RefObject } from 'react';
import { FALLBACK_WIDTH } from './chart-geometry';

/**
 * Measure the chart container's width in CSS px and follow it as the message
 * column resizes (popup ↔ fullscreen, a sidebar opening, a phone rotating).
 *
 * Charts render at real pixels — 11px type and 1px hairlines at every width —
 * so they need the number, not a scaling viewBox. Before the first measurement
 * (SSR, the very first client paint, jsdom) the fallback width is used, and the
 * first layout pass corrects it before the user can see the difference.
 */
export function useChartWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState<number>(FALLBACK_WIDTH);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
