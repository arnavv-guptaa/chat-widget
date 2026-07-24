// Built-in page-context capture for the `context: 'auto'` prop (#239).
//
// A docs host that wants the assistant to know which page the user is on would
// otherwise have to hand-wire `context={{ route: location.pathname }}` and keep
// it fresh across SPA navigation. `context: 'auto'` captures that shape for
// them; this module is the single source of what "auto" means.
//
// SECURITY: the captured object is CLIENT-controlled input, exactly like a
// hand-written `context` object. It changes nothing about the server trust
// boundary — the handler still only sees it when it opts in via a server-side
// `getContext` or `trustClientContext: true` (see ChatWidgetConfig.context).
//
// To keep that boundary safe the DEFAULT capture is deliberately narrow:
// `origin + pathname`, the pathname, and the title — never the query string and
// (almost) never the fragment. Query strings and fragments routinely carry
// password-reset tokens, OAuth `state`/`code`, signed-URL signatures, tenant
// ids, raw search text, and client-side router state; shipping those to a model
// provider (once a host flips on `trustClientContext`) would be a real leak. A
// fragment is included ONLY when it looks like a plain docs anchor (see
// `isSafeAnchorHash`); anything token- or router-state-shaped is dropped.
//
// We also capture no identity data: no cookies, no `document.referrer`, no
// `navigator.userAgent`. Hosts that genuinely need the query string or a
// non-anchor fragment opt in EXPLICITLY through the function form
// (`buildAutoPageContext({ includeQuery: true })`) — never the bare `'auto'`
// string literal, which always uses the safe defaults.

import type { ChatContext } from '../types';

/**
 * Options for {@link buildAutoPageContext}. Both default to the safe capture;
 * set them only when the host has decided the extra data is safe to send to the
 * model provider under its `trustClientContext` / `getContext` policy.
 */
export interface AutoPageContextOptions {
  /**
   * Append the query string (`?...`) to the captured `url` AND expose it as a
   * separate `query` field (the raw `location.search`, including the leading
   * `?`). Default `false` — the query string is stripped entirely because it
   * routinely carries reset tokens, OAuth `state`/`code`, signed-URL
   * signatures, and PII in search params.
   */
  includeQuery?: boolean;
  /**
   * Bypass the conservative safe-anchor heuristic and capture the fragment
   * (`#...`) verbatim whenever one is present. Default `false` — by default a
   * fragment is captured ONLY when {@link isSafeAnchorHash} accepts it (a plain
   * docs anchor), so token-bearing / router-state fragments are dropped.
   */
  includeHash?: boolean;
}

// A fragment we are willing to ship by default: a plain in-page anchor such as
// `#installation` or `#step-2.1`. Deliberately conservative — it must start
// with an alphanumeric, be at most 129 chars total (`#` + up to 128), and use
// only a restricted anchor alphabet. The explicit exclusions below then reject
// anything shaped like query data or a route/state payload:
//   - `=` / `&` / `?` → `#access_token=…&state=…` (OAuth implicit flow, forms)
//   - `/`             → `#/app/users/42` (hash-router state, deep links)
// Token/state fragments fail on both the alphabet AND these exclusions, so they
// are dropped and the caller must opt in via `includeHash: true` to send them.
const SAFE_ANCHOR_RE = /^#[A-Za-z0-9][A-Za-z0-9\-_.:]{0,128}$/;

/**
 * True when `hash` (including its leading `#`) looks like a plain docs anchor
 * safe to include by default — NOT a token-bearing or router-state fragment.
 *
 * Rejects (→ dropped from the default capture): empty/`"#"`, anything
 * containing `=`, `&`, `?`, or `/` (query- or route-shaped), fragments longer
 * than 128 chars after the `#`, and anything using characters outside the
 * restricted anchor alphabet (e.g. `%`, spaces, `#access_token=…`).
 */
export function isSafeAnchorHash(hash: string): boolean {
  if (!hash || hash === '#') return false;
  // Defense-in-depth: the regex already excludes these, but assert the intent
  // explicitly so the exclusion set is obvious and independently guaranteed.
  if (
    hash.includes('=') ||
    hash.includes('&') ||
    hash.includes('?') ||
    hash.includes('/')
  ) {
    return false;
  }
  return SAFE_ANCHOR_RE.test(hash);
}

