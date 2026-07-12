'use client';

/**
 * ChatWidget - Self-contained AI chat widget component
 *
 * This component can be embedded in any React application.
 * It handles its own state, styling, and API communication.
 *
 * The mounted handler authenticates the browser and supplies published client
 * configuration plus an opaque browser-storage scope through `/bootstrap`.
 * Callers can render `<ChatWidget />` with no identity or agent props.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import ChatInterface from './components/interface';
import type {
  ActionRenderer,
  ChatContext,
  FollowUpConfig,
  InputPlugin,
  StarterPrompt,
  ToolRenderer,
} from './types';
import type { AgentBootstrap, AgentConfig } from './config';
import { isAgentBootstrap, mergeAgentClientConfig } from './config';
import { MessageCircle, X } from 'lucide-react';
import { ChatStorageProvider } from './contexts/chat-storage-context';
import { ChatPortalProvider } from './contexts/chat-portal-context';
import { contrastForegroundTriplet, hexToHslTriplet } from './utils/color';
import { useOpenTriggers } from './hooks/use-open-triggers';

export interface ChatWidgetProps {
  /** Full canonical config for caller overrides or an authenticated preview. */
  config?: AgentConfig;
  /** Handler mount. The widget calls `${apiBase}/bootstrap` on mount. */
  apiBase?: string;
  /** Generic transport headers (for example a host's CSRF token). */
  headers?: Record<string, string>;
  requestCredentials?: RequestCredentials;
  className?: string;
  conversationId?: string;
  initialMessages?: any[];
  context?: ChatContext;
  getStarterPrompts?: () => StarterPrompt[] | Promise<StarterPrompt[]>;
  onClose?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStateChange?: (open: boolean) => void;
  headerActions?: ReactNode;
  inputPlugins?: InputPlugin[];
  toolRenderers?: Record<string, ToolRenderer>;
  actionRenderers?: Record<string, ActionRenderer>;
  followUps?: FollowUpConfig;
  onFeedback?: (feedback: import('./types').FeedbackEvent) => void;
}

/**
 * Imperative handle exposed via a ref on `<ChatWidget>`. Lets the host app
 * drive the popup panel programmatically. Opening is gated by
 * `config.client.allowAutoReopen` so a dismissed panel is never
 * re-surfaced without explicit opt-in; closing is always allowed. Only
 * meaningful in the `popup` layout (inline/page are always-open surfaces).
 */
export interface ChatWidgetHandle {
  /** Open the panel. No-op unless `allowAutoReopen` is set. */
  open: () => void;
  /** Close the panel. Always allowed. */
  close: () => void;
  /** Toggle the panel. Opening obeys the same `allowAutoReopen` gate as `open()`. */
  toggle: () => void;
  /** Whether the panel is currently open. */
  readonly isOpen: boolean;
}

