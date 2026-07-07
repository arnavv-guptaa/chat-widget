/**
 * Script-tag embed — run the ChatWidget on ANY website, no build step.
 *
 * WHY THIS EXISTS
 * ---------------
 * The React package (`@mordn/chat-widget`) assumes the host owns a React tree
 * and a bundler. That is true for Next.js / Vite apps, but a large share of the
 * documentation web — MkDocs, Sphinx, Hugo, Jekyll, VitePress, Docusaurus's
 * static output, and plain hand-written HTML — has NO React and NO bundler.
 * Those authors cannot adopt the widget at all. Competitors win exactly these
 * sites with a single `<script>` tag, so this entry closes that adoption gap:
 * one tag, zero framework, the same widget and the same config surface.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The source for the standalone IIFE bundle (`dist/embed.global.js`). Unlike the
 * library entry (`src/index.ts`), this bundle is SELF-CONTAINED: React,
 * ReactDOM, and the whole widget are compiled IN (tsup `noExternal: [/.*/]`), so
 * the host page needs nothing installed. It exposes an imperative global,
 * `window.MordnChat`, and supports a declarative `data-*` auto-init so the
 * simplest sites never touch JavaScript.
 *
 * The API mirrors the React `ChatWidgetConfig` 1:1 (issue #192): whatever a
 * developer can pass as props to `<ChatWidget>` they can pass to
 * `MordnChat.init(...)`, so documentation and mental model stay unified across
 * the React and script-tag paths.
 *
 * CSS: styles are built AFTER tsup by the Tailwind CLI + `scripts/scope-css.js`,
 * so tsup literally cannot see them at bundle time. We therefore embed a
 * placeholder literal, `"__MORDN_WIDGET_CSS__"`, that a post-build step
 * (`scripts/inline-embed-css.js`) rewrites into the real, already-scoped CSS.
 * At runtime we inject it once into a `<style data-mordn-chat>`. If the
 * placeholder was never substituted (defensive — someone ran a raw `tsup`
 * without the post-build chain), we fall back to a `<link>` to the published
 * stylesheet on unpkg. See the CSS section below for the full rationale.
 *
 * SHIKI (code highlighting) — cross-PR contract, DOCS_CONTRACT §6: the sibling
 * highlighting PR lazy-loads `shiki/bundle/web` via a static dynamic import so
 * app bundlers resolve it at build time. In script-tag land there is no bundler
 * to resolve that bare specifier, so this bundle marks shiki `external` (esbuild
 * leaves the import literal, which fails fast in the browser) and sets
 * `globalThis.__MORDN_SHIKI_URL__` to a CDN ESM URL during `init`. The sibling
 * loader's `catch` then imports shiki from that URL instead. Highlighting is
 * progressive enhancement — every failure path degrades to plain `<pre>` text,
 * never a hard dependency. NOTE: `main` has no shiki usage yet; this wiring is
 * inert until the highlighting branch merges, and it costs the bundle nothing
 * (the import is external, so shiki is not compiled in).
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { nanoid } from 'nanoid';
import { ChatWidget, type ChatWidgetHandle, type ChatWidgetProps } from '../ChatWidget';

// ── Build-time defines ───────────────────────────────────────────────────────
// Substituted by esbuild (`define`) / the post-build CSS step. Declared here so
// TypeScript is happy in-editor; the real values arrive at build time.
//
// `__MORDN_WIDGET_CSS__` is a bare string literal that tsup preserves verbatim
// (esbuild does NOT treat it as a define — it is a normal string in the source).
// `scripts/inline-embed-css.js` finds that literal in the emitted bundle and
// replaces every occurrence with the JSON-stringified contents of
// `dist/styles.css`. Trivial to grep for in a pre-merge check (the built
// `dist/embed.global.js` must contain NO `__MORDN_WIDGET_CSS__` after the step).
//
// NOTE on minification: esbuild (`minify: true`) may inline this single-use
// `const` at its use sites, so the placeholder token can appear more than once
// in the emitted bundle. That is fine — the post-build step replaces ALL
// occurrences, and the "was it inlined?" runtime check below deliberately does
// NOT reference the placeholder token (which would be corrupted by that
// replace or folded by esbuild). Instead it tests a structural property that
// only ever holds for the REAL stylesheet.
const INLINED_CSS = '__MORDN_WIDGET_CSS__';

// Package version, injected via tsup `define` (`__MORDN_WIDGET_VERSION__`).
// Used only to build the CSS fallback `<link>` URL so it pins to the exact
// published stylesheet. Declared as `any` on globalThis to avoid a global .d.ts.
declare const __MORDN_WIDGET_VERSION__: string;

// ── Public config surface ────────────────────────────────────────────────────
/**
 * Config accepted by {@link MordnChat.init}. This is the React `ChatWidget`
 * prop surface (`ChatWidgetProps`, which itself extends `ChatWidgetConfig` and
 * adds `agentId` / `apiBase` / `extraHeaders` / `className`) with two changes
 * for the embed context:
 *
 *  - `userId` is OPTIONAL here. In a React app the host supplies the id from its
 *    auth session; a static docs site has no session, so when it is omitted we
 *    mint a stable anonymous id (see {@link resolveUserId}). The server is still
 *    the identity boundary — this id is only for client-side conversation
 *    scoping, exactly like the React path (see the security note in README).
 *  - Two embed-only fields are added: `target` and `cssUrl`.
 *
 * Everything else passes through to `<ChatWidget>` unchanged — 1:1 with the
 * documented React props, so there is a single config vocabulary to learn.
 */
export interface MordnChatConfig extends Omit<ChatWidgetProps, 'userId' | 'ref'> {
  /**
   * Client-side user id. OPTIONAL for the embed: omit it on anonymous docs
   * sites and a persistent `anon-…` id is generated and reused across visits.
   */
  userId?: string;

  /**
   * CSS selector for an existing element to mount INTO (e.g. `"#chat"`). When
   * given, the widget renders inside that element — natural for the `inline` /
   * `page` layouts. When omitted, a container `<div>` is appended to
   * `document.body`, which suits the default floating `popup` layout.
   */
  target?: string;

  /**
   * Override the stylesheet URL used by the defensive fallback path only. Has
   * NO effect when the CSS was inlined at build time (the normal case). Use it
   * if you self-host the stylesheet or pin a specific CDN copy.
   */
  cssUrl?: string;
}

/**
 * Handle returned by {@link MordnChat.init} and mirrored on `window.MordnChat`.
 * `open` / `close` / `toggle` delegate to the mounted widget's imperative ref
 * (the same {@link ChatWidgetHandle} React consumers use). `destroy` unmounts
 * React and removes the container element this init created.
 */
export interface MordnChatInstance {
  /** Open the popup panel. Gated by the widget's `allowAutoReopen` (see config). */
  open: () => void;
  /** Close the popup panel. Always allowed. */
  close: () => void;
  /** Toggle the popup panel. Opening obeys the same `allowAutoReopen` gate. */
  toggle: () => void;
  /** Unmount the widget and remove the container element created for it. */
  destroy: () => void;
}

// ── Module-level singleton ───────────────────────────────────────────────────
// The embed supports exactly ONE mounted widget at a time (the overwhelmingly
// common case for a docs assistant). We track the active mount so `init` is
// idempotent — a second `init` tears the first down before mounting — and so the
// top-level `open`/`close`/`toggle`/`destroy` can act on "the current widget"
// without the caller threading a handle around.
interface ActiveMount {
  root: Root;
  container: HTMLElement;
  /** True when WE created the container (append-to-body); false when we mounted
   *  into a host-owned `target` element and must NOT remove it on destroy. */
  ownsContainer: boolean;
  handleRef: React.RefObject<ChatWidgetHandle | null>;
}

let active: ActiveMount | null = null;

// ── CSS injection ────────────────────────────────────────────────────────────
// The widget's CSS is already SCOPED to `.chat-widget-container` and unlayered
// by `scripts/scope-css.js`, so injecting it globally into the host page is
// safe: the selectors only match inside the widget's own container and win on
// specificity regardless of host resets or stylesheet order. We inject once and
// guard on a stable `data-mordn-chat` marker so repeated `init` calls (or
// multiple widgets in theory) never duplicate the stylesheet.

const STYLE_MARKER = 'data-mordn-chat';

/** True once our stylesheet (inline `<style>` or fallback `<link>`) is present. */
function stylesInjected(): boolean {
  return !!document.querySelector(`[${STYLE_MARKER}]`);
}

/**
 * Inject the widget stylesheet exactly once.
 *
 * Primary path: the build inlined the real CSS into `INLINED_CSS`, so we drop it
 * straight into a `<style>` — zero extra network request, works offline and
 * behind auth. Fallback path (defensive): the placeholder was never replaced
 * (the bundle was built without the post-build step), so we link the published
 * stylesheet from a CDN instead. `config.cssUrl` overrides the fallback URL.
 *
 * CSP note: the primary path needs `style-src 'unsafe-inline'` (or a nonce we
 * cannot set from here); the fallback path needs the CDN host in `style-src`.
 * Documented in the README so locked-down sites can choose the right path.
 */
function injectStyles(cssUrl?: string): void {
  if (typeof document === 'undefined' || stylesInjected()) return;

  // "Was the CSS inlined at build time?" We test a STRUCTURAL property instead
  // of comparing to the placeholder token: `scripts/scope-css.js` scopes every
  // rule to `.chat-widget-container`, so the real stylesheet always contains
  // that string, while the un-substituted placeholder never does. This avoids
  // referencing the placeholder token here — which esbuild could constant-fold
  // or the post-build replace could corrupt — making the check robust under
  // minification whether or not `INLINED_CSS` got inlined at its use sites.
  const wasInlined = INLINED_CSS.indexOf('.chat-widget-container') !== -1;

  if (wasInlined) {
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARKER, 'inline');
    style.textContent = INLINED_CSS;
    document.head.appendChild(style);
    return;
  }

  // Fallback: link the published, pre-scoped stylesheet. Version is pinned via
  // the build-time define so the CSS always matches this bundle's markup.
  const version =
    typeof __MORDN_WIDGET_VERSION__ !== 'undefined' ? __MORDN_WIDGET_VERSION__ : 'latest';
  const href =
    cssUrl || `https://unpkg.com/@mordn/chat-widget@${version}/dist/styles.css`;
  const link = document.createElement('link');
  link.setAttribute(STYLE_MARKER, 'link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// ── Anonymous identity ───────────────────────────────────────────────────────
// Docs visitors are anonymous — there is no auth session to source a user id
// from. To keep a visitor's conversation history coherent across page loads we
// mint ONE persistent id and reuse it. This id is purely a client-side scoping
// key (same role as the React `userId`); the server remains the real identity
// boundary and must not trust it (see README security note).

const ANON_ID_KEY = 'mordn-chat-anon-id';

/**
 * Return the id to scope this visitor's conversations to. Prefers an explicit
 * `userId` (a docs site with real auth can still pass one). Otherwise reuses a
 * persisted anonymous id, generating and storing a new `anon-…` id on first
 * visit. All localStorage access is guarded: Safari private mode, disabled
 * storage, and quota errors throw on access, so we fall back to a fresh
 * per-session id rather than crashing the whole widget.
 */
function resolveUserId(explicit?: string): string {
  if (explicit) return explicit;

  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const fresh = `anon-${nanoid()}`;
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable/blocked — degrade to an ephemeral id. History won't
    // persist across reloads, but the widget still works this session.
    return `anon-${nanoid()}`;
  }
}