/**
 * Snapshot the current page location as a {@link ChatContext}.
 *
 * Read from `window.location` / `document` at call time, so calling it AT SEND
 * TIME reflects SPA route changes between messages. Every browser global is
 * guarded, so this is safe to call during SSR / in a non-browser runtime — it
 * returns `{}` there rather than throwing (no `window`/`document` access
 * outside the guards).
 *
 * Captured fields — the SAFE DEFAULT deliberately excludes the query string and
 * non-anchor fragments (see the security note above):
 * - `url`   — `origin + pathname` (NO query, NO fragment)
 * - `path`  — `pathname`
 * - `title` — `document.title` (omitted when empty)
 * - `hash`  — the fragment, included ONLY when {@link isSafeAnchorHash} accepts
 *             it as a plain docs anchor; otherwise omitted entirely
 *
 * Opt in to more, explicitly, via {@link AutoPageContextOptions} — only through
 * the function form (`buildAutoPageContext({ … })`); the bare `'auto'` string
 * literal ALWAYS uses these safe defaults:
 * - `includeQuery: true` — append the query string to `url` AND add a `query`
 *   field (raw `location.search`, including the leading `?`)
 * - `includeHash: true`  — capture the fragment verbatim, bypassing the anchor
 *   heuristic
 *
 * Never captures identity data (cookies, `document.referrer`,
 * `navigator.userAgent`). Any individual field whose global is unexpectedly
 * unavailable is simply omitted; the helper never throws.
 */
export function buildAutoPageContext(
  options?: AutoPageContextOptions,
): ChatContext {
  // SSR / non-browser: no location to read. Return an empty context so the
  // send path can spread it away to nothing (same shape as an undefined prop).
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {};
  }

  const includeQuery = options?.includeQuery ?? false;
  const includeHash = options?.includeHash ?? false;

  const context: ChatContext = {};

  const loc = window.location;
  if (loc) {
    // Safe base: origin + pathname, NEVER the query or fragment. `pathname`
    // alone would drop the origin; `href` would leak `?query#fragment`. Build
    // the URL from the discrete parts we trust.
    const origin = typeof loc.origin === 'string' ? loc.origin : '';
    const pathname = typeof loc.pathname === 'string' ? loc.pathname : '';
    const search = typeof loc.search === 'string' ? loc.search : '';

    let url = origin + pathname;
    // Query string: excluded by default (tokens / OAuth state / signed URLs /
    // PII in search params). Only appended — and mirrored into a `query`
    // field — when the host explicitly opts in.
    if (includeQuery && search) {
      url += search;
      context.query = search;
    }
    if (url) context.url = url;

    if (pathname) context.path = pathname;

    // Fragment: by default include it ONLY when it looks like a plain docs
    // anchor. `includeHash: true` bypasses the heuristic and takes the raw
    // fragment (still omitting an empty/"#"-only hash — that is just noise).
    const hash = typeof loc.hash === 'string' ? loc.hash : '';
    if (hash && hash !== '#') {
      if (includeHash || isSafeAnchorHash(hash)) {
        context.hash = hash;
      }
    }
  }

  // `document.title` is a string ("" when unset); include it only when present
  // so the shape stays minimal on title-less pages.
  if (typeof document.title === 'string' && document.title) {
    context.title = document.title;
  }

  return context;
}

/**
 * Resolve the `context` prop union ({@link ChatWidgetConfig.context}) to the
 * concrete {@link ChatContext} object that ships with a turn. This is the ONE
 * place the union is collapsed, called AT SEND TIME so `'auto'` and the
 * function form both reflect the live page/app state per message:
 *
 * - `'auto'`          → {@link buildAutoPageContext} with the SAFE DEFAULTS
 *                        (no query, anchor-only hash). Richer capture is opt-in
 *                        through the function form, e.g.
 *                        `context: () => buildAutoPageContext({ includeQuery: true })`
 * - a function        → called and awaited (sync or `Promise`); if it throws
 *                        or rejects, degrade to `{}` and `console.warn` ONCE so
 *                        a host bug in context assembly never blocks the message
 * - an object         → returned as-is (today's behaviour, unchanged)
 * - `undefined`       → `undefined` (serialises away — zero overhead)
 *
 * SECURITY: resolving `'auto'` or a function does not change the trust
 * boundary — the result is still untrusted client input the server only reads
 * when it opts in (see ChatWidgetConfig.context). This helper adds no identity
 * data of its own.
 */
export async function resolveChatContext(
  context:
    | ChatContext
    | 'auto'
    | (() => ChatContext | Promise<ChatContext>)
    | undefined,
): Promise<ChatContext | undefined> {
  if (context === undefined) return undefined;
  // The string literal ALWAYS uses the safe defaults. Hosts wanting the query
  // string or a non-anchor fragment go through the function form.
  if (context === 'auto') return buildAutoPageContext();

  if (typeof context === 'function') {
    try {
      return await context();
    } catch (err) {
      // A host-supplied context function threw/rejected. Context is an
      // enhancement, never a gate on sending — drop it for this turn and warn
      // once so the failure is debuggable without spamming the console on
      // every subsequent send.
      warnContextResolveFailedOnce(err);
      return {};
    }
  }

  // Plain object (or any other already-resolved value): pass through unchanged.
  return context;
}

// One-shot guard for the function-form failure warning: a broken context
// function would otherwise log on every single send.
let warnedContextResolveFailed = false;
function warnContextResolveFailedOnce(err: unknown): void {
  if (warnedContextResolveFailed) return;
  warnedContextResolveFailed = true;
  console.warn(
    '[mordn] context function threw; sending this turn without context.',
    err,
  );
}
