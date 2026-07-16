"use client";

import { cn } from "../utils/cn";
import { type ComponentProps, memo, useMemo } from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { useCodeBlockAutoScroll } from "../hooks/use-code-scroll";
import { useSmoothText } from "../hooks/use-smooth-text";
import { CollapsibleCode } from "./collapsible-code";
import { MarkdownTable } from "./markdown-table";
import { CitationRef, CitationSourcesProvider, type CitationSource } from "./citation-markers";
import { remarkCitations } from "../utils/citation-tokens";

// Override Streamdown's element rendering with our own components:
//   - `code`     → CollapsibleCode: fenced code renders open by default with a
//     ~10-line cap (#232); inline code passes through.
//   - `table`    → MarkdownTable: replaces Streamdown's wrapper (whose Tailwind
//     classes/control buttons our CSS build never generates) with our own
//     rounded, scrollable, copyable card.
//   - `citeRef`  → CitationRef: the model's inline `[ref: N]` / `[N]` tokens
//     (split into `citeRef` nodes by `remarkCitations` below) render as
//     superscript chips linked to the Nth source (#138), instead of the literal
//     "[ref: 4, ref: 6]" text the raw tokens would otherwise show.
const STREAMDOWN_COMPONENTS = {
  code: CollapsibleCode,
  table: MarkdownTable,
  citeRef: CitationRef,
};

// Prepend our citation-splitting remark plugin to Streamdown's defaults so it
// runs before the CJK/math/GFM transforms. It only touches mdast `text` nodes
// (stable across the later plugins), so the order is safe; prepending keeps it
// out of the way of plugins that rewrite text. `defaultRemarkPlugins` is
// Streamdown's own chain — we spread it so we don't clobber it.
const REMARK_PLUGINS = [remarkCitations, ...defaultRemarkPlugins];

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
  /**
   * The message's `source-url` parts, in Sources-card order, so inline citation
   * chips can link to the Nth source. When omitted, `[ref: N]` tokens render as
   * muted non-linking chips (graceful degradation — never a broken href).
   * Thread from MessageItem, which already computes these for the Sources card.
   */
  sources?: CitationSource[];
};

export const Response = memo(
  ({ className, isStreaming = false, children, sources, ...props }: ResponseProps) => {
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

    // Merge our component overrides with any the caller passed (caller wins), so
    // a host can still replace `code`/`table`/`citeRef` if it needs to.
    const { components: callerComponents, remarkPlugins: callerRemarkPlugins, ...rest } = props;
    const components = { ...STREAMDOWN_COMPONENTS, ...(callerComponents ?? {}) };
    // If the caller supplied their own remark plugins, prepend ours then theirs
    // (citation-splitting first so caller plugins see the split tree); otherwise
    // use our default chain. Cast: Streamdown's PluggableList isn't exported as a
    // type we can name cleanly here, and the array shape is what we control.
    const remarkPlugins = callerRemarkPlugins
      ? [remarkCitations, ...(callerRemarkPlugins as unknown[])]
      : REMARK_PLUGINS;

    // Stable context value: `sources` identity is owned by the parent
    // (MessageItem memoizes sourceParts on message.parts), so wrapping it here
    // won't thrash children on every render. useMemo keeps the provider value
    // stable across re-renders that don't change `sources`.
    const ctxValue = useMemo(() => sources ?? null, [sources]);

    return (
      <div ref={containerRef}>
        <CitationSourcesProvider value={ctxValue}>
          <Streamdown
            className={cn(
              "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
              className
            )}
            components={components}
            remarkPlugins={remarkPlugins}
            {...rest}
          >
            {content}
          </Streamdown>
        </CitationSourcesProvider>
      </div>
    );
  },
  // Re-render when the text grows, streaming starts/stops, OR the source list
  // changes — a late-arriving `source-url` part should promote a previously
  // muted out-of-range chip into a real link. Comparing `sources` by reference
  // is correct: MessageItem memoizes `sourceParts` on `message.parts`, so the
  // array identity only changes when the parts actually change.
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.sources === nextProps.sources
);

Response.displayName = "Response";
