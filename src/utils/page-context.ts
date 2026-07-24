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
// To keep that boundary boring we capture ONLY page-location fields and no
// identity data: no cookies, no `document.referrer`, no `navigator.userAgent`.

import type { ChatContext } from '../types';

/**
 * Snapshot the current page location as a {@link ChatContext}.
 *
 * Returns `{ url, path, title, hash }` read from `window.location` /
 * `document` at call time, so calling it AT SEND TIME reflects SPA route
 * changes between messages. Every browser global is guarded, so this is safe
 * to call during SSR / in a non-browser runtime — it returns `{}` there
 * rather than throwing (no `window`/`document` access outside the guards).
 *
 * Captured fields (nothing else, by design — see the security note above):
 * - `url`   — `window.location.href` (full URL, including query string)
 * - `path`  — `window.location.pathname`
 * - `title` — `document.title`
 * - `hash`  — `window.location.hash` (omitted when empty)
 *
 * Any individual field whose global is unexpectedly unavailable is simply
 * omitted; the helper never throws.
 */
export function buildAutoPageContext(): ChatContext {
  // SSR / non-browser: no location to read. Return an empty context so the
  // send path can spread it away to nothing (same shape as an undefined prop).
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {};
  }

  const context: ChatContext = {};

  const loc = window.location;
  if (loc) {
    if (loc.href) context.url = loc.href;
    if (loc.pathname) context.path = loc.pathname;
    // Hash is often empty ("") — only include it when there is one, so a
    // hashless page doesn't ship a noisy empty field.
    if (loc.hash) context.hash = loc.hash;
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
 * - `'auto'`          → {@link buildAutoPageContext} (built-in page capture)
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
