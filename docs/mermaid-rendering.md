# Mermaid rendering and streaming compatibility

Mermaid fences keep the existing Markdown syntax and public `ChatWidget` API. No wire configuration, schema or dependency change is required. Hosts that override the `Response` code component retain their override; `ResponseStreamingContext` is an internal implementation detail, not a package-root API.

During the active text part's stream, Mermaid displays one accessible **Generating diagram** placeholder. Source updates do not parse or lay out partial diagrams. A status-only transition to settled text reaches the fence through React context, even when Streamdown memoizes unchanged Markdown. A completed earlier text part can render while a later tool/text part continues. On resumed streaming the old render is cancelled and the placeholder returns; after settling, the current source is rendered. Async results from an obsolete render cannot replace the current diagram.

Invalid or empty source, failed imports and render failures fall back to the existing copyable code block. Raw source is rendered as escaped text, not interpreted as HTML. Other fenced languages, inline code, charts, citations and tool outputs keep their existing paths. No output is removed from the message or persistence layer.

Mermaid remains lazy-loaded in client effects with `securityLevel: 'strict'`, `startOnLoad: false` and error graphics suppressed. Rendering uses an owned, hidden scratch container cleaned on success, failure and cancellation. This continues to rely on Mermaid's strict-mode SVG sanitization; hosts must not weaken that global library configuration. SSR emits deterministic pending markup without importing Mermaid or accessing the DOM; hydration renders the settled diagram in the browser.

The placeholder reserves a minimum height, not the final diagram's measured dimensions. A single size change at completion is expected. This is not a guarantee of zero layout shift, nor does it cancel parser CPU work already in progress. Browser-level validation remains necessary for actual SVG layout and sanitization behavior.
