import { memo, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * A quiet "still working" cue: a low-contrast highlight swept along a line of
 * text. Reads as the status of *that* line — not a separate spinner widget.
 * Pure CSS (`.chat-text-shimmer` in styles.src.css) so the package stays
 * dependency-free; we only set the per-instance band width (`--spread`, scaled
 * to the text length so one pass covers the whole line) and duration inline.
 */
interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Sweep duration in seconds. */
  duration?: number;
  /** px of band half-width per character. */
  spread?: number;
}

export const TextShimmer = memo(function TextShimmer({
  children,
  as: Component = 'span',
  className,
  duration = 1.4,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread =
    typeof children === 'string' ? children.length * spread : 60;
  const Tag = Component as ElementType;

  return (
    <Tag
      className={cn('chat-text-shimmer', className)}
      style={
        {
          ['--spread']: `${dynamicSpread}px`,
          animationDuration: `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Tag>
  );
});