// ── Shiki CDN wiring (DOCS_CONTRACT §6) ──────────────────────────────────────
/**
 * Point the sibling highlighting loader at a CDN copy of shiki. In a bundler the
 * static `import("shiki/bundle/web")` resolves at build time; here shiki is
 * `external`, so that import fails as a bare specifier and the loader's `catch`
 * falls back to `import(globalThis.__MORDN_SHIKI_URL__)`. We pin the CDN URL to
 * the SAME major shiki version this package depends on (3.x) so the ESM API the
 * loader expects matches. Inert on `main` (no shiki usage yet); live once the
 * highlighting branch merges. Idempotent — never clobber a URL a host set.
 */
function ensureShikiUrl(): void {
  const g = globalThis as unknown as { __MORDN_SHIKI_URL__?: string };
  if (!g.__MORDN_SHIKI_URL__) {
    g.__MORDN_SHIKI_URL__ = 'https://esm.sh/shiki@3/bundle/web';
  }
}

// ── Mount lifecycle ──────────────────────────────────────────────────────────

/** Resolve the mount point: a host element via `target`, or a fresh body div. */
function resolveContainer(target?: string): { el: HTMLElement; owns: boolean } {
  if (target) {
    const found = document.querySelector<HTMLElement>(target);
    if (found) return { el: found, owns: false };
    // A `target` was requested but not found — fail loud enough to debug, then
    // fall back to a body container so the widget still appears rather than
    // silently doing nothing.
    console.warn(
      `[MordnChat] target selector "${target}" matched no element; ` +
        'mounting a new container on <body> instead.'
    );
  }
  const el = document.createElement('div');
  el.className = 'mordn-chat-embed-root';
  document.body.appendChild(el);
  return { el, owns: true };
}

