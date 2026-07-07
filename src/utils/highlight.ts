/**
 * Lazy Shiki highlighter — the ONE code-highlighting engine for the widget.
 *
 * Both code-rendering paths (the prose CollapsibleCodeBlock and the tool-call
 * CodeBlock) call `highlightCode()` here instead of shipping their own colours.
 * `shiki` was already a dependency but sat entirely unused (#37) — 100% of the
 * install cost, 0% of the benefit. This module finally uses it, and does so
 * without forcing that ~1–2 MB onto consumers who never render a code block.
 *
 * DESIGN — progressive enhancement, never a hard dependency:
 * - Zero cost until the first block is actually highlighted. The highlighter is
 *   a lazily-imported, cached singleton — the dynamic `import()` happens on the
 *   first call and never again (the promise is memoised, so concurrent callers
 *   share one load).
 * - EVERY failure degrades to plain text. `highlightCode` returns `null` on any
 *   problem (import failed, unknown language even after retrying as plain
 *   "text", oversized input, or a runtime throw). Callers render their existing
 *   plain `<pre><code>` when they get `null`. Highlighting is a nicety; the raw
 *   code always renders.
 * - Dual-theme, token-driven. We render with BOTH `github-light` and
 *   `github-dark` and `defaultColor: false`, so Shiki emits `--shiki-light` /
 *   `--shiki-dark` CSS custom properties on every token instead of baking in a
 *   fixed colour. styles.src.css maps those onto the widget's light/dark scope,
 *   exactly like every other themed surface. Shiki never paints its own
 *   background — the widget's `--chat-*` surfaces own that.
 *
 * SHIKI ↔ SCRIPT-TAG EMBED (see DOCS_CONTRACT §6). The `import()` below uses a
 * STATIC specifier (`"shiki/bundle/web"`) so app bundlers (Next / Vite /
 * Turbopack / webpack) resolve and code-split it at build time. The IIFE
 * script-tag embed (a separate PR) marks `shiki`/`shiki/bundle/web` as external,
 * so that literal import fails fast in the browser as a bare specifier — the
 * `catch` then loads Shiki from a CDN URL the embed pins on
 * `globalThis.__MORDN_SHIKI_URL__`. The `@vite-ignore` / `webpackIgnore`
 * comments keep bundlers from trying to resolve that runtime URL at build time.
 */

// Shiki's `codeToHtml` is the only surface we use; typed loosely so we don't
// pull Shiki's types into the app graph (it's a lazily-loaded, optional dep).
type ShikiModule = {
  codeToHtml: (code: string, options: Record<string, unknown>) => Promise<string>;
};

/**
 * Cached singleton highlighter load. The dynamic import runs on the first call
 * and the resulting promise is memoised — never re-imported. A rejected load is
 * cached too (so we don't hammer a failing import); callers treat a throw here
 * as "no highlighting" and fall back to plain text.
 */
let highlighterPromise: Promise<ShikiModule> | null = null;

function loadShiki(): Promise<ShikiModule> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = (async (): Promise<ShikiModule> => {
    let mod: ShikiModule;
    try {
      // Static specifier — app bundlers resolve/split this at build time.
      mod = (await import("shiki/bundle/web")) as unknown as ShikiModule;
    } catch {
      // Bundler left the specifier unresolved (script-tag embed): load from the
      // CDN URL the embed pins on globalThis. No URL → rethrow so the caller
      // falls back to plain text.
      const url = (globalThis as { __MORDN_SHIKI_URL__?: string }).__MORDN_SHIKI_URL__;
      if (!url) {
        throw new Error("shiki unavailable and no __MORDN_SHIKI_URL__ fallback set");
      }
      mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as unknown as ShikiModule;
    }
    return mod;
  })();

  return highlighterPromise;
}

/**
 * Upper bound on what we hand to Shiki. Highlighting a very large block is slow
 * and pointless (the reader is scrolling, not tokenising) — past this we bail to
 * plain text. Generous enough that normal docs/code snippets always highlight.
 */
const MAX_HIGHLIGHT_CHARS = 50_000;

/** The dual themes → drives the `--shiki-light` / `--shiki-dark` CSS vars. */
const THEMES = { light: "github-light", dark: "github-dark" } as const;

/**
 * Highlight `code` in `lang`, returning Shiki's `<pre class="shiki">…</pre>`
 * HTML string — or `null` if it can't (any failure). Callers render plain text
 * on `null`.
 *
 * The returned HTML is safe to `dangerouslySetInnerHTML`: Shiki escapes all
 * token text as it builds the markup (tokens become `<span>`s with
 * text-escaped content), so nothing from the user's `code` can inject markup.
 *
 * @param code The raw source. Copied/rendered verbatim on failure.
 * @param lang A language id (e.g. "ts", "json", "python"). Unknown ids retry
 *             once as plain "text"; if even that fails we return `null`.
 * @returns The highlighted HTML, or `null` to signal "render plain text".
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  // Oversized → don't even load Shiki; plain text is the right call.
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;

  let shiki: ShikiModule;
  try {
    shiki = await loadShiki();
  } catch (err) {
    // Import failed (and no CDN fallback). Silent — highlighting is optional.
    console.debug("[chat-widget] shiki load failed; rendering plain code:", err);
    return null;
  }

  const language = (lang || "text").toLowerCase();
  try {
    return await shiki.codeToHtml(code, {
      lang: language,
      themes: THEMES,
      // Emit CSS variables (--shiki-light/--shiki-dark) instead of inline fixed
      // colours, so the widget theme drives token colours per light/dark.
      defaultColor: false,
    });
  } catch {
    // Most commonly an unknown/unsupported language. Retry once as plain "text"
    // (which is always bundled) so we still get escaped, structured markup.
    if (language !== "text") {
      try {
        return await shiki.codeToHtml(code, {
          lang: "text",
          themes: THEMES,
          defaultColor: false,
        });
      } catch (err) {
        console.debug("[chat-widget] shiki highlight failed; rendering plain code:", err);
        return null;
      }
    }
    return null;
  }
}
