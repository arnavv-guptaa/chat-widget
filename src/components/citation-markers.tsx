"use client";

/**
 * Inline citation chips for assistant markdown (#138).
 *
 * `remarkCitations` (utils/citation-tokens.ts) splits the model's `[ref: N]` /
 * `[N]` tokens into `citeRef` mdast nodes during the remark pass. Streamdown then
 * asks our `components.citeRef` override to render each one — that's THIS file.
 * We resolve each number against the source's preserved citationIds (falling
 * back to sourceId/position only when no explicit IDs exist) and render a chip
 * linking to the matching bibliography row. Out-of-range refs render as a
 * muted, non-linking chip so the prose still reads and we never ship a broken
 * href.
 *
 * The context is populated by `Response` from the `source-url` parts threaded
 * down from MessageItem (which already computes them for the Sources card), so
 * the inline chips and bibliography are always backed by the SAME source list;
 * preserved IDs ensure deduplication never changes attribution.
 *
 * SECURITY: citation hrefs come from the AI message stream (the `source-url`
 * parts). We route every href through `safeUrl` (the same guard the Sources card
 * uses) so a `javascript:`/`data:` URL cannot execute on click.
 */

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { safeUrl } from "../utils/url-safety";

/** A `source-url` part, as produced by the handler's `toSourceParts`. */
export interface CitationSource {
  type: "source-url";
  sourceId?: string;
  url: string;
  title?: string;
  /** Original 1-indexed DOC references represented by a deduplicated source. */
  citationIds?: number[];
}

/**
 * Context carrying the message's source-url parts, in Sources-card order. When
 * empty/undefined, citation refs render as plain muted text (no link) — the
 * renderer degrades gracefully instead of crashing or linking to nothing.
 */
const CitationSourcesContext = createContext<CitationSource[] | null>(null);

export const CitationSourcesProvider = CitationSourcesContext.Provider;

/** Read the sources for the current markdown block. */
export function useCitationSources(): CitationSource[] | null {
  return useContext(CitationSourcesContext);
}

/**
 * Resolve a model citation number without letting source deduplication remap it.
 * Knowledge sources carry every original DOC index in citationIds; provider
 * sources may expose a numeric sourceId. Positional fallback is used only when
 * the message has no explicit IDs at all — a muted miss is safer than linking to
 * the wrong evidence.
 */
export function resolveCitationSource(
  sources: CitationSource[] | null,
  n: number,
): CitationSource | undefined {
  if (!sources) return undefined;
  const aliasMatch = sources.find((source) => source.citationIds?.includes(n));
  if (aliasMatch) return aliasMatch;
  const sourceIdMatch = sources.find((source) => source.sourceId === String(n));
  if (sourceIdMatch) return sourceIdMatch;
  if (sources.some((source) => source.citationIds && source.citationIds.length > 0)) {
    return undefined;
  }
  return sources[n - 1];
}

/**
 * Props stamped onto each `citeRef` element by the remark plugin
 * (data-ref-n / data-ref-raw). react-markdown surfaces them as DOM attributes on
 * the element the component override receives; we read them off `node` (the
 * ExtraProps `node`) to stay source-of-truth rather than re-parsing the DOM.
 */
interface CiteRefElementProps {
  // react-markdown / streamdown pass the hast element on `node`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node?: { properties?: Record<string, unknown> } | undefined;
  // The element's DOM attributes also arrive as props (data-ref-n etc.), but we
  // prefer `node.properties` as the canonical source. Kept here for completeness.
  "data-ref-n"?: string;
  "data-ref-raw"?: string;
  children?: ReactNode;
}

function readRefNumber(props: CiteRefElementProps): number | null {
  const fromNode = props.node?.properties?.["data-ref-n"];
  const raw = (typeof fromNode === "string" && fromNode) || props["data-ref-n"];
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * The `citeRef` component override. Renders one superscript chip linking to the
 * source carrying that reference ID. Used as `components.citeRef` in response.tsx.
 *
 * Layout: a raised, pill-shaped superscript carrying the model's source number.
 * Links open in a new tab with safe rel
 * attrs. Out-of-range refs (N > source count, or no sources in context) render
 * muted and non-interactive so the prose still reads.
 */
export function CitationRef({ children, ...props }: CiteRefElementProps) {
  const n = readRefNumber(props);
  const sources = useCitationSources();

  // No usable number — render the raw token text so we never silently drop a
  // citation the model emitted (and so a future format we don't parse yet still
  // shows up as something, not nothing).
  if (!n) {
    const raw = props["data-ref-raw"] ?? props.node?.properties?.["data-ref-raw"];
    return (
      <span className="chat-cite-ref chat-cite-ref-muted">
        {typeof raw === "string" ? raw : children ?? ""}
      </span>
    );
  }

  // Out of range or no sources in context → muted non-linking chip carrying the
  // number. Still useful: the user sees a citation was attempted.
  const source = resolveCitationSource(sources, n);
  if (!source) {
    return (
      <sup className="chat-cite-ref chat-cite-ref-muted" data-ref-n={n}>
        {n}
      </sup>
    );
  }

  const safeHref = safeUrl(source.url);
  // A safe-but-non-http href (e.g. kb://) can't be opened — render muted chip,
  // matching how the Sources card handles a missing href.
  if (!safeHref) {
    return (
      <sup className="chat-cite-ref chat-cite-ref-muted" data-ref-n={n}>
        {n}
      </sup>
    );
  }

  const title = source.title || source.url;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={`Source ${n}: ${title}`}
      className={cn("chat-cite-ref chat-cite-ref-link")}
      data-ref-n={n}
    >
      {n}
    </a>
  );
}