/**
 * Initialise (or re-initialise) the widget.
 *
 * Idempotent: a second call destroys the previous mount first, so hosts can
 * safely re-init with new config (e.g. after a client-side route change on a
 * docs SPA) without stacking widgets. Returns a handle whose methods delegate to
 * this specific mount.
 */
function init(config: MordnChatConfig = {} as MordnChatConfig): MordnChatInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // SSR / non-browser guard. The embed is a browser artifact; if it somehow
    // runs server-side, return inert no-ops rather than throwing.
    return { open() {}, close() {}, toggle() {}, destroy() {} };
  }

  // Idempotency: tear down any existing mount before creating a new one.
  if (active) destroy();

  ensureShikiUrl();
  injectStyles(config.cssUrl);

  const { target, cssUrl: _cssUrl, userId, ...rest } = config;
  const { el, owns } = resolveContainer(target);

  const handleRef = React.createRef<ChatWidgetHandle | null>();
  const root = createRoot(el);

  // Pass the config through to <ChatWidget> 1:1. `ChatWidget` takes FLAT props
  // (it is `forwardRef<ChatWidgetHandle, ChatWidgetProps>`, not a `config`
  // prop), so we spread the remaining fields and layer on the resolved id.
  const props: ChatWidgetProps = {
    ...(rest as ChatWidgetProps),
    userId: resolveUserId(userId),
  };
  root.render(React.createElement(ChatWidget, { ...props, ref: handleRef }));

  active = { root, container: el, ownsContainer: owns, handleRef };
  return instanceApi();
}

