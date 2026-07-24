"use client";

import { cn } from "../utils/cn";
import { type ComponentProps, memo, useMemo } from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import type { Pluggable } from "unified";
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
//     superscript chips resolved by preserved source IDs (#138), instead of the literal
//     "[ref: 4, ref: 6]" text the raw tokens would otherwise show.
const STREAMDOWN_COMPONENTS = {
  code: CollapsibleCode,
  table: MarkdownTable,
  citeRef: CitationRef,
};

// Streamdown's own chain is keyed by name ({ gfm, codeMeta }) rather than an
// array. Keep the values as the citation-free base; assistant responses opt in
// by passing a `sources` array, while user messages leave `[1]` untouched.
const DEFAULT_REMARK_PLUGINS: Pluggable[] = Object.values(defaultRemarkPlugins);

type ResponseProps = ComponentProps<typeof Streamdown> & {
  isStreaming?: boolean;
  /**
   * The assistant message's `source-url` parts. Supplying this array explicitly
   * opts the response into citation-token parsing; omitting it (as user messages
   * do) leaves `[1]` / `[ref: N]` as literal text. Unmatched assistant refs render
   * as muted non-linking chips rather than broken links.
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
    // Citation parsing is assistant-only by construction: MessageItem passes a
    // sources array for assistant responses and omits it for user messages. This
    // prevents user-authored `[1]` text from becoming a citation chip. Caller
    // plugins remain intact and run after the splitter when citations are enabled.
    const baseRemarkPlugins: Pluggable[] = callerRemarkPlugins ?? DEFAULT_REMARK_PLUGINS;
    const remarkPlugins: Pluggable[] = sources !== undefined
      ? [remarkCitations, ...baseRemarkPlugins]
      : baseRemarkPlugins;

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
  }
);

Response.displayName = "Response";
