'use client';

/**
 * ChatWidget - Self-contained AI chat widget component
 *
 * This component can be embedded in any React application.
 * It handles its own state, styling, and API communication.
 *
 * Requirements:
 * - API routes must be set up at /api/chat/*
 * - userId must be provided for user identification
 *
 * Usage:
 * ```tsx
 * import { ChatWidget } from '@/components/chat-widget';
 *
 * export default function Page() {
 *   return (
 *     <ChatWidget
 *       userId="user-123"
 *       theme={{ backgroundColor: '#171717', textColor: '#ededed', primaryColor: '#3b82f6' }}
 *       display={{ size: 'default', resizable: true }}
 *     />
 *   );
 * }
 * ```
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ChatInterface from './components/interface';
import { ChatWidgetConfig, ChatWidgetSize } from './types';
import { MessageCircle, X } from 'lucide-react';
import { ChatStorageProvider } from './contexts/chat-storage-context';
import { ChatPortalProvider } from './contexts/chat-portal-context';
import { hexToHslTriplet } from './utils/color';
import { useOpenTriggers } from './hooks/use-open-triggers';

export interface ChatWidgetProps extends ChatWidgetConfig {
  /**
   * CSS class name for custom styling
   */
  className?: string;

  /**
   * Agent ID — identifies which agent this widget talks to. Used to scope the
   * browser cache to (agent, user) so the same browser never surfaces another
   * agent's cached tabs/config, and (later) to load hosted per-agent config.
   */
  agentId?: string;

  /**
   * @deprecated Use `agentId`. Kept as an alias for one minor version.
   */
  widgetId?: string;

  /**
   * Base path the widget calls for chat / upload / history. Defaults to
   * `/api/chat`. Override to mount the handler elsewhere (e.g. a dashboard
   * preview at `/api/preview-chat/<agentId>`). The widget appends `/upload`
   * and `/history` to this base.
   */
  apiBase?: string;

  /**
   * Extra headers sent on every chat request. Used by the dashboard playground
   * to pass an unsaved draft (model / system prompt) for an owner-authed
   * preview. Not for normal embeds.
   */
  extraHeaders?: Record<string, string>;
}

