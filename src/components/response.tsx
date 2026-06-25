"use client";

import { cn } from "../utils/cn";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { useCodeBlockAutoScroll } from "../hooks/use-code-scroll";
import { useSmoothText } from "../hooks/use-smooth-text";

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

    return (
      <div ref={containerRef}>
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            className
          )}
          {...props}
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