/** Unmount React and remove the container we created (never a host `target`). */
function destroy(): void {
  if (!active) return;
  const { root, container, ownsContainer } = active;
  active = null;
  try {
    root.unmount();
  } catch {
    /* already unmounted — ignore */
  }
  if (ownsContainer && container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

/** Build the imperative API object bound to the current active mount. */
function instanceApi(): MordnChatInstance {
  return {
    open: () => active?.handleRef.current?.open(),
    close: () => active?.handleRef.current?.close(),
    toggle: () => active?.handleRef.current?.toggle(),
    destroy,
  };
}

// ── Declarative auto-init (`data-*` on the script tag) ───────────────────────
// The simplest possible adoption: drop one `<script>` with data attributes and
// the widget mounts itself — no inline JS at all. `data-config` carries a full
// JSON `MordnChatConfig`; the ergonomic shortcuts below cover the common fields
// without hand-writing JSON.
//
// PRECEDENCE: `data-config` (parsed JSON) is the BASE; individual shortcut
// attributes OVERLAY it (a `data-user-id` beats the `userId` inside
// `data-config`). This lets a site keep one shared JSON blob and tweak a single
// field per page via a shortcut.

/**
 * Read declarative config off the currently executing `<script>` element.
 * Returns `null` when the script carries none of our attributes — the signal
 * that the host is driving `MordnChat.init(...)` manually and we must NOT
 * auto-init.
 */
function readScriptConfig(script: HTMLElement | null): MordnChatConfig | null {
  if (!script) return null;

  const raw = script.getAttribute('data-config');
  const hasConfig = raw !== null;

  // Ergonomic shortcuts. Each maps to a REAL config/prop key (verified against
  // src/types.ts + src/ChatWidget.tsx): userId, agentId, apiBase, model are the
  // fields a docs embed realistically sets inline; target/cssUrl are embed-only.
  const shortcuts: Partial<MordnChatConfig> = {};
  const map: Array<[attr: string, key: keyof MordnChatConfig]> = [
    ['data-user-id', 'userId'],
    ['data-agent-id', 'agentId'],
    ['data-api-base', 'apiBase'],
    ['data-model', 'model'],
    ['data-target', 'target'],
    ['data-css-url', 'cssUrl'],
  ];
  let hasShortcut = false;
  for (const [attr, key] of map) {
    const v = script.getAttribute(attr);
    if (v !== null) {
      (shortcuts as Record<string, unknown>)[key] = v;
      hasShortcut = true;
    }
  }

  if (!hasConfig && !hasShortcut) return null;

  let base: MordnChatConfig = {} as MordnChatConfig;
  if (hasConfig && raw) {
    try {
      base = JSON.parse(raw) as MordnChatConfig;
    } catch (err) {
      console.error('[MordnChat] data-config is not valid JSON; ignoring it.', err);
    }
  }

  // Shortcuts overlay the JSON base.
  return { ...base, ...shortcuts };
}

/**
 * Auto-init entry point. Resolves the script config and, if present, mounts once
 * the DOM is ready. `document.currentScript` is only valid during initial
 * synchronous execution, so we capture it immediately at module scope below.
 */
function autoInit(script: HTMLElement | null): void {
  const config = readScriptConfig(script);
  if (!config) return;

  const run = () => init(config);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    // DOM already parsed (script loaded `async`/`defer` or placed at end of
    // body) — mount immediately.
    run();
  }
}

// ── Global install ───────────────────────────────────────────────────────────
// Publish the imperative API. `open`/`close`/`toggle` are thin wrappers that act
// on whatever mount is currently active, so a host can call
// `MordnChat.open()` without holding the handle `init` returned.
const MordnChat = {
  init,
  open: () => active?.handleRef.current?.open(),
  close: () => active?.handleRef.current?.close(),
  toggle: () => active?.handleRef.current?.toggle(),
  destroy,
};

declare global {
  interface Window {
    MordnChat: typeof MordnChat;
  }
}

if (typeof window !== 'undefined') {
  window.MordnChat = MordnChat;
  // Capture the executing <script> NOW (currentScript is null once async
  // callbacks run) and hand it to the auto-init flow.
  autoInit(document.currentScript as HTMLElement | null);
}

export { MordnChat };
export default MordnChat;