/**
 * Imperative handle exposed via a ref on `<ChatWidget>`. Lets the host app
 * drive the popup panel programmatically. Opening is gated by
 * `allowAutoReopen` (see ChatWidgetConfig) so a dismissed panel is never
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
  userId,
  agentId,
  apiBase,
  extraHeaders,
  widgetId,
  conversationId,
  initialMessages,
  className,
  model,
  systemPrompt,
  temperature,
  theme,
  features,
  display,
  starterPrompts,
  getStarterPrompts,
  capabilitiesPrompt,
  context,
  onClose,
  headerActions,
  open,
  onOpenChange,
  persistState,
  allowAutoReopen,
  onStateChange,
  inputPlugins,
  toolRenderers,
  actionRenderers,
  followUps,
  feedback,
  onFeedback,
}: ChatWidgetProps, ref) {
  // `agentId` is canonical; `widgetId` is the deprecated alias.
  const effectiveAgentId = agentId ?? widgetId;
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
    persistEnabled && userId && effectiveAgentId
      ? `chat-${encodeURIComponent(effectiveAgentId)}|${encodeURIComponent(userId)}-panel-open`
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
      // stored === null → keep the defaultOpen-derived initial value.
    } catch {
      /* localStorage unavailable (private mode / quota) — ignore. */
    }
  }, [panelStateKey]);

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

      styles['--chat-background'] = tone(0);
      styles['--chat-surface-deep'] = tone(0.02); // composer / deep fills
      styles['--chat-muted'] = tone(0.035);
      styles['--chat-surface'] = tone(0.05);
      styles['--chat-hover-bg'] = `hsl(${tone(0.06)})`;
      styles['--chat-divider'] = `hsl(${tone(0.1)})`;
      styles['--chat-border'] = tone(0.12);
      styles['--chat-surface-hover'] = tone(0.12);
      styles['--chat-text-subtle'] = tone(0.42); // placeholder / disabled
      styles['--chat-text-muted'] = tone(0.64); // icons / secondary text
      styles['--chat-text-strong'] = tone(0.88);
      styles['--chat-text'] = tone(1);
      styles['--chat-primary'] = primaryTriplet;
      // Scrim over content: translucency is the intent here, so alpha is
      // correct; direction just follows which pole is lighter.
      styles['--chat-overlay'] =
        text.l > bg.l ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.02)';
    }
    return styles;
  }, [display?.width, theme?.backgroundColor, theme?.textColor, theme?.primaryColor]);

  // Handle resize drag - updates CSS variable directly
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [resizable]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      // Calculate new width based on mouse position
      const newWidth = window.innerWidth - e.clientX;

      // Resize constraints (reasonable bounds for any chat widget)
      const minWidth = 300;
      const maxWidth = Math.min(800, window.innerWidth * 0.8);

      // Clamp to constraints
      const clampedWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));

      // Update CSS variable directly on the element
      containerRef.current.style.setProperty('--chat-widget-width', `${clampedWidth}px`);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const config = useMemo(() => ({
    userId,
    apiBase: apiBase ?? '/api/chat',
    extraHeaders,
    model,
    systemPrompt,
    temperature,
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
    followUps,
    feedback,
    onFeedback,
  }), [userId, apiBase, extraHeaders, model, systemPrompt, temperature, theme, features, starterPrompts, getStarterPrompts, capabilitiesPrompt, display?.starterPromptsLayout, context, inputPlugins, toolRenderers, actionRenderers, followUps, feedback, onFeedback]);

  const togglePosition = display?.toggleButtonPosition || { bottom: '24px', right: '24px' };

  // Common interface — same for all three layouts. The wrapper differs.
  // Internal only -- NOT a theme mode. Picks which of the two shipped syntax
  // palettes (and scrim direction) fits behind the declared background; it
  // never overrides a declared token.
  const isDarkBackground = (() => {
    const t = theme ? hexToHslTriplet(theme.backgroundColor) : null;
    const m = t ? /([\d.]+)%$/.exec(t) : null;
    return m ? parseFloat(m[1]) < 50 : false;
  })();
  const themeClass = isDarkBackground ? 'chat-dark' : '';

  // INLINE layout: render the chat interface in place inside the parent. No
  // toggle button, no fixed positioning, no resize. Caller owns sizing via
  // parent CSS (e.g. wrap in a div with h-[600px] w-full).
  if (layout === 'inline') {
    return (
      <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-inline chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={config}
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
      <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-page chat-widget-content ${themeClass} ${className || ''}`}
          style={customStyles as React.CSSProperties}
        >
          <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
            <ChatInterface
              id={conversationId}
              initialMessages={initialMessages}
              config={config}
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
    <ChatStorageProvider userId={userId} agentId={effectiveAgentId}>
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
            onClick={() => setIsOpen(true)}
            className="fixed z-50 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-all p-4"
            style={togglePosition}
            aria-label="Open chat"
          >
            <MessageCircle className="h-6 w-6" />
          </button>
        </div>
      )}

      {isOpen && (
        <div
          ref={containerRef}
          className={`chat-widget-container chat-widget-popup chat-widget-content ${themeClass} ${className || ''}`}
          data-size={size}
          data-resizing={isResizing}
          style={customStyles as React.CSSProperties}
        >
          {resizable && (
            <div
              onMouseDown={handleMouseDown}
              className="chat-widget-resize-handle"
              aria-label="Resize chat widget"
            />
          )}
          <div className="w-full h-full overflow-hidden">
            <ChatPortalProvider themeClass={themeClass} style={customStyles as React.CSSProperties}>
              <ChatInterface
                id={conversationId}
                initialMessages={initialMessages}
                config={config}
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
