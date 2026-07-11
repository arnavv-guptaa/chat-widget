"use client";

import { cn } from "../utils/cn";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { useCodeBlockAutoScroll } from "../hooks/use-code-scroll";
import { useSmoothText } from "../hooks/use-smooth-text";
import { CollapsibleCode } from "./collapsible-code";
import { MarkdownTable } from "./markdown-table";

// Override Streamdown's code rendering with our collapsed-by-default block, so a
// long code file shows as a one-line pill (language · N lines · copy) the user
// can expand — instead of an inline wall. Inline `code` passes through.
// `table` replaces Streamdown's wrapper (whose Tailwind classes and control
// buttons the widget's CSS build never generates) with our own rounded,
// scrollable, copyable card — see markdown-table.tsx.
const STREAMDOWN_COMPONENTS = { code: CollapsibleCode, table: MarkdownTable };

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
};

export const Response = memo(
  ({ className, isStreaming = false, children, ...props }: ResponseProps) => {
    const containerRef = useCodeBlockAutoScroll(isStreaming);

    // Rate-aware smoothing: reveal the streamed markdown through a buffer that
    // drains proportionally to its backlog, so coarse/irregular model chunks
    // read as a smooth flow — fast when the model is fast (never lagging
    // behind), gentle when it's slow. Only applies while streaming; completed
    // messages render their full text directly. Non-string children (rare,
    // defensive) pass through untouched. See use-smooth-text.ts.
    const rawText = typeof children === "string" ? children : "";
    const smoothed = useSmoothText(rawText, isStreaming && rawText.length > 0);
    const content = typeof children === "string" ? smoothed : children;

    // Merge our code override with any components the caller passed (caller wins).
    const { components: callerComponents, ...rest } = props;
    const components = { ...STREAMDOWN_COMPONENTS, ...(callerComponents ?? {}) };

    return (
      <div ref={containerRef}>
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            className
          )}
          components={components}
          {...rest}
        >
          {content}
        </Streamdown>
      </div>
    );
  },
  // Re-render when the text grows OR when streaming starts/stops. The streaming
  // flag matters because it switches the smoothing buffer on/off (and the final
  // !streaming render must show the complete text). Comparing children alone
  // would miss the stream-end transition.
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isStreaming === nextProps.isStreaming
);

Response.displayName = "Response";