export const ChatWidget = forwardRef<ChatWidgetHandle, ChatWidgetProps>(function ChatWidget({
  config: explicitConfig,
  apiBase: apiBaseProp = '/api/chat',
  headers,
  requestCredentials,
  conversationId,
  initialMessages,
  className,
  getStarterPrompts,
  context,
  onClose,
  headerActions,
  open,
  onOpenChange,
  onStateChange,
  inputPlugins,
  toolRenderers,
  actionRenderers,
  followUps,
  onFeedback,
}: ChatWidgetProps, ref) {
  const apiBase = apiBaseProp.replace(/\/+$/, '');
  const [bootstrap, setBootstrap] = useState<AgentBootstrap | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const headersKey = JSON.stringify(headers ?? null);
  const stableHeaders = useMemo(
    () => headers,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value-keyed on purpose
    [headersKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    setBootstrap(null);
    setBootstrapError(null);
    setBootstrapReady(false);
    fetch(`${apiBase}/bootstrap`, {
      method: 'GET',
      headers: stableHeaders,
      credentials: requestCredentials,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`bootstrap failed (${response.status})`);
        const value: unknown = await response.json();
        if (!isAgentBootstrap(value)) throw new Error('bootstrap returned an invalid response');
        return value;
      })
      .then((value) => setBootstrap(value))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setBootstrap(null);
        setBootstrapError(
          error instanceof Error ? error.message : 'bootstrap failed',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBootstrapReady(true);
      });
    return () => controller.abort();
  }, [apiBase, stableHeaders, requestCredentials, bootstrapAttempt]);

  const client = mergeAgentClientConfig(bootstrap?.client, explicitConfig?.client);
  const { greeting, theme, features, display, starterPrompts, capabilitiesPrompt, feedback } = client;
  const persistState = client.persistState;
  const allowAutoReopen = client.allowAutoReopen;
  const layout = display?.layout || 'popup';
  // Controlled mode: consumer provides `open` prop. We delegate state to
  // them and skip the built-in FAB so they can render their own trigger.
  const isControlled = open !== undefined;
  const showToggleButton = !isControlled && display?.showToggleButton !== false;
  // Resize only makes sense for the popup layout — inline/page take their
  // size from the parent container.
  const resizable = layout === 'popup' && display?.resizable !== false;
  const size = display?.size || 'default';

  // Persist the panel's open/closed state. Default on; only meaningful for
  // the uncontrolled popup layout (controlled mode → host owns `open`;
  // inline/page are always open).
  const persistEnabled = persistState !== false && !isControlled && layout === 'popup';
  // localStorage key for the panel state, scoped to (agent, user) using the
  // SAME `chat-<prefix>-` convention as the chat cache (chat-storage-context),
  // so clearChatStorage() wipes it on sign-out and distinct identities never
  // collide. `null` when identity is incomplete → we never persist (no
  // shared/static fallback bucket; same cross-user-leak guard as the cache).
  const panelStateKey =
    persistEnabled && bootstrap?.storageScope
      ? `chat-${encodeURIComponent(bootstrap.storageScope)}-panel-open`
      : null;

  // Open state is meaningful for popup layout only. Inline and page modes
  // are always "open" since they're embedded surfaces, not floating panels.
  // Initialise from `defaultOpen` (SSR-safe — no localStorage read in the
  // initialiser, which would cause a hydration mismatch); reconcile with any
  // persisted preference in the effect below.
  const [internalIsOpen, setInternalIsOpen] = useState(
    layout !== 'popup' ? true : (display?.defaultOpen || false)
  );
  const isOpen = isControlled ? open : internalIsOpen;

  // Hydrate the persisted open/closed preference once the (agent, user) scope
  // is known. A stored 'closed' overrides `defaultOpen` — this is the
  // "dismiss-and-stay-dismissed" guarantee. Client-side only; restoring the
  // saved value is initialisation, so it deliberately does NOT fire
  // onStateChange.
  useEffect(() => {
    if (!panelStateKey) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const stored = window.localStorage.getItem(panelStateKey);
      if (stored === 'open') setInternalIsOpen(true);
      else if (stored === 'closed') setInternalIsOpen(false);
      else setInternalIsOpen(display?.defaultOpen || false);
    } catch {
      /* localStorage unavailable (private mode / quota) — ignore. */
    }
  }, [panelStateKey, display?.defaultOpen]);

  // Single entry point for changing open state: handles controlled vs
  // uncontrolled, persistence, the onStateChange callback, and the
  // allowAutoReopen gate for programmatic opens.
  const setOpenState = useCallback(
    (next: boolean, opts?: { programmatic?: boolean }) => {
      if (next === isOpen) return; // no-op: nothing changed
      // Gate programmatic *opening* behind allowAutoReopen. User actions
      // (FAB / toggle / close X) pass programmatic:false and are always
      // honoured. Closing is always allowed.
      if (next && opts?.programmatic && !allowAutoReopen) return;
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalIsOpen(next);
        if (panelStateKey && typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(panelStateKey, next ? 'open' : 'closed');
          } catch {
            /* ignore persistence failure */
          }
        }
      }
      onStateChange?.(next);
    },
    [isOpen, allowAutoReopen, isControlled, onOpenChange, onStateChange, panelStateKey]
  );

  // User-driven open/close helper (always allowed). Used by the FAB and the
  // panel's own close button.
  const setIsOpen = useCallback((next: boolean) => setOpenState(next), [setOpenState]);

  // Expose an imperative handle so hosts can drive the panel. Opening is
  // gated by allowAutoReopen; closing and reading are always available.
  useImperativeHandle(
    ref,
    (): ChatWidgetHandle => ({
      open: () => setOpenState(true, { programmatic: true }),
      close: () => setOpenState(false),
      toggle: () => setOpenState(!isOpen, { programmatic: !isOpen }),
      isOpen,
    }),
    [setOpenState, isOpen]
  );

  // Page-chrome open triggers (#193): keyboard shortcut, `data-mordn-chat-*`
  // attribute buttons, and the `document` CustomEvent API. These call the
  // EXACT SAME `setOpenState` the imperative handle above uses, with the
  // same `programmatic` gating, so a docs-site nav button and a React ref
  // behave identically — same allowAutoReopen gate, same controlled-mode
  // onOpenChange delegation, same persistState behaviour.
  const triggerOpen = useCallback(() => setOpenState(true, { programmatic: true }), [setOpenState]);
  const triggerClose = useCallback(() => setOpenState(false), [setOpenState]);
  const triggerToggle = useCallback(
    () => setOpenState(!isOpen, { programmatic: !isOpen }),
    [setOpenState, isOpen]
  );
  useOpenTriggers(display?.keyboardShortcut, { open: triggerOpen, close: triggerClose, toggle: triggerToggle });

  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  // ── Close choreography (popup) ───────────────────────────────────────────
  // The panel unmounts on close, but not in the same frame it was told to
  // close: the entrance is animated and an instant vanish read like a crash
  // (a chat-slide-out-right keyframe existed and was never wired). While
  // `isClosing` the panel stays mounted with data-closing="true", plays the
  // exit animation, and unmounts on animationend — with a timer safety net in
  // case the animation never runs (host display:none, animations stripped).
  // Reduced-motion users skip the choreography entirely.
  const [isClosing, setIsClosing] = useState(false);
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (isOpen) {
      setIsClosing(false);
      return;
    }
    if (wasOpen && layout === 'popup') {
      const reduceMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) return;
      setIsClosing(true);
      const safety = setTimeout(() => setIsClosing(false), 320);
      return () => clearTimeout(safety);
    }
  }, [isOpen, layout]);

  // ── Focus choreography (popup) ───────────────────────────────────────────
  // Opening moves focus INTO the panel (the container itself, tabIndex=-1 —
  // tabbing then flows to the composer naturally, without force-popping the
  // mobile keyboard); closing hands it back to the launcher, but only when
  // focus was actually inside the panel (or already dropped to body after an
  // unmount) — a host that closes the widget programmatically while the user
  // works elsewhere must not have focus stolen.
  useEffect(() => {
    if (layout !== 'popup') return;
    if (isOpen) {
      const raf = requestAnimationFrame(() => {
        containerRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }
    const active = document.activeElement;
    if (
      fabRef.current &&
      (active === null || active === document.body || containerRef.current?.contains(active))
    ) {
      fabRef.current.focus({ preventScroll: true });
    }
  }, [isOpen, layout]);

  // Escape closes the popup — unless something inside (a Radix menu, a
  // dialog) already claimed the keypress via preventDefault.
  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // isComposing: an IME user pressing Escape is cancelling their
      // composition, not the panel.
      if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) {
        e.stopPropagation();
        setIsOpen(false);
      }
    },
    [setIsOpen]
  );

  // Build CSS custom properties from display + theme config.
  //
  // Theme handling: the widget's CSS expects `--chat-primary`, `--chat-background`
  // and `--chat-text` to be HSL TRIPLETS (e.g. "0 0% 14.5%") because they're
  // consumed inside `hsl(var(--chat-primary))`. Consumers naturally want to
  // pass hex colors though, so we convert when we can detect hex; anything
  // else is forwarded as-is on the assumption the caller knows what they're
  // doing (e.g. they passed an HSL triplet directly).
  const customStyles = useMemo(() => {
    const styles: Record<string, string> = {};
    if (display?.width) {
      styles['--chat-widget-width'] = display.width;
    }

    // Theming is all-or-nothing: exactly three declared colors (background,
    // text, primary). If any is missing or not valid hex the theme is ignored
    // and the stock palette applies -- a theme is never half-applied. The
    // widget renders what the client declared; contrast is their call (the
    // playground is where combinations get validated).
    const parse = (t: string | null) => {
      const m = t ? /^([\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(t.trim()) : null;
      return m ? { h: +m[1], s: +m[2], l: +m[3] } : null;
    };
    const bg = theme ? parse(hexToHslTriplet(theme.backgroundColor)) : null;
    const text = theme ? parse(hexToHslTriplet(theme.textColor)) : null;
    const primaryTriplet = theme ? hexToHslTriplet(theme.primaryColor) : null;

    if (bg && text && primaryTriplet) {
      // Every neutral is a named stop on ONE ramp between the two poles:
      // fraction = how far from the background toward the text color. Hue,
      // saturation and lightness all interpolate, so the whole panel
      // re-anchors on the declared colors and nothing else.
      const lerp = (from: number, to: number, f: number) =>
        Math.round((from + (to - from) * f) * 10) / 10;
      const hueDelta = (() => {
        let d = text.h - bg.h;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return d;
      })();
      const tone = (f: number) =>
        `${(lerp(0, hueDelta, f) + bg.h + 360) % 360} ${lerp(bg.s, text.s, f)}% ${lerp(bg.l, text.l, f)}%`;

      // STRUCTURAL stops (surfaces, hovers, dividers, borders) get a floor:
      // when the declared poles sit close together (near-mono palettes — or
      // bg === text by mistake), a pure fraction of that tiny range makes
      // the widget's own furniture invisible: no borders, no dividers, no
      // hover feedback. Ink stops stay verbatim fractions — the declared
      // text contrast is the client's call (validated in the playground) —
      // but structure never silently vanishes. Each structural stop is
      // guaranteed a minimum lightness offset from the background, pushed
      // toward the text pole, flipping to the other side only when the
      // background sits so close to that extreme there's no room left.
      const dir = text.l >= bg.l ? 1 : -1;
      const clampL = (n: number) => Math.min(100, Math.max(0, n));
      const structuralTone = (f: number, minDelta: number) => {
        const lerped = lerp(bg.l, text.l, f);
        let l = Math.abs(lerped - bg.l) >= minDelta ? lerped : clampL(bg.l + minDelta * dir);
        if (Math.abs(l - bg.l) + 0.25 < minDelta) l = clampL(bg.l - minDelta * dir);
        return `${(lerp(0, hueDelta, f) + bg.h + 360) % 360} ${lerp(bg.s, text.s, f)}% ${l}%`;
      };

      // Consolidated neutral set: one background, one raised/inset fill, one
      // hover state, one hairline. The old 0.02/0.035/0.05 surface triplets
      // and the divider/border twins were imperceptibly close (≤1.3% L apart)
      // — six names for three distinguishable colors. Every surviving pair is
      // now ≥4% L apart, and all tokens are raw HSL triplets (consumed inside
      // hsl(...)), no full-color exceptions.
      styles['--chat-background'] = tone(0);
      styles['--chat-surface'] = structuralTone(0.05, 3.5); // cards, composer, fills
      styles['--chat-hover-bg'] = structuralTone(0.1, 6); // the one hover state
      styles['--chat-border'] = structuralTone(0.12, 7); // hairlines + input borders
      styles['--chat-text-subtle'] = tone(0.42); // placeholder / disabled
      styles['--chat-text-muted'] = tone(0.75); // icons / secondary text — close to text, still clearly secondary
      styles['--chat-text-strong'] = tone(0.88);
      styles['--chat-text'] = tone(1);
      styles['--chat-primary'] = primaryTriplet;
      // Text ON the brand color — the send button, the launcher icon, and
      // user-bubble text are all painted over --chat-primary. This was
      // hardwired to the background color, which a light brand (yellow,
      // pastel, white) rendered unreadable (≈1.5:1). Picked by WCAG relative
      // luminance — NOT HSL lightness, which calls pure yellow "medium" —
      // and the CSS falls back to the background for the stock palette.
      const primaryForeground = contrastForegroundTriplet(theme?.primaryColor ?? '');
      if (primaryForeground) styles['--chat-primary-foreground'] = primaryForeground;
      // Scrim over content: translucency is the intent here, so alpha is
      // correct; direction just follows which pole is lighter.
      styles['--chat-overlay'] =
        text.l > bg.l ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)';
    }
    return styles;
  }, [display?.width, theme?.backgroundColor, theme?.textColor, theme?.primaryColor]);

  // ── Resize (pointer + keyboard) ──────────────────────────────────────────
  // Pointer Events instead of mouse events so mouse, touch and pen all drag
  // through one path (the old onMouseDown version was silently unusable on
  // touch). Pointer capture keeps move/up targeting the handle itself, so no
  // document-level listeners to leak.

  // Resize constraints (reasonable bounds for any chat widget).
  const RESIZE_MIN_PX = 300;
  const resizeMaxPx = () => Math.min(800, window.innerWidth * 0.8);

  const applyPanelWidth = useCallback((px: number) => {
    const clamped = Math.min(resizeMaxPx(), Math.max(RESIZE_MIN_PX, px));
    containerRef.current?.style.setProperty('--chat-widget-width', `${clamped}px`);
  }, []);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setIsResizing(true);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [resizable]
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return;
      // Panel is anchored to the right edge: width = viewport edge → pointer.
      applyPanelWidth(window.innerWidth - e.clientX);
    },
    [isResizing, applyPanelWidth]
  );

  const endResize = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Restore the page-wide drag affordances when the drag ends — INCLUDING
  // when the widget unmounts mid-drag (host closes the panel, route change).
  // The old cleanup removed its listeners but left the host page stuck with
  // cursor:ew-resize and text selection disabled.
  useEffect(() => {
    if (!isResizing) return;
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Keyboard operability for the separator: arrows nudge, Home/End jump to
  // the bounds. The panel is right-anchored, so ArrowLeft grows it.
  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!resizable || !containerRef.current) return;
      const current = parseFloat(getComputedStyle(containerRef.current).width);
      if (Number.isNaN(current)) return;
      const step = 16;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        applyPanelWidth(current + step);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        applyPanelWidth(current - step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        applyPanelWidth(RESIZE_MIN_PX);
      } else if (e.key === 'End') {
        e.preventDefault();
        applyPanelWidth(resizeMaxPx());
      }
    },
    [resizable, applyPanelWidth]
  );

  const interfaceConfig = useMemo(() => ({
    apiBase,
    headers: stableHeaders,
    requestCredentials,
    requestConfig: explicitConfig,
    greeting,
    theme,
    features,
    starterPrompts,
    getStarterPrompts,
    capabilitiesPrompt,
    starterPromptsLayout: display?.starterPromptsLayout,
    context,
    inputPlugins,
    toolRenderers,
    actionRenderers,
    followUps: followUps ?? client.followUps,
    feedback,
    streamingThrottleMs: client.streamingThrottleMs,
    onFeedback,
  }), [apiBase, stableHeaders, requestCredentials, explicitConfig, greeting, theme, features, starterPrompts, getStarterPrompts, capabilitiesPrompt, display?.starterPromptsLayout, context, inputPlugins, toolRenderers, actionRenderers, followUps, client.followUps, feedback, client.streamingThrottleMs, onFeedback]);

  // Default launcher position respects iOS safe areas (home indicator /
  // rounded corners) — a fixed 24px bottom put the FAB under the home
  // indicator on every modern iPhone. Hosts overriding the position own
  // their own env() handling.
  const togglePosition = display?.toggleButtonPosition || {
    bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
    right: 'calc(24px + env(safe-area-inset-right, 0px))',
  };

  // Common interface — same for all three layouts. The wrapper differs.
  // Internal only -- NOT a theme mode. Picks which of the two shipped syntax
  // palettes (and scrim direction) fits behind the declared background; it
  // never overrides a declared token.
  const isDarkTheme = (() => {
    const lightnessOf = (hex: string | undefined): number | null => {
      const t = hex ? hexToHslTriplet(hex) : null;
      const m = t ? /([\d.]+)%$/.exec(t) : null;
      return m ? parseFloat(m[1]) : null;
    };
    const bgL = lightnessOf(theme?.backgroundColor);
    const textL = lightnessOf(theme?.textColor);
    // Ramp DIRECTION, not absolute lightness: a theme whose text is lighter
    // than its background IS a dark theme — the same signal the overlay
    // scrim already keys on, and no knife-edge flip between a #808080 and a
    // #7d7d7d background. The old `lightness < 50` check survives only as a
    // fallback for a partially-invalid theme (which the ramp rejects
    // wholesale anyway).
    if (bgL !== null && textL !== null) return textL > bgL;
    return bgL !== null ? bgL < 50 : false;
  })();
  const themeClass = isDarkTheme ? 'chat-dark' : '';

  // Do not initialise the conversation or any browser persistence until an
  // authenticated, runtime-validated bootstrap has supplied its opaque scope.
  if (!bootstrapReady) return null;

  // Fail closed: a missing/invalid bootstrap must never fall through to a chat
  // surface with unscoped persistence or request config. Keep the recovery state
  // outside ChatInterface so no conversation/history requests can start.
  if (bootstrapError || !bootstrap) {
    const failureLayoutClass =
      layout === 'page'
        ? 'chat-widget-page'
        : layout === 'inline'
          ? 'chat-widget-inline'
          : 'chat-widget-popup';
    return (
      <div
        className={`chat-widget-container chat-widget-content ${failureLayoutClass} ${themeClass} ${className || ''}`}
        style={customStyles as React.CSSProperties}
      >
        <div
          role="alert"
          aria-live="assertive"
          className="flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p className="text-base font-semibold">Chat couldn&apos;t start</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            We couldn&apos;t securely initialize this chat. Check your connection and try again.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // INLINE layout: render the chat interface in place inside the parent. No
  // toggle button, no fixed positioning, no resize. Caller owns sizing via
  // parent CSS (e.g. wrap in a div with h-[600px] w-full).
  if (layout === 'inline') {
    return (
      <ChatStorageProvider storageScope={bootstrap?.storageScope}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-inline chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={interfaceConfig}
              onClose={onClose}
              headerActions={headerActions}
            />
          </ChatPortalProvider>
        </div>
      </ChatStorageProvider>
    );
  }

  // PAGE layout: full-viewport chat surface. Same internal interface as
  // inline; the difference is only the wrapper CSS class which sets
  // height: 100dvh and provides a dedicated chat route experience.
  if (layout === 'page') {
    return (
      <ChatStorageProvider storageScope={bootstrap?.storageScope}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-page chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={interfaceConfig}
              onClose={onClose}
              headerActions={headerActions}
            />
          </ChatPortalProvider>
        </div>
      </ChatStorageProvider>
    );
  }

  // POPUP layout (default, backward compatible): floating side panel with
  // FAB toggle and slide-in animation.
  return (
    <ChatStorageProvider storageScope={bootstrap?.storageScope}>
      {showToggleButton && !isOpen && (
        // Wrap the launcher in a `.chat-widget-container` so its scoped Tailwind
        // utilities (fixed, rounded-full, p-4, bg-primary, …) and the --chat-*
        // tokens resolve. scope-css.js scopes every utility to
        // `.chat-widget-container <util>` (descendant), so a launcher rendered
        // OUTSIDE the container gets none of them — unpositioned and colorless —
        // in a host app. The wrapper is in normal flow with zero footprint; the
        // fixed-position button escapes it.
        <div className={`chat-widget-container ${themeClass}`} style={customStyles as React.CSSProperties}>
          <button
            ref={fabRef}
            onClick={() => setIsOpen(true)}
            // Transition scoped to transform/shadow (transition-all animated
            // everything, including layout props) + a real press state and a
            // theme-aware focus ring. motion-reduce strips the movement.
            className="fixed z-50 rounded-full bg-primary text-primary-foreground shadow-lg p-4 transition-[transform,box-shadow] duration-200 hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
            style={togglePosition}
            aria-label="Open chat"
            aria-haspopup="dialog"
          >
            <MessageCircle className="h-6 w-6" />
          </button>
        </div>
      )}

      {(isOpen || isClosing) && (
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-popup chat-widget-content ${themeClass} ${className || ''}`}
          data-size={size}
          data-resizing={isResizing}
          data-closing={isClosing ? 'true' : undefined}
          style={customStyles as React.CSSProperties}
          // Non-modal dialog: focus moves in on open (see focus effect) but
          // the host page stays interactive — no trap, no aria-modal.
          role="dialog"
          aria-label="Chat"
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          onAnimationEnd={() => {
            if (isClosing) setIsClosing(false);
          }}
        >
          {resizable && (
            <div
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onKeyDown={handleResizeKeyDown}
              className="chat-widget-resize-handle"
              // A real separator: focusable, arrow-key operable (see
              // handleResizeKeyDown), announced with its orientation.
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              aria-label="Resize chat panel — arrow keys to adjust, Home/End for min/max"
            />
          )}
          <div className="w-full h-full overflow-hidden">
            <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
              <ChatInterface
                id={conversationId}
                initialMessages={initialMessages}
                config={interfaceConfig}
                // popup also closes its own panel; consumer's onClose still
                // fires for any cleanup they want (e.g. analytics).
                onClose={() => {
                  setIsOpen(false);
                  onClose?.();
                }}
                headerActions={headerActions}
              />
            </ChatPortalProvider>
          </div>
        </div>
      )}
    </ChatStorageProvider>
  );
});

// Export ChatWidget as default
export default ChatWidget;
